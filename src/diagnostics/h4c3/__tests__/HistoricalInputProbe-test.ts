import { executeH4Cases } from "../HistoricalInputProbeCore";
import { H4_IDENTITIES, H4_RECEIPT_TEXT } from "../HistoricalInputFixture";
import { H4_RECEIPT_SHA256, h4ProbeAvailability, runHistoricalInputProbe } from "../HistoricalInputProbe";
import { sha256Text } from "@/utils/sha256";
import { getCanonicalExerciseSnapshot, replaceCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { setRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";

jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "1.2.1-h4diag1", android: { versionCode: 187 } } } }));
jest.mock("@/services/SupabaseService", () => ({ supabase: undefined }));
jest.mock("@/services/authorization/OperatorSessionService", () => ({ ...jest.requireActual("@/services/authorization/OperatorSessionService"), getOperatorSession: () => ({ state: "AUTHENTICATED", isPlatformAdmin: true, principal: { userId: "SYNTHETIC-ADMIN", roleAssignments: [] }, profile: { userId: "SYNTHETIC-ADMIN", displayName: "Synthetic" } }) }));

const denial = () => { throw new Error("HISTORICAL_CHECKPOINT_QUARANTINED"); };
test("frozen exact receipt hash and four non-operational aliases", () => {
  expect(sha256Text(H4_RECEIPT_TEXT)).toBe(H4_RECEIPT_SHA256);
  expect(JSON.parse(H4_RECEIPT_TEXT).result).toEqual({status:"PASS",strictValid:152,historicalInvalid:4,warnings:4,unexpected:0,runtimeEligible:false});
  expect(new Set(H4_IDENTITIES.map(x=>x.exerciseId)).size).toBe(4);
});
test("exact signature accepted without mutation", async () => expect((await executeH4Cases("fixed",()=>"same",[{id:"x",expected:"HISTORICAL_CHECKPOINT_QUARANTINED",run:denial}])).status).toBe("PASS"));
test.each(["UNRELATED_ERROR","NETWORK_ERROR","AUTHENTICATION_REQUIRED"])("wrong denial %s rejected", async reason => expect((await executeH4Cases("fixed",()=>"same",[{id:"x",expected:"HISTORICAL_CHECKPOINT_QUARANTINED",run:()=>{throw new Error(reason);}}])).status).toBe("BLOCKED"));
test("unexpected success blocks and stops subsequent operations", async () => { const next=jest.fn();const r=await executeH4Cases("fixed",()=>"same",[{id:"bad",expected:"HISTORICAL_CHECKPOINT_QUARANTINED",run:()=>undefined},{id:"never",expected:"FALSE",run:next}]);expect(r.status).toBe("BLOCKED");expect(next).not.toHaveBeenCalled(); });
test("false is required from strict receipt validators", async () => {expect((await executeH4Cases("fixed",()=>"same",[{id:"x",expected:"FALSE",run:()=>false}])).status).toBe("PASS");expect((await executeH4Cases("fixed",()=>"same",[{id:"x",expected:"FALSE",run:()=>true}])).status).toBe("BLOCKED");});
test("state change fails even if exact denial returned", async () => { let digest="before";const r=await executeH4Cases("fixed",()=>digest,[{id:"x",expected:"HISTORICAL_CHECKPOINT_QUARANTINED",run:()=>{digest="after";denial();}}]);expect(r.reason).toBe("STATE_CHANGED_STOP"); });
test("real existing guard and restoration entries, no mocked PASS", async () => {
  const logger=jest.spyOn(console,"info").mockImplementation(()=>undefined);
  replaceCanonicalExerciseSnapshot({...getCanonicalExerciseSnapshot(),lifecycleState:"RUNNING"});
  expect(h4ProbeAvailability()).toBe("COMPLETED_IDLE_STATE_REQUIRED");
  replaceCanonicalExerciseSnapshot({...getCanonicalExerciseSnapshot(),lifecycleState:"COMPLETED"});
  setRuntimeWriterAuthorityState("WRITER","SYNTHETIC");expect(h4ProbeAvailability()).toBe("LOCAL_WRITER_MUST_BE_ABSENT");
  setRuntimeWriterAuthorityState("UNRESOLVED");
  const r=await runHistoricalInputProbe();expect(r.status).toBe("PASS");expect(r.cases).toHaveLength(30);expect(r.cases.every(x=>x.status==="PASS"&&x.stateUnchanged)).toBe(true);expect(r.afterDigest).toBe(r.beforeDigest);
  await expect(runHistoricalInputProbe()).rejects.toThrow("PROBE_ALREADY_CONSUMED");logger.mockRestore();
});
