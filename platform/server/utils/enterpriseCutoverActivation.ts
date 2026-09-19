import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { queryRow, withTransaction } from './db.ts'
import { sign } from './platformSigning.ts'

type Row = RowDataPacket
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
function fail(reason: string): never { throw Error(`cutover_activation_${reason}`) }
export type CutoverActivationInput = { tenantCode: string, environment: string, runtimeCode: string, cutoverKey: string, seal: { payload: string, signature: string, alg: string } }
export async function signCommittedCutoverActivation(input: CutoverActivationInput, controlToken: string) {
  if (input.tenantCode !== 'C000001' || input.environment !== 'test' || !input.runtimeCode || !input.cutoverKey || !controlToken) fail('identity_invalid')
  const drainToken = process.env.HZY_DRAIN_CONTROL_TOKEN
  const seal = input.seal
  if (!drainToken || !seal || seal.alg !== 'HS256' || typeof seal.payload !== 'string' || !/^[a-f0-9]{64}$/.test(seal.signature)) fail('seal_invalid')
  if (!timingSafeEqual(createHmac('sha256', drainToken).update(seal.payload).digest(), Buffer.from(seal.signature, 'hex'))) fail('seal_invalid')
  const snapshot = JSON.parse(seal.payload)
  if (snapshot.schemaVersion !== 'enterprise-external-drain.v1' || snapshot.tenant !== input.tenantCode || snapshot.environment !== input.environment || snapshot.mode !== 'sealed' || snapshot.ingressDrained !== true || snapshot.seal?.cutoverKey !== input.cutoverKey || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1) fail('seal_binding_invalid')
  const actors: Array<{ app: string, deployment: string, artifactSha256: string }> = snapshot.contract?.actors
  if (!Array.isArray(actors) || actors.length !== 2 || new Set(actors.map(actor => actor.app)).size !== 2 || actors.some(actor => !['aims', 'assets'].includes(actor.app) || actor.deployment !== `C000001-test-${actor.app}` || !/^[a-f0-9]{64}$/.test(actor.artifactSha256))) fail('actors_invalid')
  const runtime = await queryRow<Row>('SELECT runtime_endpoint,control_token_hash,status FROM tenant_runtime_instances WHERE tenant_code=? AND environment=? AND runtime_code=?', [input.tenantCode, input.environment, input.runtimeCode])
  if (!runtime || runtime.status !== 'ready' || !/^[a-f0-9]{64}$/.test(runtime.control_token_hash) || !timingSafeEqual(Buffer.from(runtime.control_token_hash, 'hex'), Buffer.from(sha(controlToken), 'hex'))) fail('runtime_authentication_failed')
  const approvedEvidence = await queryRow<Row>('SELECT payload_sha256,actor_uid FROM enterprise_external_drain_approvals WHERE tenant_code=? AND environment=? AND cutover_key=? AND seal_revision=? AND seal_payload_sha256=?', [input.tenantCode,input.environment,input.cutoverKey,snapshot.revision,sha(seal.payload)])
  if (!approvedEvidence || !/^[a-f0-9]{64}$/.test(approvedEvidence.payload_sha256) || !approvedEvidence.actor_uid) fail('external_evidence_not_approved')
  const endpoint = new URL(runtime.runtime_endpoint)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) fail('runtime_endpoint_invalid')
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/runtime/enterprise/cutover-activation`
  // Credential only goes to the enrolled, rechecked endpoint; never caller URL.
  const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { authorization: `Bearer ${controlToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ cutoverKey: input.cutoverKey }) })
  if (!response.ok) fail('runtime_observation_failed')
  const observed = await response.json()
  if (observed.type !== 'enterprise-cutover-observation.v1' || observed.tenantCode !== input.tenantCode || observed.environment !== input.environment || observed.runtimeCode !== input.runtimeCode || observed.cutoverKey !== input.cutoverKey || observed.generation !== snapshot.seal.targetGeneration || observed.evidenceHash !== sha(seal.payload) || !/^[a-f0-9]{64}$/.test(observed.reviewHash) || !/^[1-9][0-9]{0,19}$/.test(observed.generation) || BigInt(observed.generation) > 18446744073709551615n) fail('observation_mismatch')
  const payload = await withTransaction(async tx => {
    const current = await tx.queryRow<Row>('SELECT runtime_endpoint,control_token_hash,status FROM tenant_runtime_instances WHERE tenant_code=? AND environment=? AND runtime_code=? FOR UPDATE', [input.tenantCode, input.environment, input.runtimeCode])
    if (!current || current.status !== 'ready' || current.runtime_endpoint !== runtime.runtime_endpoint || current.control_token_hash !== runtime.control_token_hash) fail('runtime_changed')
    const apps = await tx.queryRows<Row[]>('SELECT app_code,deployment_code,runtime_endpoint FROM deployments WHERE tenant_code=? AND environment=? AND status=\'active\' AND app_code IN (\'aims\',\'assets\') ORDER BY app_code FOR UPDATE', [input.tenantCode, input.environment])
    const owner = await tx.queryRow<Row>('SELECT storage_mode,runtime_code,worker_deployment,CAST(generation AS CHAR) generation FROM tenant_scheduler_ownership WHERE tenant_code=? AND environment=? AND source_app=\'aims\' FOR UPDATE', [input.tenantCode, input.environment])
    if (apps.length !== 2 || apps.some(app => app.runtime_endpoint !== runtime.runtime_endpoint || !actors.some(actor => actor.app === app.app_code && actor.deployment === app.deployment_code)) || !owner || owner.storage_mode !== 'unified' || owner.runtime_code !== input.runtimeCode || owner.worker_deployment !== actors.find(actor => actor.app === 'aims')?.deployment || owner.generation !== observed.generation) fail('route_not_active')
    return JSON.stringify({ type: 'enterprise-drain-release.v1', tenant: input.tenantCode, environment: input.environment, cutoverKey: input.cutoverKey, sealRevision: snapshot.revision, actors, generation: observed.generation, runtimeCode: input.runtimeCode, reviewHash: observed.reviewHash, evidenceHash: observed.evidenceHash, externalApprovalSha256: approvedEvidence.payload_sha256, expiresAt: new Date(Date.now() + 30000).toISOString() })
  })
  return { payload, ...await sign(payload) }
}
