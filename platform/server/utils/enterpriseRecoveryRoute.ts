import { createHash, timingSafeEqual } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { withTransaction, type TransactionExecutor } from './db.ts'
import { sign } from './platformSigning.ts'

type Row = RowDataPacket
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value
const digest = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex')
function fail(reason: string): never {
  throw new Error(`recovery_route_${reason}`)
}
export type RecoveryRouteInput = {
  tenantCode: string
  environment: 'test' | 'prod'
  recoveryKey: string
  recoveryReviewHash: string
  runtimeCode: string
  workerDeployment: string
  workerClient: string
  generation: string
  aimsSchema: string
  assetsSchema: string
  instanceId: string
  databaseUser: string
  databaseHost: string
  expectedRevision: number
  requestId: string
  actorUid: string
}
function normalize(value: RecoveryRouteInput) {
  for (const field of ['tenantCode', 'recoveryKey', 'runtimeCode', 'workerDeployment', 'workerClient', 'instanceId', 'requestId', 'actorUid', 'databaseUser', 'databaseHost'] as const) {
    if (typeof value[field] !== 'string' || !value[field] || value[field].trim() !== value[field] || value[field].length > 128) fail('invalid_identity')
  }
  if (value.workerClient !== 'aims.runtime' || !['test', 'prod'].includes(value.environment) || !/^[a-f0-9]{64}$/.test(value.recoveryReviewHash) || !/^[1-9][0-9]{0,19}$/.test(value.generation) || BigInt(value.generation) > 18446744073709551615n || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) fail('invalid_revision')
  if (![value.aimsSchema, value.assetsSchema].every(name => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) || value.aimsSchema === value.assetsSchema) fail('invalid_schema')
  return { ...value }
}
async function snapshot(tx: TransactionExecutor, input: RecoveryRouteInput) {
  const tenant = await tx.queryRow<Row>('SELECT tenant_code FROM tenants WHERE tenant_code=? FOR UPDATE', [input.tenantCode])
  if (!tenant) fail('tenant_missing')
  const runtime = await tx.queryRow<Row>('SELECT id,runtime_code,status,runtime_endpoint FROM tenant_runtime_instances WHERE tenant_code=? AND environment=? AND runtime_code=? FOR UPDATE', [input.tenantCode, input.environment, input.runtimeCode])
  const apps = await tx.queryRows<Row[]>('SELECT app_code,deployment_code,api_base,runtime_endpoint,base_path FROM deployments WHERE tenant_code=? AND environment=? AND status=\'active\' AND app_code IN (\'aims\',\'assets\') ORDER BY app_code FOR UPDATE', [input.tenantCode, input.environment])
  const scheduler = await tx.queryRow<Row>('SELECT storage_mode,runtime_code,worker_deployment,worker_client,CAST(generation AS CHAR) generation,revision FROM tenant_scheduler_ownership WHERE tenant_code=? AND environment=? AND source_app=\'aims\' FOR UPDATE', [input.tenantCode, input.environment])
  if (!runtime || runtime.status !== 'ready' || !runtime.runtime_endpoint || apps.length !== 2 || apps[0]?.app_code !== 'aims' || apps[1]?.app_code !== 'assets' || apps[0].deployment_code !== input.workerDeployment || !scheduler || scheduler.storage_mode !== 'disabled' || BigInt(scheduler.generation) >= BigInt(input.generation)) fail('preparation_binding_mismatch')
  const endpoint = new URL(runtime.runtime_endpoint)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) fail('runtime_endpoint_invalid')
  return { runtime, apps, scheduler }
}
export async function prepareRecoveryRoute(input: RecoveryRouteInput, apply = false, transaction = withTransaction) {
  const value = normalize(input)
  return transaction(async (tx) => {
    const current = await snapshot(tx, value)
    const old = await tx.queryRow<Row>('SELECT revision,state,payload_sha256,payload_json FROM enterprise_recovery_routes WHERE tenant_code=? AND environment=? FOR UPDATE', [value.tenantCode, value.environment])
    const request = await tx.queryRow<Row>('SELECT payload_json FROM enterprise_recovery_route_receipts WHERE tenant_code=? AND request_id=?', [value.tenantCode, value.requestId])
    if (request) {
      const recorded = typeof request.payload_json === 'string' ? JSON.parse(request.payload_json) : request.payload_json
      if (digest(recorded.input) !== digest(value)) fail('replay_conflict')
      return { applied: true, replayed: true, payload: recorded }
    }
    if (Number(old?.revision || 0) !== value.expectedRevision || (old && old.state !== 'disabled')) fail('revision_conflict')
    const payload = { type: 'enterprise-recovery-route.v1', input: value, revision: value.expectedRevision + 1, snapshot: current }
    if (!apply) return { applied: false, payload, payloadSha256: digest(payload) }
    const json = JSON.stringify(canonical(payload))
    await tx.execute(`INSERT INTO enterprise_recovery_routes(tenant_code,environment,recovery_key,revision,state,payload_json,payload_sha256,actor_uid) VALUES(?,?,?,?,'prepared',?,?,?) ON DUPLICATE KEY UPDATE recovery_key=VALUES(recovery_key),revision=VALUES(revision),state='prepared',payload_json=VALUES(payload_json),payload_sha256=VALUES(payload_sha256),actor_uid=VALUES(actor_uid),updated_at=UTC_TIMESTAMP(6)`, [value.tenantCode, value.environment, value.recoveryKey, payload.revision, json, digest(json), value.actorUid])
    await tx.execute('INSERT INTO enterprise_recovery_route_receipts(tenant_code,request_id,payload_sha256,payload_json,actor_uid) VALUES(?,?,?,?,?)', [value.tenantCode, value.requestId, digest(json), json, value.actorUid])
    return { applied: true, payload, payloadSha256: digest(json) }
  })
}
// Signing occurs after commit, never inside the DB transaction. A signing failure
// can safely retry the immutable request receipt.
export async function signedRecoveryRoutePreparation(input: RecoveryRouteInput, apply = false) {
  const result = await prepareRecoveryRoute(input, apply)
  if (!apply) return result
  const payload = JSON.stringify(canonical(result.payload))
  return { ...result, signed: { payload, ...await sign(payload) } }
}

