import "expo-sqlite/localStorage/install";

import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import type { ExercisePackageRegistry } from "./ExercisePackageRegistry";
import { exercisePackageRegistry } from "./ExercisePackageService";

const STORAGE_KEY = "russicaptor.activeExercisePackage.v1";
const packageKey = (pkg: ExercisePackage): string => `${pkg.packageId}@${pkg.packageVersion}`;

export type ActiveExercisePackageAudit = Readonly<{
  sequenceNumber: number;
  eventType: "ActiveExercisePackageSelected";
  previousPackageKey?: string;
  activePackageKey: string;
}>;

export type ActivePackageStorage = Readonly<{
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}>;

export type ActivePackageActivationResult =
  | Readonly<{ ok: true; package: ExercisePackage; changed: boolean; activePackageKey: string }>
  | Readonly<{ ok: false; code: "PACKAGE_NOT_FOUND" | "PERSISTENCE_FAILED"; message: string }>;

const defaultStorage: ActivePackageStorage = {
  getItem: key => globalThis.localStorage?.getItem(key) ?? null,
  setItem: (key, value) => globalThis.localStorage?.setItem(key, value),
};

export class ActiveExercisePackageService {
  private activeKey?: string;
  private readonly listeners = new Set<() => void>();
  private readonly audit: ActiveExercisePackageAudit[] = [];

  constructor(
    private readonly registry: ExercisePackageRegistry,
    private readonly storage: ActivePackageStorage = defaultStorage,
  ) {
    this.activeKey = this.readPersistedKey();
  }

  private readPersistedKey(): string | undefined {
    try {
      const stored = this.storage.getItem(STORAGE_KEY);
      if (!stored) return undefined;
      const separator = stored.lastIndexOf("@");
      if (separator < 1) return undefined;
      return this.registry.get(stored.slice(0, separator), stored.slice(separator + 1)) ? stored : undefined;
    } catch {
      return undefined;
    }
  }

  getActive(): ExercisePackage | undefined {
    if (!this.activeKey) return undefined;
    const separator = this.activeKey.lastIndexOf("@");
    return this.registry.get(this.activeKey.slice(0, separator), this.activeKey.slice(separator + 1));
  }

  isActive(pkg: ExercisePackage): boolean {
    return this.activeKey === packageKey(pkg);
  }

  activate(packageId: string, packageVersion: string): ExercisePackage {
    const pkg = this.registry.require(packageId, packageVersion);
    const nextKey = packageKey(pkg);
    if (nextKey === this.activeKey) return pkg;
    const previousPackageKey = this.activeKey;
    this.storage.setItem(STORAGE_KEY, nextKey);
    this.activeKey = nextKey;
    this.audit.push(Object.freeze({
      sequenceNumber: this.audit.length + 1,
      eventType: "ActiveExercisePackageSelected",
      previousPackageKey,
      activePackageKey: nextKey,
    }));
    this.listeners.forEach(listener => listener());
    return pkg;
  }

  activateWithResult(packageId: string, packageVersion: string): ActivePackageActivationResult {
    const pkg = this.registry.get(packageId, packageVersion);
    if (!pkg) return Object.freeze({ ok: false, code: "PACKAGE_NOT_FOUND", message: "Valitud õppusepaketti ei leitud." });
    const nextKey = packageKey(pkg);
    if (nextKey === this.activeKey) return Object.freeze({ ok: true, package: pkg, changed: false, activePackageKey: nextKey });
    try {
      this.activate(packageId, packageVersion);
      return Object.freeze({ ok: true, package: pkg, changed: true, activePackageKey: nextKey });
    } catch {
      return Object.freeze({ ok: false, code: "PERSISTENCE_FAILED", message: "Õppusepaketi valikut ei õnnestunud salvestada." });
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getVersion(): string {
    return `${this.activeKey ?? "NONE"}:${this.audit.length}`;
  }

  getAudit(): readonly ActiveExercisePackageAudit[] {
    return Object.freeze(this.audit.map(entry => Object.freeze({ ...entry })));
  }
}

export const activeExercisePackageService = new ActiveExercisePackageService(exercisePackageRegistry);
