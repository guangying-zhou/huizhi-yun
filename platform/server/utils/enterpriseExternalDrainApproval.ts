import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { withTransaction } from './db.ts'
import { sign } from './platformSigning.ts'
import { classifyProviderEvidence } from './enterpriseProviderReceipts.mjs'
const digest = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
function fail(reason: string): never { throw Error(`external_drain_${reason}`) }
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value === value.trim()
const coverage = ['deployed-worker-versions-and-direct-bindings','pre-wrapper-inflight-history','runtime-direct-callers','external-notification-providers','scheduled-consumers-and-other-app-outboxes']
export async function approveExternalDrain(input: { report: any, seal: any, decisions: any[], requestId: string, approvalReference: string }, actorUid: string, apply = false) {
  const { report, seal, decisions } = input
  const secret = process.env.HZY_DRAIN_CONTROL_TOKEN
  if (!secret || !seal || seal.alg !== 'HS256' || typeof seal.payload !== 'string' || !/^[a-f0-9]{64}$/.test(seal.signature) || !timingSafeEqual(createHmac('sha256', secret).update(seal.payload).digest(), Buffer.from(seal.signature, 'hex'))) fail('seal_signature_invalid')
  const snapshot = JSON.parse(seal.payload)
  const binding = report?.binding
  if (!binding || report.schemaVersion !== 'enterprise-provider-receipts.v1' || snapshot.mode !== 'sealed' || !snapshot.ingressDrained || snapshot.tenant !== 'C000001' || snapshot.environment !== 'test' || binding.tenant !== snapshot.tenant || binding.environment !== snapshot.environment || !text(binding.instanceId) || !text(binding.runtimeDeployment) || !Number.isSafeInteger(snapshot.revision) || !text(snapshot.seal?.cutoverKey) || !/^[1-9][0-9]{0,19}$/.test(snapshot.seal.targetGeneration) || BigInt(snapshot.seal.targetGeneration)>18446744073709551615n) fail('identity_invalid')
  if (!Array.isArray(binding.sources) || binding.sources.length !== 2 || new Set(binding.sources.map((value: any) => value.app)).size !== 2 || binding.sources.some((value: any) => !['aims','assets'].includes(value.app) || value.deployment !== `C000001-test-${value.app}` || !/^[a-z][a-z0-9_]{0,63}$/.test(value.schema))) fail('source_closure_invalid')
  const providers = new Set(['aims','assets','finance','altoc','codocs','people','console'])
  if (!Array.isArray(binding.providers) || !Array.isArray(binding.unconfiguredProviders)) fail('provider_closure_invalid')
  for (const provider of binding.providers) { if (!providers.delete(provider.app) || !/^[a-z][a-z0-9_]{0,63}$/.test(provider.schema) || !text(provider.deployment)) fail('provider_closure_invalid') }
  for (const app of binding.unconfiguredProviders) if (!providers.delete(app)) fail('provider_closure_invalid')
  if (providers.size || binding.sources.some((source: any) => !binding.providers.some((provider: any) => provider.app === source.app && provider.schema === source.schema && provider.deployment === source.deployment))) fail('provider_closure_invalid')
  const expected = [...binding.sources.map((value: any) => ({ ...value, kind: 'source' })), ...binding.providers.map((value: any) => ({ ...value, kind: value.app === 'console' ? 'notification' : 'receipt' }))]
  if (!Array.isArray(report.probes) || report.probes.length !== expected.length || expected.some((value: any) => report.probes.filter((probe: any) => ['kind','app','schema','deployment'].every(field => probe[field] === value[field])).length !== 1)) fail('probe_closure_invalid')
  const entries = classifyProviderEvidence(binding, report.probes)
  if (new Set(entries.map((entry: any) => entry.id)).size !== entries.length) fail('entry_closure_invalid')
  if (entries.some((entry: any) => entry.classification === 'blocked') || coverage.some(scope => !entries.some((entry: any) => entry.id === `coverage:${scope}`))) fail('blocked_evidence')
  const manual = entries.filter((entry: any) => entry.classification === 'manual-required')
  if (!Array.isArray(decisions) || decisions.length !== manual.length || new Set(decisions.map(value => value.entryId)).size !== manual.length || manual.some((entry: any) => !decisions.some(decision => decision.entryId === entry.id && decision.entrySha256 === digest(entry) && ((entry.id.startsWith('operation:') || entry.id.startsWith('notification:') || ['coverage:pre-wrapper-inflight-history','coverage:external-notification-providers'].includes(entry.id)) ? ['verified-terminal','verified-not-sent'] : ['verified-terminal','verified-not-sent','verified-consumer-coverage']).includes(decision.outcome) && ['provider-query','provider-export','activity-ledger','deployment-inventory'].includes(decision.evidenceKind) && text(decision.reference) && decision.reference.length >= 8 && /^[a-f0-9]{64}$/.test(decision.evidenceSha256) && text(decision.explanation) && decision.explanation.length >= 16))) fail('manual_evidence_incomplete')
  if (![input.requestId,input.approvalReference,actorUid].every(text)) fail('approval_audit_required')
  const actors = snapshot.contract?.actors
  if (!Array.isArray(actors) || actors.length !== 2 || binding.sources.some((source: any) => !actors.some((actor: any) => actor.app === source.app && actor.deployment === source.deployment && /^[a-f0-9]{64}$/.test(actor.artifactSha256)))) fail('actor_mismatch')
  const payload = JSON.stringify({ type:'enterprise-external-drain-approval.v1',tenant:binding.tenant,environment:binding.environment,cutoverKey:snapshot.seal.cutoverKey,generation:snapshot.seal.targetGeneration,sealRevision:snapshot.revision,sealPayloadSha256:digest(seal.payload),actors,report:{...report,entries},decisions,actorUid,approvalReference:input.approvalReference,requestId:input.requestId })
  const result = await withTransaction(async tx => {
    const tenant = await tx.queryRow<RowDataPacket>('SELECT tenant_code FROM tenants WHERE tenant_code=? FOR UPDATE',[binding.tenant])
    if (!tenant) fail('tenant_missing')
    const old = await tx.queryRow<RowDataPacket>('SELECT payload_sha256 FROM enterprise_external_drain_approvals WHERE tenant_code=? AND (request_id=? OR (environment=? AND cutover_key=? AND seal_revision=?)) FOR UPDATE',[binding.tenant,input.requestId,binding.environment,snapshot.seal.cutoverKey,snapshot.revision])
    if (old && old.payload_sha256 !== digest(payload)) fail('immutable_approval_conflict')
    if (apply && !old) await tx.execute('INSERT INTO enterprise_external_drain_approvals(tenant_code,environment,cutover_key,seal_revision,seal_payload_sha256,request_id,payload_sha256,payload_json,actor_uid,approval_reference) VALUES(?,?,?,?,?,?,?,?,?,?)',[binding.tenant,binding.environment,snapshot.seal.cutoverKey,snapshot.revision,digest(seal.payload),input.requestId,digest(payload),payload,actorUid,input.approvalReference])
    return {applied:apply,replayed:!!old,payload,payloadSha256:digest(payload)}
  })
  return apply ? {...result,...await sign(payload)} : result
}
