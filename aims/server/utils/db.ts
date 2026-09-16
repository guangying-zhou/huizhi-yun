import { createError } from 'h3'

type SqlParam = unknown

/* eslint-disable @typescript-eslint/no-explicit-any -- Mirrors legacy RowDataPacket shape for disabled DB paths. */
export interface RowDataPacket {
  [column: string]: any
  [column: number]: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface ResultSetHeader {
  affectedRows: number
  insertId: number
  changedRows?: number
}

export interface PoolConnection {
  query<T = unknown>(sql: string, params?: SqlParam): Promise<[T, unknown]>
  execute<T = unknown>(sql: string, params?: SqlParam): Promise<[T, unknown]>
  beginTransaction(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
  release(): void
}

export interface Pool {
  query<T = unknown>(sql: string, params?: SqlParam): Promise<[T, unknown]>
  execute<T = unknown>(sql: string, params?: SqlParam): Promise<[T, unknown]>
  getConnection(): Promise<PoolConnection>
  end(): Promise<void>
}

function directDbDisabled(): never {
  throw createError({
    statusCode: 500,
    message: 'Aims direct DB access is disabled. Route database operations through tenant-runtime/data-runtime.'
  })
}

export function useDbPool(): Pool {
  return directDbDisabled()
}

export async function queryRows<T extends RowDataPacket[]>(_sql: string, _params: SqlParam[] = []): Promise<T> {
  return directDbDisabled()
}

export async function queryRow<T extends RowDataPacket>(_sql: string, _params: SqlParam[] = []): Promise<T | null> {
  return directDbDisabled()
}

export async function execute<T extends ResultSetHeader>(_sql: string, _params: SqlParam[] = []): Promise<T> {
  return directDbDisabled()
}

export async function withTransaction<T>(_handler: (connection: PoolConnection) => Promise<T>): Promise<T> {
  return directDbDisabled()
}
