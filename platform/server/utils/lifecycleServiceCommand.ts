import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createError, getHeader, type H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { TransactionExecutor } from './db'
import { syncPeoplePositionAuthorization } from './peoplePositionAuthorization'
import { revokeUserAuthorizationForOffboarding } from './offboardingAuthorization'
import { decideLifecycleRevision } from './lifecycleRevisionDecision'

type Row = Record<string, unknown>
type Kind = 'employment' | 'offboarding'
interface ReceiptRow extends RowDataPacket { receipt_id: string, command_sha256: string, status: string, target_biz_type: string | null, target_biz_code: string | null, response_summary_sha256: string | null }
interface VersionRow extends RowDataPacket { applied_revision: number, snapshot_hash: string, lifecycle_type: string }
interface CountRow extends RowDataPacket { total: number }
const contract = {
  employment: { code: 'console.platform.employment-sync.v1', capability: 'platform:employment-authorization:sync' },
  offboarding: { code: 'console.platform.offboarding-revoke.v1', capability: 'platform:offboarding-authorization:revoke' }
} as const
const text = (value: unknown) => String(value || '').trim()
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as Row).sort().map(k => [k, canonical((value as Row)[k])]))
  return value
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')

export function trustedPlatformLifecycleBinding(event: H3Event, envelope: Row) {
  const command = record(envelope.command)
  const operationId = text(envelope.operationId)
  const commandHash = text(envelope.commandSha256)
  const tenant = text(getHeader(event, 'x-hzy-tenant'))
  const deployment = text(getHeader(event, 'x-hzy-service-command-source-deployment'))
  const targetDeployment = text(getHeader(event, 'x-hzy-service-command-target-deployment'))
  const timestamp = text(getHeader(event, 'x-hzy-service-command-timestamp'))
  const signature = text(getHeader(event, 'x-hzy-service-command-signature'))
  const bearer = text(getHeader(event, 'authorization')).replace(/^Bearer\s+/i, '')
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp))
  if (!tenant || !deployment || deployment !== text(envelope.sourceDeployment) || text(envelope.sourceApp) !== 'console' || targetDeployment !== 'platform-control-plane' || targetDeployment !== text(envelope.targetDeployment) || !bearer || !signature || !Number.isFinite(age) || age > 60) throw createError({ statusCode: 403, message: 'trusted lifecycle binding is missing or expired' })
  const path = event.path.split('?')[0] || ''
  const message = `POST\n${path}\n${tenant}\n${deployment}\n${targetDeployment}\nconsole\nplatform\n${operationId}\n${text(envelope.operationCode)}\n${text(envelope.requiredCapability)}\n${text(envelope.idempotencyKey)}\n${text(envelope.commandSchemaVersion)}\n${commandHash}\n${text(command.originalActorUid)}\n${timestamp}`
  const expected = createHmac('sha256', bearer).update(message).digest()
  const supplied = Buffer.from(signature, 'hex')
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw createError({ statusCode: 403, message: 'trusted lifecycle binding signature mismatch' })
  return { tenant, deployment }
}

