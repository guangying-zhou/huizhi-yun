import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { POLICY_SERVICE_KEY_ID, policyServiceKeyId, type PolicyServiceKey } from '../../packages/authz-core/src/policy-envelope.ts'

// Registration needs only the Platform internal credential (user decision
// 2026-09-22: no manual approval). Keys are bounded instead: 90-day lifetime,
// at most two active per deployment, revoked kids never come back.
export const CONSOLE_SERVICE_KEY_LIFETIME_MS = 90 * 86_400_000
export const CONSOLE_SERVICE_KEY_MAX_ACTIVE = 2

export interface ConsoleServiceKeyExecutor {
  queryRows: <R extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<R>
  execute: <R extends ResultSetHeader>(sql: string, params?: unknown[]) => Promise<R>
}
type Binding = { tenant: string, environment: string, deployment: string }
interface KeyRow extends RowDataPacket {
  kid: string
  public_key: string
  status: string
  not_after: number | string
}

export class ConsoleServiceKeyRefusal extends Error {
  readonly code: 'console_service_key_invalid' | 'console_service_key_revoked'
  constructor(code: 'console_service_key_invalid' | 'console_service_key_revoked') {
    super(code)
    this.code = code
  }
}

export function parseConsoleServicePublicKey(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new ConsoleServiceKeyRefusal('console_service_key_invalid')
  const raw = Buffer.from(value, 'base64url')
  if (raw.length !== 32 || raw.toString('base64url') !== value) throw new ConsoleServiceKeyRefusal('console_service_key_invalid')
  return { publicKey: value, kid: policyServiceKeyId(value) }
}

// Caller holds a transaction; the active rows are locked while deciding.
export async function registerConsoleServiceKey(tx: ConsoleServiceKeyExecutor, binding: Binding, publicKeyInput: unknown, now: number) {
  const { publicKey, kid } = parseConsoleServicePublicKey(publicKeyInput)
  const rows = await tx.queryRows<KeyRow[]>(
    `SELECT kid, public_key, status, not_after FROM console_service_keys
      WHERE tenant_code = ? AND environment = ? AND deployment_code = ?
      ORDER BY registered_at DESC, kid FOR UPDATE`,
    [binding.tenant, binding.environment, binding.deployment])
  const existing = rows.find(row => row.kid === kid)
  if (existing && (existing.status !== 'active' || existing.public_key !== publicKey)) throw new ConsoleServiceKeyRefusal('console_service_key_revoked')
  const notAfter = now + CONSOLE_SERVICE_KEY_LIFETIME_MS
  if (existing) {
    await tx.execute(`UPDATE console_service_keys SET not_after = GREATEST(not_after, ?)
      WHERE tenant_code = ? AND environment = ? AND deployment_code = ? AND kid = ?`,
    [notAfter, binding.tenant, binding.environment, binding.deployment, kid])
  } else {
    await tx.execute(`INSERT INTO console_service_keys (tenant_code, environment, deployment_code, kid, public_key, status, not_after)
      VALUES (?, ?, ?, ?, ?, 'active', ?)`, [binding.tenant, binding.environment, binding.deployment, kid, publicKey, notAfter])
  }
  // Newest first: keep the new key and the most recent other active one.
  const others = rows.filter(row => row.kid !== kid && row.status === 'active' && Number(row.not_after) > now)
  for (const row of others.slice(CONSOLE_SERVICE_KEY_MAX_ACTIVE - 1)) {
    await tx.execute(`UPDATE console_service_keys SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP(6)
      WHERE tenant_code = ? AND environment = ? AND deployment_code = ? AND kid = ? AND status = 'active'`,
    [binding.tenant, binding.environment, binding.deployment, row.kid])
  }
  return { kid, notAfter: existing ? Math.max(Number(existing.not_after), notAfter) : notAfter }
}

// Keys signed into the deployment's envelope. Before the migration there are none.
export async function activeConsoleServiceKeys(queryRows: ConsoleServiceKeyExecutor['queryRows'], binding: Binding, now: number): Promise<PolicyServiceKey[]> {
  let rows: KeyRow[]
  try {
    rows = await queryRows<KeyRow[]>(
      `SELECT kid, public_key, status, not_after FROM console_service_keys
        WHERE tenant_code = ? AND environment = ? AND deployment_code = ? AND status = 'active' AND not_after > ?
        ORDER BY registered_at DESC, kid LIMIT ?`,
      [binding.tenant, binding.environment, binding.deployment, now, CONSOLE_SERVICE_KEY_MAX_ACTIVE])
  } catch (error) {
    if ((error as { code?: string })?.code === 'ER_NO_SUCH_TABLE') return []
    throw error
  }
  return rows.flatMap((row) => {
    const notAfter = Number(row.not_after)
    // A row that does not match its own derived kid is ignored, never signed.
    if (!POLICY_SERVICE_KEY_ID.test(row.kid) || policyServiceKeyId(row.public_key) !== row.kid || !Number.isSafeInteger(notAfter)) return []
    return [{ deployment: binding.deployment, kid: row.kid, publicKey: row.public_key, notAfter }]
  })
}
