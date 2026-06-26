import mysql from 'mysql2/promise'
import type { Connection, Pool, PoolConnection, QueryResult, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { useEvent } from 'nitropack/runtime'
import { useRuntimeConfig } from '#imports'

let pool: Pool | null = null
type SqlParam = string | number | boolean | Date | Buffer | null
type DbSslConfig = {
  ca?: string
  rejectUnauthorized?: boolean
}
type Queryable = Pick<PoolConnection, 'query' | 'execute'>
type HyperdriveBinding = {
  host?: string
  port?: number | string
  user?: string
  password?: string
  database?: string
}
type CloudflareEnv = {
  HYPERDRIVE?: HyperdriveBinding
}
type CloudflareRuntimeEvent = {
  context?: {
    cloudflare?: {
      env?: CloudflareEnv
    }
    _platform?: {
      cloudflare?: {
        env?: CloudflareEnv
      }
    }
  }
  req?: {
    runtime?: {
      cloudflare?: {
        env?: CloudflareEnv
      }
    }
  }
}
type CloudflareGlobal = typeof globalThis & {
  __env__?: CloudflareEnv
}
type TransactionExecutor = {
  queryRows: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<T>
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
  execute: <T extends ResultSetHeader>(sql: string, params?: unknown[]) => Promise<T>
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function getHyperdriveBinding() {
  try {
    const event = useEvent() as unknown as CloudflareRuntimeEvent
    const binding = event.context?.cloudflare?.env?.HYPERDRIVE
      || event.context?._platform?.cloudflare?.env?.HYPERDRIVE
      || event.req?.runtime?.cloudflare?.env?.HYPERDRIVE
      || (globalThis as CloudflareGlobal).__env__?.HYPERDRIVE

    return binding?.host && binding.user && binding.database ? binding : null
  } catch {
    return null
  }
}

function createHyperdriveConnection(binding: HyperdriveBinding) {
  return mysql.createConnection({
    host: stringValue(binding.host),
    port: Number(binding.port || 3306),
    user: stringValue(binding.user),
    password: stringValue(binding.password),
    database: stringValue(binding.database),
    timezone: 'Z',
    dateStrings: true,
    disableEval: true
  })
}

function asPoolConnection(connection: Connection): PoolConnection {
  const adapted = connection as unknown as PoolConnection & {
    release?: () => void
  }
  adapted.release = () => {
    void connection.end()
  }
  adapted.execute = adapted.query.bind(adapted) as typeof adapted.execute
  return adapted
}

function createHyperdrivePoolAdapter(binding: HyperdriveBinding): Pool {
  return {
    async query(sql: string, params?: SqlParam[]) {
      const connection = await createHyperdriveConnection(binding)
      try {
        return await connection.query(sql, params)
      } finally {
        await connection.end()
      }
    },
    async execute(sql: string, params?: SqlParam[]) {
      const connection = await createHyperdriveConnection(binding)
      try {
        return await connection.query(sql, params)
      } finally {
        await connection.end()
      }
    },
    async getConnection() {
      const connection = await createHyperdriveConnection(binding)
      return asPoolConnection(connection)
    }
  } as unknown as Pool
}

export function useDbPool(): Pool {
  const hyperdrive = getHyperdriveBinding()
  if (hyperdrive) {
    return createHyperdrivePoolAdapter(hyperdrive)
  }

  if (pool) {
    return pool
  }

  const config = useRuntimeConfig()
  const dbConfig = config.db || {}
  const ssl = resolveDbSslConfig(dbConfig)

  pool = mysql.createPool({
    host: dbConfig.host || '127.0.0.1',
    port: Number(dbConfig.port) || 3306,
    user: dbConfig.user || 'root',
    password: dbConfig.password || '',
    database: dbConfig.name || 'hzy_console',
    waitForConnections: true,
    connectionLimit: Number(dbConfig.connectionLimit) || 10,
    timezone: 'Z',
    dateStrings: true,
    ...(ssl ? { ssl } : {})
  })

  return pool
}

function resolveDbSslConfig(dbConfig: Record<string, unknown>): DbSslConfig | undefined {
  const mode = String(dbConfig.ssl || '').toLowerCase()
  if (!['1', 'true', 'required', 'require'].includes(mode)) return undefined

  const ca = String(dbConfig.sslCa || '').replace(/\\n/g, '\n').trim()
  return {
    ...(ca ? { ca } : {}),
    rejectUnauthorized: dbConfig.sslRejectUnauthorized !== false
  }
}

export async function queryRows<T extends RowDataPacket[]>(sql: string, params: unknown[] = []): Promise<T> {
  const [rows] = await useDbPool().query<T>(sql, params)
  return rows
}

export async function queryRow<T extends RowDataPacket>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await queryRows<T[]>(sql, params)
  return rows[0] || null
}

export async function execute<T extends ResultSetHeader>(sql: string, params: unknown[] = []): Promise<T> {
  const [result] = await useDbPool().execute<QueryResult>(
    sql,
    params as SqlParam[]
  )
  return result as T
}

async function queryRowsWith<T extends RowDataPacket[]>(executor: Queryable, sql: string, params: unknown[] = []): Promise<T> {
  const [rows] = await executor.query<T>(sql, params)
  return rows
}

async function queryRowWith<T extends RowDataPacket>(executor: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await queryRowsWith<T[]>(executor, sql, params)
  return rows[0] || null
}

async function executeWith<T extends ResultSetHeader>(executor: Queryable, sql: string, params: unknown[] = []): Promise<T> {
  const [result] = await executor.execute<QueryResult>(
    sql,
    params as (string | number | boolean | null)[]
  )
  return result as T
}

export async function withTransaction<T>(handler: (tx: TransactionExecutor) => Promise<T>): Promise<T> {
  const connection = await useDbPool().getConnection()

  try {
    await connection.beginTransaction()
    const result = await handler({
      queryRows: <R extends RowDataPacket[]>(sql: string, params: unknown[] = []) => queryRowsWith<R>(connection, sql, params),
      queryRow: <R extends RowDataPacket>(sql: string, params: unknown[] = []) => queryRowWith<R>(connection, sql, params),
      execute: <R extends ResultSetHeader>(sql: string, params: unknown[] = []) => executeWith<R>(connection, sql, params)
    })
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}
