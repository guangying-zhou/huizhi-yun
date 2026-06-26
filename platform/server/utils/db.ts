import mysql from 'mysql2/promise'
import type { Connection, Pool, PoolConnection, PoolOptions, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { useRuntimeConfig } from '#imports'

let localPool: Pool | null = null
type CloudflareHyperdrive = {
  host: string
  port: number
  user: string
  password: string
  database: string
}
type CloudflareRuntimeEnv = {
  HYPERDRIVE?: CloudflareHyperdrive
}
type ExecuteParams = Parameters<Pool['execute']>[1]
type DbConnection = Connection | PoolConnection
type Queryable = Pick<DbConnection | Pool, 'query' | 'execute'>
type TransactionExecutor = {
  queryRows: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<T>
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
  execute: <T extends ResultSetHeader>(sql: string, params?: unknown[]) => Promise<T>
}

declare global {
  var __hzyCloudflareEnv: CloudflareRuntimeEnv | undefined
}

export function useDbPool(): Pool {
  if (localPool) {
    return localPool
  }

  const dbConfig = useRuntimeConfig().db || {}

  localPool = mysql.createPool({
    host: dbConfig.host || '127.0.0.1',
    port: Number(dbConfig.port) || 3306,
    user: dbConfig.user || 'root',
    password: dbConfig.password || '',
    database: dbConfig.name || 'hzy_platform',
    waitForConnections: true,
    connectionLimit: Number(dbConfig.connectionLimit) || 10,
    timezone: 'Z',
    dateStrings: true,
    disableEval: true
  })

  return localPool
}

function getHyperdrive() {
  return globalThis.__hzyCloudflareEnv?.HYPERDRIVE
}

function createHyperdriveConnectionOptions(hyperdrive: CloudflareHyperdrive): PoolOptions {
  return {
    host: hyperdrive.host,
    port: Number(hyperdrive.port) || 3306,
    user: hyperdrive.user,
    password: hyperdrive.password,
    database: hyperdrive.database,
    timezone: 'Z',
    dateStrings: true,
    disableEval: true
  }
}

async function createHyperdriveConnection(hyperdrive: CloudflareHyperdrive) {
  return await mysql.createConnection(createHyperdriveConnectionOptions(hyperdrive))
}

export async function queryRows<T extends RowDataPacket[]>(sql: string, params: unknown[] = []): Promise<T> {
  const hyperdrive = getHyperdrive()
  if (!hyperdrive) {
    const [rows] = await useDbPool().query<T>(sql, params)
    return rows
  }

  const connection = await createHyperdriveConnection(hyperdrive)
  try {
    return await queryRowsWith<T>(connection, sql, params)
  } finally {
    await connection.end()
  }
}

export async function queryRow<T extends RowDataPacket>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await queryRows<T[]>(sql, params)
  return rows[0] || null
}

export async function execute<T extends ResultSetHeader>(sql: string, params: unknown[] = []): Promise<T> {
  const hyperdrive = getHyperdrive()
  if (!hyperdrive) {
    const [result] = await useDbPool().execute<T>(sql, params as ExecuteParams)
    return result
  }

  const connection = await createHyperdriveConnection(hyperdrive)
  try {
    return await executeQueryWith<T>(connection, sql, params)
  } finally {
    await connection.end()
  }
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
  const [result] = await executor.execute<T>(sql, params as ExecuteParams)
  return result
}

async function executeQueryWith<T extends ResultSetHeader>(executor: Queryable, sql: string, params: unknown[] = []): Promise<T> {
  const [result] = await executor.query<T>(sql, params)
  return result
}

export async function withTransaction<T>(handler: (tx: TransactionExecutor) => Promise<T>): Promise<T> {
  const hyperdrive = getHyperdrive()
  const connection = hyperdrive
    ? await createHyperdriveConnection(hyperdrive)
    : await useDbPool().getConnection()

  try {
    await connection.beginTransaction()

    const result = await handler({
      queryRows: <R extends RowDataPacket[]>(sql: string, params: unknown[] = []) => queryRowsWith<R>(connection, sql, params),
      queryRow: <R extends RowDataPacket>(sql: string, params: unknown[] = []) => queryRowWith<R>(connection, sql, params),
      execute: <R extends ResultSetHeader>(sql: string, params: unknown[] = []) => hyperdrive
        ? executeQueryWith<R>(connection, sql, params)
        : executeWith<R>(connection, sql, params)
    })

    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    if (hyperdrive) {
      await connection.end()
    } else {
      const pooledConnection = connection as PoolConnection
      pooledConnection.release()
    }
  }
}
