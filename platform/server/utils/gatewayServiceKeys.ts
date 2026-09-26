import { createHash, timingSafeEqual } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import type { TransactionExecutor } from './db.ts'
import { stableStringifyPolicyPayload } from './policyEnvelopeDelivery.ts'

export const GATEWAY_KEYSET_SCHEMA = 'hzy-gateway-keyset.v1'
export const GATEWAY_KEYSET_MAX_AGE_MS = 300_000
export const GATEWAY_KEY_MAX_LIFETIME_MS = 90 * 86_400_000
export class GatewayKeyRefusal extends Error {
  readonly code: string
  readonly statusCode: number
  constructor(code: string, statusCode = 400) {
    super(code)
    this.code = code
    this.statusCode = statusCode
  }
}
function refuse(code: string, status = 400): never {
  throw new GatewayKeyRefusal(code, status)
}
function identifier(value: unknown, max = 128): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value.length > max) return refuse('gateway_key_binding_invalid')
  return value
}
export function gatewayPublicKey(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return refuse('gateway_public_key_invalid')
  const raw = Buffer.from(value, 'base64url')
  if (raw.length !== 32 || raw.toString('base64url') !== value) return refuse('gateway_public_key_invalid')
  return { publicKey: value, kid: createHash('sha256').update(raw).digest('hex') }
}
export type GatewayKeyCommand = { action: 'register', expectedRevision: number, publicKey: string, notBefore: number, notAfter: number }
  | { action: 'activate' | 'revoke', expectedRevision: number, kid: string }