export async function executePlatformLifecycleCommand(tx: TransactionExecutor, raw: unknown, kind: Kind, routeUid: string, binding: { tenant: string, deployment: string }) {
  const envelope = record(record(raw).serviceCommand)
  const command = record(envelope.command)
  const expected = contract[kind]
  const operationId = text(envelope.operationId)
  const commandHash = text(envelope.commandSha256)
  const uid = text(command.employeeUid)
  const revision = Number(command.sourceRevision)
  const snapshotHash = text(command.snapshotHash)
  if (uid !== routeUid || text(envelope.targetApp) !== 'platform' || text(envelope.operationCode) !== expected.code || text(envelope.requiredCapability) !== expected.capability || text(envelope.commandSchemaVersion) !== 'v1' || revision <= 0 || !/^[a-f0-9]{64}$/.test(snapshotHash) || digest(command) !== commandHash) throw createError({ statusCode: 409, statusMessage: 'idempotency_payload_mismatch', message: 'Platform lifecycle command mismatch' })
  const deployment = await tx.queryRow<CountRow>(`SELECT COUNT(*) AS total FROM deployments WHERE tenant_code=? AND deployment_code=? AND app_code='console' AND status='active'`, [binding.tenant, binding.deployment])
  if (!Number(deployment?.total || 0)) throw createError({ statusCode: 403, message: 'Console deployment binding is invalid' })
  const receiptId = randomUUID()
  const key = text(envelope.idempotencyKey)
  const inserted = await tx.execute<ResultSetHeader>(`INSERT IGNORE INTO service_command_receipt (receipt_id,operation_id,operation_code,tenant_code,source_deployment_code,deployment_code,source_app,target_app,required_capability,idempotency_key,command_schema_version,command_sha256,status,received_at,last_received_at,created_at,updated_at) VALUES (?,?,?,?,?,?,'console','platform',?,?,'v1',?,'processing',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, [receiptId, operationId, expected.code, binding.tenant, binding.deployment, 'platform-control-plane', expected.capability, key, commandHash])
  if (!inserted.affectedRows) {
    const old = await tx.queryRow<ReceiptRow>(`SELECT receipt_id,command_sha256,status,target_biz_type,target_biz_code,response_summary_sha256 FROM service_command_receipt WHERE tenant_code=? AND source_deployment_code=? AND source_app='console' AND operation_code=? AND idempotency_key=? FOR UPDATE`, [binding.tenant, binding.deployment, expected.code, key])
    if (!old || old.command_sha256 !== commandHash) throw createError({ statusCode: 409, statusMessage: 'idempotency_payload_mismatch', message: 'same Platform lifecycle key has different payload' })
    if (old.status !== 'succeeded') throw createError({ statusCode: 409, statusMessage: 'service_command_in_progress' })
    return response(old, envelope, true, {})
  }
  await tx.execute<ResultSetHeader>(`INSERT IGNORE INTO platform_lifecycle_scope_versions (tenant_code,employee_uid,applied_revision,snapshot_hash,lifecycle_type) VALUES (?,?,0,REPEAT('0',64),'none')`, [binding.tenant, uid])
  const watermark = await tx.queryRow<VersionRow>(`SELECT applied_revision,snapshot_hash,lifecycle_type FROM platform_lifecycle_scope_versions WHERE tenant_code=? AND employee_uid=? FOR UPDATE`, [binding.tenant, uid])
  if (!watermark) throw new Error('Platform lifecycle watermark unavailable')
  const revisionDecision = decideLifecycleRevision(Number(watermark.applied_revision), watermark.snapshot_hash, revision, snapshotHash)
  if (revisionDecision === 'stale') return await finish(tx, receiptId, envelope, uid, { staleSkipped: true, appliedRevision: Number(watermark.applied_revision) })
  if (revisionDecision === 'idempotent') return await finish(tx, receiptId, envelope, uid, { idempotent: true })
  const input = { tenantCode: binding.tenant, uid, sourceApp: 'people', positionCode: text(command.positionCode), positionName: text(command.positionName), deptCode: text(command.deptCode), operatorUid: text(command.originalActorUid) || null, reason: `trusted_console_${kind}`, idempotencyKey: key }
  const result = kind === 'employment' ? await syncPeoplePositionAuthorization(tx, input) : await revokeUserAuthorizationForOffboarding(tx, input)
  await tx.execute<ResultSetHeader>(`UPDATE platform_lifecycle_scope_versions SET applied_revision=?,snapshot_hash=?,lifecycle_type=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_code=? AND employee_uid=?`, [revision, snapshotHash, kind, binding.tenant, uid])
  return await finish(tx, receiptId, envelope, uid, result as Row)
}
async function finish(tx: TransactionExecutor, receiptId: string, envelope: Row, uid: string, result: Row) {
  const summary = digest({ targetBizType: 'authorization_subject', targetBizCode: uid })
  await tx.execute<ResultSetHeader>(`UPDATE service_command_receipt SET status='succeeded',target_biz_type='authorization_subject',target_biz_code=?,response_http_status=200,response_summary_sha256=?,completed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE receipt_id=?`, [uid, summary, receiptId])
  return response({ receipt_id: receiptId, command_sha256: text(envelope.commandSha256), status: 'succeeded', target_biz_type: 'authorization_subject', target_biz_code: uid, response_summary_sha256: summary } as ReceiptRow, envelope, false, result)
}

function response(row: ReceiptRow, envelope: Row, idempotent: boolean, result: Row) {
  return { receiptId: row.receipt_id, receiptStatus: 'succeeded', operationId: text(envelope.operationId), operationCode: text(envelope.operationCode), idempotencyKey: text(envelope.idempotencyKey), commandSchemaVersion: 'v1', commandSha256: row.command_sha256, idempotent, targetBizType: row.target_biz_type, targetBizCode: row.target_biz_code, responseSummarySha256: row.response_summary_sha256, result }
}
