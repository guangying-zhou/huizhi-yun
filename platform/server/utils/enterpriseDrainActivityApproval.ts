import {createHash,createHmac,timingSafeEqual} from 'node:crypto'
import type {RowDataPacket} from 'mysql2/promise'
import {withTransaction} from './db.ts'
import {sign} from './platformSigning.ts'
const hash=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex')
function fail(reason:string):never{throw Error(`drain_activity_${reason}`)}
const text=(value:unknown,min=1)=>typeof value==='string'&&value.trim()===value&&value.length>=min&&value.length<=1000
export async function approveDrainActivity(input:{snapshot:any,activityId:string,requestId:string,decision:any},actorUid:string,apply=false){
 const {snapshot,decision}=input,secret=process.env.HZY_DRAIN_CONTROL_TOKEN
 if(!secret||snapshot?.alg!=='HS256'||typeof snapshot.payload!=='string'||!/^[a-f0-9]{64}$/.test(snapshot.signature)||!timingSafeEqual(createHmac('sha256',secret).update(snapshot.payload).digest(),Buffer.from(snapshot.signature,'hex')))fail('snapshot_signature_invalid')
 const state=JSON.parse(snapshot.payload)
 if(state.schemaVersion!=='enterprise-external-drain.v1'||state.tenant!=='C000001'||state.environment!=='test'||state.mode!=='closed'||!Number.isSafeInteger(state.revision)||state.revision<1||!Array.isArray(state.unresolved)||!text(input.activityId)||input.activityId.length>191||!text(input.requestId)||input.requestId.length>128||!text(actorUid)||actorUid.length>128)fail('closed_identity_required')
 const matches=state.unresolved.filter((value:any)=>value.id===input.activityId)
 if(matches.length!==1||!['active','uncertain'].includes(matches[0].status))fail('unresolved_activity_required')
 const activity=matches[0]
 if(!Number.isSafeInteger(activity.admitted_revision)||activity.admitted_revision<1||activity.admitted_revision>=state.revision)fail('admission_revision_invalid')
 const actors=state.contract?.actors?.filter((value:any)=>value.app===activity.actor&&value.deployment===`C000001-test-${activity.actor}`&&/^[a-f0-9]{64}$/.test(value.artifactSha256))
 if(actors?.length!==1)fail('actor_invalid')
 if(!decision||Object.keys(decision).some(key=>!['outcome','evidenceKind','reference','evidenceSha256','explanation','executionEndedReference','executionEndedEvidenceSha256'].includes(key))||!['verified-terminal','verified-not-sent'].includes(decision.outcome)||!['provider-query','provider-export','activity-ledger'].includes(decision.evidenceKind)||!text(decision.reference,8)||!/^[a-f0-9]{64}$/.test(decision.evidenceSha256)||!text(decision.explanation,16))fail('terminal_evidence_required')
 if(activity.status==='active'&&(!text(decision.executionEndedReference,8)||!/^[a-f0-9]{64}$/.test(decision.executionEndedEvidenceSha256)))fail('execution_ended_evidence_required')
 const claims={type:'enterprise-drain-activity-resolution.v1',tenant:state.tenant,environment:state.environment,closedRevision:state.revision,actor:actors[0],activity,activitySha256:hash(activity),decision,actorUid,requestId:input.requestId}
 const immutable=JSON.stringify(claims),approvalSha256=hash(immutable)
 const result=await withTransaction(async tx=>{
  if(!await tx.queryRow<RowDataPacket>('SELECT tenant_code FROM tenants WHERE tenant_code=? FOR UPDATE',[state.tenant]))fail('tenant_missing')
  const old=await tx.queryRow<RowDataPacket>('SELECT approval_sha256 FROM enterprise_drain_activity_approvals WHERE tenant_code=? AND (request_id=? OR (environment=? AND activity_id=? AND closed_revision=?)) FOR UPDATE',[state.tenant,input.requestId,state.environment,activity.id,state.revision])
  if(old&&old.approval_sha256!==approvalSha256)fail('immutable_approval_conflict')
  if(apply&&!old)await tx.execute('INSERT INTO enterprise_drain_activity_approvals(tenant_code,environment,activity_id,closed_revision,request_id,approval_sha256,payload_json,actor_uid) VALUES(?,?,?,?,?,?,?,?)',[state.tenant,state.environment,activity.id,state.revision,input.requestId,approvalSha256,immutable,actorUid])
  return {applied:apply,replayed:!!old,approvalSha256}
 })
 if(!apply)return {...result,claims}
 // Renewing the short-lived envelope does not change the immutable approval.
 const payload=JSON.stringify({...claims,approvalSha256,expiresAt:new Date(Date.now()+300000).toISOString()})
 return {...result,payload,...await sign(payload)}
}