export function parseGatewayKeyCommand(input: unknown, now: number): GatewayKeyCommand {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return refuse('gateway_key_command_invalid')
  const body = input as Record<string, unknown>
  const fields = body.action === 'register' ? ['action', 'expectedRevision', 'publicKey', 'notBefore', 'notAfter'] : ['action', 'expectedRevision', 'kid']
  if (Object.keys(body).some(key => !fields.includes(key)) || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) return refuse('gateway_key_command_invalid')
  const expectedRevision = Number(body.expectedRevision)
  if (body.action === 'register') {
    const { publicKey } = gatewayPublicKey(body.publicKey)
    const notBefore = Number(body.notBefore), notAfter = Number(body.notAfter)
    if (typeof body.notBefore !== 'number' || typeof body.notAfter !== 'number' || !Number.isSafeInteger(notBefore) || !Number.isSafeInteger(notAfter)
      || notBefore < now || notAfter <= notBefore || notAfter - notBefore > GATEWAY_KEY_MAX_LIFETIME_MS) return refuse('gateway_key_validity_invalid')
    return { action: 'register', expectedRevision, publicKey, notBefore, notAfter }
  }
  if ((body.action !== 'activate' && body.action !== 'revoke') || typeof body.kid !== 'string' || !/^[0-9a-f]{64}$/.test(body.kid)) return refuse('gateway_key_command_invalid')
  return { action: body.action, expectedRevision, kid: body.kid }
}
interface DeploymentRow extends RowDataPacket { id: number, site_code: string, tenant_code: string, environment: string, status: string, public_url: string }
interface RegistryRow extends RowDataPacket { site_id: number, gateway_site_code: string, tenant_code: string, environment: string, revision: number | string }
interface KeyRow extends RowDataPacket { kid: string, public_key: string, status: string, rotation_slot: number, not_before: number | string, not_after: number | string }
async function lockBinding(tx: TransactionExecutor, deploymentCode: string, lock = true) {
  identifier(deploymentCode)
  const deployment = await tx.queryRow<DeploymentRow>(`SELECT id, site_code, tenant_code, environment, status, public_url FROM deployment_sites WHERE BINARY site_code = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [deploymentCode])
  if (!deployment || deployment.status !== 'active') return refuse('gateway_deployment_unavailable', 404)
  identifier(deployment.tenant_code, 64)
  identifier(deployment.environment, 32)
  const registry = await tx.queryRow<RegistryRow>(`SELECT site_id, gateway_site_code, tenant_code, environment, revision FROM platform_gateway_keysets WHERE site_id = ?${lock ? ' FOR UPDATE' : ''}`, [deployment.id])
  if (registry && (registry.gateway_site_code !== deployment.site_code || registry.tenant_code !== deployment.tenant_code || registry.environment !== deployment.environment)) return refuse('gateway_deployment_binding_changed', 409)
  if (registry && (!Number.isSafeInteger(Number(registry.revision)) || Number(registry.revision) < 1)) return refuse('gateway_keyset_revision_invalid', 503)
  return { deployment, registry }
}
async function keyRows(tx: TransactionExecutor, id: number, commandKid?: string, lock = true) {
  // Two live slots plus at most the historical kid being mutated. Rotation
  // history must not turn each keyset pull into an unbounded table transfer.
  return tx.queryRows<KeyRow[]>(`SELECT kid, public_key, status, rotation_slot, not_before, not_after FROM platform_gateway_service_keys WHERE site_id = ? AND (status IN ('next', 'active') OR kid = ?) ORDER BY kid${lock ? ' FOR UPDATE' : ''}`, [id, commandKid ?? ''])
}
// Caller owns the transaction: binding, rotation slots, revision and audit commit together.
export async function mutateGatewayKey(tx: TransactionExecutor, deploymentCode: string, command: GatewayKeyCommand, staff: { uid: string, accountId: number }, now: number) {
  if (!staff.uid || !Number.isSafeInteger(staff.accountId) || staff.accountId < 1) return refuse('gateway_key_staff_required', 403)
  const { deployment, registry } = await lockBinding(tx, deploymentCode)
  const beforeRevision = registry ? Number(registry.revision) : 0
  if (beforeRevision !== command.expectedRevision) return refuse('gateway_key_revision_conflict', 409)
  if (beforeRevision >= Number.MAX_SAFE_INTEGER) return refuse('gateway_keyset_revision_invalid', 503)
  const kid = command.action === 'register' ? gatewayPublicKey(command.publicKey).kid : command.kid
  const rows = registry ? await keyRows(tx, deployment.id, kid) : []
  const existing = rows.find(row => row.kid === kid)
  let status: string
  if (command.action === 'register') {
    if (existing) return refuse(existing.status === 'revoked' ? 'gateway_key_revoked' : 'gateway_key_already_registered', 409)
    if (command.notBefore < now || command.notAfter <= command.notBefore || command.notAfter - command.notBefore > GATEWAY_KEY_MAX_LIFETIME_MS) return refuse('gateway_key_validity_invalid')
    const live = rows.filter(row => row.status === 'active' || row.status === 'next')
    const slot = [1, 2].find(value => !live.some(row => Number(row.rotation_slot) === value))
    if (!slot) return refuse('gateway_key_slots_full', 409)
    if (!registry) await tx.execute(`INSERT INTO platform_gateway_keysets (site_id, gateway_site_code, tenant_code, environment, revision) VALUES (?, ?, ?, ?, 1)`, [deployment.id, deployment.site_code, deployment.tenant_code, deployment.environment])
    await tx.execute(`INSERT INTO platform_gateway_service_keys (site_id, kid, public_key, status, rotation_slot, not_before, not_after, registered_by) VALUES (?, ?, ?, 'next', ?, ?, ?, ?)`, [deployment.id, kid, command.publicKey, slot, command.notBefore, command.notAfter, staff.uid])
    status = 'next'
  } else {
    if (!existing) return refuse('gateway_key_not_found', 404)
    if (existing.status === 'revoked') return refuse('gateway_key_revoked', 409)
    if (command.action === 'activate' && (existing.status !== 'next' || Number(existing.not_before) > now || Number(existing.not_after) <= now)) return refuse('gateway_key_activation_invalid', 409)
    status = command.action === 'activate' ? 'active' : 'revoked'
    await tx.execute(`UPDATE platform_gateway_service_keys SET status = ?, revoked_at = ${status === 'revoked' ? 'UTC_TIMESTAMP(6)' : 'NULL'} WHERE site_id = ? AND kid = ?`, [status, deployment.id, kid])
  }
  const revision = beforeRevision + 1
  if (registry) await tx.execute(`UPDATE platform_gateway_keysets SET revision = ? WHERE site_id = ?`, [revision, deployment.id])
  const result = { gatewayDeployment: deployment.site_code, tenant: deployment.tenant_code, environment: deployment.environment, kid, status, revision }
  await tx.execute(`INSERT INTO platform_audit_logs (operator_account_id, target_type, target_id, target_tenant_code, action, before_json, after_json, source, ip, user_agent, created_at) VALUES (?, 'gateway_service_key', ?, ?, ?, ?, ?, 'platform_admin', NULL, NULL, UTC_TIMESTAMP())`, [staff.accountId, String(deployment.id), deployment.tenant_code, `gateway_key.${command.action}`, JSON.stringify({ revision: beforeRevision, status: existing?.status ?? null }), JSON.stringify(result)])
  return result
}
export async function signedGatewayKeyset(tx: TransactionExecutor, runtimeCode: string, gatewayDeployment: string, controlToken: string, now: number, signer: (data: string) => Promise<{ kid: string, alg: string, signature: string }>) {
  identifier(runtimeCode)
  const runtime = await tx.queryRow<RowDataPacket>(`SELECT runtime_code, tenant_code, environment, status, control_token_hash FROM tenant_runtime_instances WHERE BINARY runtime_code = ? LIMIT 1`, [runtimeCode])
  const hash = createHash('sha256').update(controlToken).digest('hex')
  const stored = Buffer.from(String(runtime?.control_token_hash || ''))
  if (!controlToken.startsWith('hzy_ctl_') || stored.length !== hash.length || !timingSafeEqual(stored, Buffer.from(hash))) return refuse('gateway_keyset_control_invalid', 401)
  if (!runtime || runtime.status !== 'ready') return refuse('gateway_keyset_runtime_not_ready', 503)
  const { deployment, registry } = await lockBinding(tx, gatewayDeployment, false)
  if (runtime.tenant_code !== deployment.tenant_code || runtime.environment !== deployment.environment) return refuse('gateway_keyset_runtime_binding_mismatch', 403)
  if (!registry) return refuse('gateway_keyset_not_registered', 404)
  const rows = (await keyRows(tx, deployment.id, undefined, false)).filter(row => row.status !== 'revoked')
  if (rows.length > 2) return refuse('gateway_keyset_invalid', 503)
  const keys = rows.map((row) => {
    const parsed = gatewayPublicKey(row.public_key)
    const notBefore = Number(row.not_before), notAfter = Number(row.not_after)
    if (parsed.kid !== row.kid || !['next', 'active'].includes(row.status) || !Number.isSafeInteger(notBefore) || !Number.isSafeInteger(notAfter) || notBefore < 0 || notAfter <= notBefore || notAfter - notBefore > GATEWAY_KEY_MAX_LIFETIME_MS) return refuse('gateway_keyset_invalid', 503)
    return { ...parsed, status: row.status, notBefore, notAfter }
  })
  const body = stableStringifyPolicyPayload({ tenant: deployment.tenant_code, environment: deployment.environment, runtimeCode, gatewayDeployment, revision: Number(registry.revision), issuedAt: now, expiresAt: now + GATEWAY_KEYSET_MAX_AGE_MS, keys })
  const signed = await signer(`${GATEWAY_KEYSET_SCHEMA}\n${body}`)
  if (signed.alg !== 'Ed25519' || !signed.kid || !signed.signature) return refuse('gateway_keyset_signing_unavailable', 503)
  return { schema: GATEWAY_KEYSET_SCHEMA, alg: signed.alg, kid: signed.kid, body, signature: signed.signature }
}

// Legacy deploymentCode field carries site_code. Export only after the staff
// checks the exact Worker public host against the active site, never body tenant.
export async function exportGatewayWorkerIdentity(tx: TransactionExecutor, siteCode: string, expectedHost: string) {
  const { deployment } = await lockBinding(tx, siteCode, false)
  let url: URL
  try {
    url = new URL(deployment.public_url)
  } catch {
    return refuse('gateway_site_public_url_invalid')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !expectedHost || expectedHost !== url.hostname) return refuse('gateway_site_host_mismatch', 403)
  return { deploymentCode: deployment.site_code, tenantCode: deployment.tenant_code,
    environment: deployment.environment, publicHost: url.hostname }
}