export type RecoveryRouteActivation = {
  tenantCode: string
  environment: string
  recoveryKey: string
  preparationSha256: string
  activationSha256: string
  runtimeCode: string
  generation: string
}
// This entry is for the enrolled runtime control credential, never a user token.
// It records deployment governance only; it does not issue business credentials.
export async function publishRecoveryRoute(input: RecoveryRouteActivation, controlToken: string, transaction = withTransaction) {
  if (!/^[a-f0-9]{64}$/.test(input.activationSha256) || !/^[a-f0-9]{64}$/.test(input.preparationSha256) || !controlToken) fail('activation_invalid')
  return transaction(async (tx) => {
    const runtime = await tx.queryRow<Row>('SELECT id,control_token_hash FROM tenant_runtime_instances WHERE tenant_code=? AND environment=? AND runtime_code=? FOR UPDATE', [input.tenantCode, input.environment, input.runtimeCode])
    const expected = Buffer.from(String(runtime?.control_token_hash || ''), 'hex'), actual = Buffer.from(digest(controlToken), 'hex')
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) fail('runtime_authentication_failed')
    const row = await tx.queryRow<Row>('SELECT * FROM enterprise_recovery_routes WHERE tenant_code=? AND environment=? FOR UPDATE', [input.tenantCode, input.environment])
    if (!row || row.recovery_key !== input.recoveryKey || row.payload_sha256 !== input.preparationSha256) fail('preparation_mismatch')
    if (row.state === 'published') {
      if (row.activation_sha256 !== input.activationSha256) fail('activation_conflict')
      const published = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json
      const actualApps = await tx.queryRows<Row[]>('SELECT app_code,deployment_code,runtime_endpoint FROM deployments WHERE tenant_code=? AND environment=? AND status=\'active\' AND app_code IN (\'aims\',\'assets\') ORDER BY app_code FOR UPDATE', [input.tenantCode, input.environment])
      const actualOwner = await tx.queryRow<Row>('SELECT storage_mode,runtime_code,worker_deployment,worker_client,CAST(generation AS CHAR) generation FROM tenant_scheduler_ownership WHERE tenant_code=? AND environment=? AND source_app=\'aims\' FOR UPDATE', [input.tenantCode, input.environment])
      if (actualApps.length !== 2 || actualApps.some((app, index) => app.deployment_code !== published.snapshot.apps[index]?.deployment_code || app.runtime_endpoint !== published.snapshot.runtime.runtime_endpoint) || !actualOwner || actualOwner.storage_mode !== 'recovered' || actualOwner.runtime_code !== input.runtimeCode || actualOwner.worker_deployment !== published.input.workerDeployment || actualOwner.worker_client !== published.input.workerClient || actualOwner.generation !== input.generation) fail('published_route_drift')
      return { published: true, replayed: true, revision: Number(row.revision), verified: true }
    }
    if (row.state !== 'prepared') fail('not_prepared')
    const payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json
    if (payload.input.runtimeCode !== input.runtimeCode || payload.input.generation !== input.generation) fail('activation_binding_mismatch')
    const current = await snapshot(tx, payload.input)
    if (digest(current) !== digest(payload.snapshot)) fail('route_drift')
    for (const app of current.apps) {
      await tx.execute('UPDATE deployments SET runtime_endpoint=? WHERE tenant_code=? AND environment=? AND deployment_code=? AND app_code=?', [current.runtime.runtime_endpoint, input.tenantCode, input.environment, app.deployment_code, app.app_code])
    }
    await tx.execute('UPDATE tenant_scheduler_ownership SET storage_mode=\'recovered\',runtime_code=?,worker_deployment=?,worker_client=?,generation=?,revision=revision+1,verification_reference=?,verification_sha256=?,updated_at=UTC_TIMESTAMP(6) WHERE tenant_code=? AND environment=? AND source_app=\'aims\'', [input.runtimeCode, payload.input.workerDeployment, payload.input.workerClient, input.generation, input.recoveryKey, input.activationSha256, input.tenantCode, input.environment])
    await tx.execute('UPDATE enterprise_recovery_routes SET state=\'published\',activation_sha256=?,updated_at=UTC_TIMESTAMP(6) WHERE tenant_code=? AND environment=?', [input.activationSha256, input.tenantCode, input.environment])
    await tx.execute('INSERT INTO enterprise_recovery_route_receipts(tenant_code,request_id,payload_sha256,payload_json,actor_uid) VALUES(?,?,?,?,?)', [input.tenantCode, `${input.recoveryKey}:publish`, digest(input), JSON.stringify(input), `runtime:${input.runtimeCode}`])
    return { published: true, replayed: false, revision: Number(row.revision) }
  })
}
