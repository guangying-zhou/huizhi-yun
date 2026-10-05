import type { RowDataPacket } from 'mysql2/promise'
import { queryRows, execute } from './db'

interface ParameterRow extends RowDataPacket {
  param_key?: string
  param_value: string
}

export async function getSystemParameter(key: string): Promise<string | null> {
  const rows = await queryRows<ParameterRow[]>(
    'SELECT param_value FROM system_parameters WHERE param_key = ? LIMIT 1',
    [key]
  )
  if (!rows.length) return null
  const first = rows[0] as ParameterRow | undefined
  return first?.param_value ?? null
}

export async function getSystemParameters(keys: string[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {}
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
}
