import mysql from 'mysql2/promise'
import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { useRuntimeConfig } from '#imports'

interface DbConfig {
  host?: string
  port?: number | string
  user?: string
  password?: string
  name?: string
  connectionLimit?: number | string
}

let pool: Pool | null = null

export function useDbPool(): Pool {
  if (pool) {
    return pool
  }

  const config = useRuntimeConfig()
  const dbConfig = (config.db || {}) as DbConfig

  pool = mysql.createPool({
    host: dbConfig.host || '127.0.0.1',
    port: Number(dbConfig.port) || 3306,
    user: dbConfig.user || 'root',
    password: dbConfig.password || '',
    database: dbConfig.name || 'hzy_repoinsight',
    waitForConnections: true,
    connectionLimit: Number(dbConfig.connectionLimit) || 10,
    timezone: 'Z',
    dateStrings: true
  })

  return pool
}

export async function queryRows<T extends RowDataPacket[]>(sql: string, params: unknown[] = []): Promise<T> {
  const [rows] = await useDbPool().query<T>(sql, params as never)
  return rows
}

export async function queryRow<T extends RowDataPacket>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await queryRows<T[]>(sql, params)
  return rows[0] || null
}

export async function execute<T extends ResultSetHeader>(sql: string, params: unknown[] = []): Promise<T> {
  const [result] = await useDbPool().execute<T>(sql, params as never)
  return result
}
