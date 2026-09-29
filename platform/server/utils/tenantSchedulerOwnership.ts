import { createHash } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { queryRow, withTransaction, type TransactionExecutor } from './db.ts'

type OwnershipRow = RowDataPacket & { tenant_code: string, environment: string, source_app: string, storage_mode: string, runtime_code: string, worker_deployment: string, worker_client: string, generation: string, revision: number }
export type SchedulerOwnershipInput = {
  storage: 'unified' | 'disabled'
  tenantCode: string
  environment: 'test' | 'prod'
  runtimeCode: string
  workerDeployment: string
  workerClient: 'aims.runtime'
  generation: string
  expectedRevision: number
  requestId: string
  verificationReference: string
  verificationSha256: string
  actorUid: string
  verificationMethod: 'operator-attested'
}
export function normalizeSchedulerOwnership(input: SchedulerOwnershipInput) {
  const text = (value: unknown, max = 128) => {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max || [...value].some(character => character.charCodeAt(0) < 32)) throw new Error('scheduler_ownership_input_invalid')
    return value
  }
  if (!['unified', 'disabled'].includes(input.storage) || !['test', 'prod'].includes(input.environment) || input.workerClient !== 'aims.runtime' || input.verificationMethod !== 'operator-attested') throw new Error('scheduler_ownership_input_invalid')
  if (typeof input.generation !== 'string' || !/^[1-9]\d{0,19}$/.test(input.generation) || BigInt(input.generation) > 18446744073709551615n) throw new Error('scheduler_ownership_generation_invalid')
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision >= Number.MAX_SAFE_INTEGER || !/^[a-f0-9]{64}$/.test(input.verificationSha256)) throw new Error('scheduler_ownership_evidence_invalid')
  return {
    storage: input.storage, tenantCode: text(input.tenantCode, 64), environment: input.environment, sourceApp: 'aims',
    runtimeCode: text(input.runtimeCode), workerDeployment: text(input.workerDeployment), workerClient: input.workerClient,
    generation: input.generation, expectedRevision: input.expectedRevision, requestId: text(input.requestId),
    verificationReference: text(input.verificationReference, 500), verificationSha256: input.verificationSha256,
    verificationMethod: input.verificationMethod, actorUid: text(input.actorUid)
  }
}
export async function readSchedulerOwnership(tenantCode: string, environment: string) {
  // Missing ledger is a deployment/schema fault, not proof of legacy ownership.
  return queryRow<OwnershipRow>('SELECT *, CAST(generation AS CHAR) AS generation FROM tenant_scheduler_ownership WHERE tenant_code=? AND environment=? AND source_app=\'aims\'', [tenantCode, environment])
}

export function schedulerOwnershipSelection(record: OwnershipRow | null, runtime: { runtime_code: string, status: string } | null, workerDeployment: string | undefined) {
  if (!record) return null
  const valid = runtime?.status === 'ready' && runtime.runtime_code === record.runtime_code && workerDeployment === record.worker_deployment && record.worker_client === 'aims.runtime' && record.source_app === 'aims'
  const generation = String(record.generation)
  if (!/^[1-9]\d{0,19}$/.test(generation) || BigInt(generation) > 18446744073709551615n) throw new Error('scheduler_ownership_corrupt_generation')
  return { storage: valid && ['unified', 'recovered'].includes(record.storage_mode) ? record.storage_mode as 'unified' | 'recovered' : 'disabled' as const, generation }
}
export async function registerSchedulerOwnership(input: SchedulerOwnershipInput, apply = false, transaction: typeof withTransaction = withTransaction) {
  const value = normalizeSchedulerOwnership(input)
  const payload = JSON.stringify(value)
  const hash = createHash('sha256').update(payload).digest('hex')
  if (!apply) return { applied: false, plan: value, payloadSha256: hash, verification: 'operator attestation required; reference/hash are not automatic Runtime verification' }
  return transaction(async (tx: TransactionExecutor) => {
    const tenant = await tx.queryRow<RowDataPacket>('SELECT tenant_code FROM tenants WHERE tenant_code=? FOR UPDATE', [value.tenantCode])
    if (!tenant) throw new Error('scheduler_ownership_tenant_missing')
    const receipt = await tx.queryRow<RowDataPacket & { payload_sha256: string, revision: number }>('SELECT payload_sha256,revision FROM tenant_scheduler_ownership_receipts WHERE tenant_code=? AND request_id=?', [value.tenantCode, value.requestId])
    if (receipt) {
      if (receipt.payload_sha256 !== hash) throw new Error('scheduler_ownership_replay_conflict')
      return { applied: true, replayed: true, revision: Number(receipt.revision), payloadSha256: hash }
    }
    const old = await tx.queryRow<OwnershipRow>('SELECT *,CAST(generation AS CHAR) AS generation FROM tenant_scheduler_ownership WHERE tenant_code=? AND environment=? AND source_app=\'aims\' FOR UPDATE', [value.tenantCode, value.environment])
    const runtime = await tx.queryRow<RowDataPacket>('SELECT runtime_code FROM tenant_runtime_instances WHERE tenant_code=? AND environment=? AND runtime_code=? AND status=\'ready\' FOR UPDATE', [value.tenantCode, value.environment, value.runtimeCode])
    const workers = await tx.queryRows<RowDataPacket[]>('SELECT deployment_code FROM deployments WHERE tenant_code=? AND environment=? AND app_code=\'aims\' AND status=\'active\' FOR UPDATE', [value.tenantCode, value.environment])
    if (value.storage === 'unified' && (!runtime || workers.length !== 1 || workers[0]?.deployment_code !== value.workerDeployment)) throw new Error('scheduler_ownership_binding_conflict')
    if (value.storage === 'disabled' && (!old || old.runtime_code !== value.runtimeCode || old.worker_deployment !== value.workerDeployment || old.worker_client !== value.workerClient || String(old.generation) !== value.generation)) throw new Error('scheduler_ownership_disable_binding_conflict')

    if (Number(old?.revision || 0) !== value.expectedRevision) throw new Error('scheduler_ownership_revision_conflict')
    if (old && (BigInt(value.generation) < BigInt(old.generation) || (value.storage === 'unified' && BigInt(value.generation) === BigInt(old.generation)))) throw new Error('scheduler_ownership_generation_must_increase')
    const revision = value.expectedRevision + 1
    await tx.execute(`INSERT INTO tenant_scheduler_ownership(tenant_code,environment,source_app,storage_mode,runtime_code,worker_deployment,worker_client,generation,revision,verification_reference,verification_sha256,actor_uid,request_id) VALUES(?,?,'aims',?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE storage_mode=VALUES(storage_mode),runtime_code=VALUES(runtime_code),worker_deployment=VALUES(worker_deployment),worker_client=VALUES(worker_client),generation=VALUES(generation),revision=VALUES(revision),verification_reference=VALUES(verification_reference),verification_sha256=VALUES(verification_sha256),actor_uid=VALUES(actor_uid),request_id=VALUES(request_id),updated_at=UTC_TIMESTAMP(6)`, [value.tenantCode, value.environment, value.storage, value.runtimeCode, value.workerDeployment, value.workerClient, value.generation, revision, value.verificationReference, value.verificationSha256, value.actorUid, value.requestId])
    await tx.execute('INSERT INTO tenant_scheduler_ownership_receipts(tenant_code,request_id,payload_sha256,payload_json,revision,actor_uid) VALUES(?,?,?,?,?,?)', [value.tenantCode, value.requestId, hash, payload, revision, value.actorUid])
    return { applied: true, replayed: false, revision, payloadSha256: hash }
  })
}
