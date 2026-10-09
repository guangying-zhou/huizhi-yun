import type { RowDataPacket } from 'mysql2/promise'
import { queryRows, execute } from './db'

interface ParameterRow extends RowDataPacket {
  param_key?: string
  param_value: string
}

const CACHE_TTL_MS = 60_000
let cachedYear: number | null = null
let cacheExpiresAt = 0

function parseYear(raw: string | null | undefined): number | null {
  if (!raw) {
    return null
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    return null
  }
  return parsed
}

export async function getSystemParameter(key: string): Promise<string | null> {
  const rows = await queryRows<ParameterRow[]>(
    'SELECT param_value FROM system_parameters WHERE param_key = ? LIMIT 1',
    [key]
  )
  if (!rows.length) {
    return null
  }
  // rows[0] 在类型上可能是 undefined（尽管前面 length 已判断），加一层安全保护
  const first = rows[0] as ParameterRow | undefined
  return first?.param_value ?? null
}

export async function getSystemParameters(keys: string[]): Promise<Record<string, string>> {
  if (keys.length === 0) {
    return {}
  }
  const placeholders = keys.map(() => '?').join(',')
  const rows = await queryRows<ParameterRow[]>(
    `SELECT param_key, param_value FROM system_parameters WHERE param_key IN (${placeholders})`,
    keys
  )

  const result: Record<string, string> = {}
  rows.forEach((row) => {
    if (row.param_key) {
      result[row.param_key] = row.param_value
    }
  })
  return result
}

export async function setSystemParameter(key: string, value: string): Promise<void> {
  await execute(
    'INSERT INTO system_parameters (param_key, param_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE param_value = VALUES(param_value)',
    [key, value]
  )

  // Invalidate cache if needed
  if (key === 'commit_year') {
    cachedYear = parseYear(value)
    cacheExpiresAt = Date.now() + CACHE_TTL_MS
  }
}

export async function getDefaultCommitYear(): Promise<number | null> {
  const now = Date.now()
  if (cacheExpiresAt > now) {
    return cachedYear
  }

  const value = await getSystemParameter('commit_year')
  cachedYear = parseYear(value)
  cacheExpiresAt = now + CACHE_TTL_MS
  return cachedYear
}

export function getFallbackCommitYear(): number {
  return new Date().getFullYear()
}

export async function getIngestionCompleted(): Promise<boolean> {
  const value = await getSystemParameter('ingestion_completed')
  if (!value) {
    return false
  }
  return value === 'true'
}
