export type DeepReadonly<T> = T extends (...args: never[]) => unknown ? T
  : T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[]
    : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(item => deepFreeze(item));
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export function immutableClone<T>(value: T): DeepReadonly<T> {
  return deepFreeze(structuredClone(value));
}
