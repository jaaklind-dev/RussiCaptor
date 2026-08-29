import type { SharedWorkflowGateway, SharedWorkflowMutationRequest, SharedWorkflowMutationResult } from "./SharedWorkflowMutationService";

type Head = { revision: number; ownerUserId?: string; state: Readonly<Record<string,unknown>> };
type Actor = Readonly<{ userId: string; role: "CM" | "EXCON"; exerciseIds: readonly string[] | "GLOBAL" }>;
const appendKeys = ["notes","timelineEvents","interventions","medicationAdministrations","vitalSigns"] as const;
const patientKey = (exerciseId:string,patientId:string) => `${exerciseId}\u0000${patientId}`;
const commandKey = (exerciseId:string,commandId:string) => `${exerciseId}\u0000${commandId}`;

function mergeAppend(current: Readonly<Record<string,unknown>>, proposed: Readonly<Record<string,unknown>>): Readonly<Record<string,unknown>> {
  const result: Record<string,unknown> = { ...current };
  appendKeys.forEach(key => {
    const merged = new Map<string,unknown>();
    [...((current[key] as readonly Record<string,unknown>[] | undefined) ?? []),
      ...((proposed[key] as readonly Record<string,unknown>[] | undefined) ?? [])]
      .forEach(item => merged.set(String(item.id),Object.freeze({...item})));
    result[key] = [...merged.values()].sort((a,b)=>String((a as Record<string,unknown>).id).localeCompare(String((b as Record<string,unknown>).id)));
  });
  return Object.freeze(result);
}

/** Deterministic transaction model used by concurrency tests; production uses the SQL RPC. */
export class InMemorySharedWorkflowGateway implements SharedWorkflowGateway {
  private readonly heads = new Map<string,Head>();
  private readonly commands = new Map<string,Readonly<{ actor:string; patientId:string; kind:string; result:SharedWorkflowMutationResult }>>();
  constructor(private readonly actor: () => Actor) {}
  seed(exerciseId:string,patientId:string,state:Readonly<Record<string,unknown>>,ownerUserId?:string,revision=0):void {
    this.heads.set(patientKey(exerciseId,patientId),{revision,ownerUserId,state:Object.freeze({...state})});
  }
  read(exerciseId:string,patientId:string):Readonly<Head>|undefined { const value=this.heads.get(patientKey(exerciseId,patientId)); return value&&Object.freeze({...value}); }
  async submit(request:SharedWorkflowMutationRequest):Promise<SharedWorkflowMutationResult>{
    const actor=this.actor();
    if(actor.exerciseIds!=="GLOBAL"&&!actor.exerciseIds.includes(request.exerciseId)) return Object.freeze({status:"AUTHORIZATION_DENIED",revision:request.expectedRevision});
    const cKey=commandKey(request.exerciseId,request.commandId); const duplicate=this.commands.get(cKey);
    if(duplicate){
      if(duplicate.actor!==actor.userId||duplicate.patientId!==request.patientId||duplicate.kind!==request.kind) throw new Error("IDEMPOTENCY_KEY_REUSE");
      const head=this.heads.get(patientKey(request.exerciseId,request.patientId))!;
      return Object.freeze({status:"IDEMPOTENT",revision:head.revision,ownerUserId:head.ownerUserId,state:head.state});
    }
    const pKey=patientKey(request.exerciseId,request.patientId);
    const head=this.heads.get(pKey)??{revision:0,ownerUserId:undefined,state:Object.freeze({...request.state})};
    this.heads.set(pKey,head);
    const reject=(status:SharedWorkflowMutationResult["status"]):SharedWorkflowMutationResult=>Object.freeze({status,revision:head.revision,ownerUserId:head.ownerUserId,state:head.state});
    if(actor.role!=="EXCON"&&["CLAIM","REACQUIRE"].includes(request.kind)&&head.ownerUserId!==undefined)return reject("ALREADY_OWNED");
    if(request.kind!=="APPEND"&&head.revision!==request.expectedRevision)return reject("STALE_VERSION");
    if(head.ownerUserId!==request.expectedOwnerUserId)return reject("OWNERSHIP_CHANGED");
    const excon=actor.role==="EXCON";
    if(!excon&&["APPEND","MUTABLE","TRANSFER","RELEASE"].includes(request.kind)&&head.ownerUserId!==actor.userId)return reject("NOT_OWNER");
    if(!excon&&["CLAIM","REACQUIRE"].includes(request.kind)&&request.nextOwnerUserId!==actor.userId)throw new Error("INVALID_OWNER_TRANSITION");
    if(request.kind==="TRANSFER"&&!request.nextOwnerUserId)throw new Error("INVALID_OWNER_TRANSITION");
    if(request.kind==="RELEASE"&&request.nextOwnerUserId)throw new Error("INVALID_OWNER_TRANSITION");
    if(["APPEND","MUTABLE","TRANSFER_REQUEST"].includes(request.kind)&&request.nextOwnerUserId!==head.ownerUserId)throw new Error("INVALID_OWNER_TRANSITION");
    const next:Head={revision:head.revision+1,ownerUserId:request.nextOwnerUserId,
      state:request.kind==="APPEND"?mergeAppend(head.state,request.state):Object.freeze({...request.state})};
    this.heads.set(pKey,next);
    const result=Object.freeze({status:"APPLIED" as const,revision:next.revision,ownerUserId:next.ownerUserId,state:next.state});
    this.commands.set(cKey,Object.freeze({actor:actor.userId,patientId:request.patientId,kind:request.kind,result})); return result;
  }
}
