// No deployment or signing. DB credentials are read from a private config file, never argv/output.
import { readFile, open, stat } from 'node:fs/promises'
import mysql, { type RowDataPacket, type ResultSetHeader } from 'mysql2/promise'
import { planMigrationBaselines, registerMigrationBaselines } from '../server/utils/migrationBaselineReleases.ts'
import type { PinQueries } from '../server/utils/environmentAppReleases.ts'

const args = process.argv.slice(2)
function arg(name: string) {
  const i = args.indexOf(name)
  return i < 0 ? '' : args[i + 1] || ''
}
const mode = args[0]
if (!['plan', 'apply'].includes(mode || '')) throw Error('Usage: plan|apply --db-config <0600 file> --tenant <code> --environment <env> --bundle <id> --output <path>; apply additionally requires --review-hash --actor --reason')
const input = { tenant: arg('--tenant'), environment: arg('--environment'), bundleId: Number(arg('--bundle')) }
if (!input.tenant || !['prod', 'test', 'dev'].includes(input.environment) || !Number.isSafeInteger(input.bundleId) || input.bundleId <= 0 || !arg('--output')) throw Error('Invalid input')
let conn: mysql.Connection | undefined
let output: Awaited<ReturnType<typeof open>> | undefined
let committed = false
try {
  const path = arg('--db-config')
  if ((await stat(path)).mode & 0o077) throw Error('DB config must be private (0600)')
  if (mode === 'apply' && (!/^[a-f0-9]{64}$/.test(arg('--review-hash')) || !arg('--actor') || !arg('--reason'))) throw Error('Apply requires reviewed hash, actor and reason')
  // Reserve the report before any mutation. Never overwrite an earlier review or private config.
  output = await open(arg('--output'), 'wx', 0o600)
  const connection = await mysql.createConnection(JSON.parse(await readFile(path, 'utf8')))
  conn = connection
  const q: PinQueries = {
    queryRows: async<T extends RowDataPacket[]>(sql: string, params: unknown[] = []) => (await connection.query<T>(sql, params))[0],
    queryRow: async<T extends RowDataPacket>(sql: string, params: unknown[] = []) => (await connection.query<T[]>(sql, params))[0][0] || null
  }
  let result
  if (mode === 'plan') {
    const plan = await planMigrationBaselines(q, input)
    result = { entries: plan.entries, reviewHash: plan.reviewHash, sourceBundleHash: plan.source.bundle_hash }
  } else {
    await connection.beginTransaction()
    result = await registerMigrationBaselines({ ...q, execute: async<T extends ResultSetHeader>(sql: string, params: unknown[] = []) => (await connection.execute<T>(sql, params))[0] }, { ...input, reviewHash: arg('--review-hash'), actor: arg('--actor'), reason: arg('--reason') })
    await connection.commit()
    committed = true
  }
  await output.writeFile(JSON.stringify(result, null, 2) + '\n')
  console.log('Baseline operation completed; private metadata report written.')
} catch {
  await conn?.rollback().catch(() => {})
  // Driver/config errors may contain secrets. Commit transport failure can have an unknown outcome.
  console.error(committed
    ? 'Baseline committed but report failed. Re-plan and replay idempotently to recover the receipt.'
    : 'Baseline operation failed. Re-plan before retry; an interrupted commit may have succeeded. Idempotent replay is safe.')
  process.exitCode = 1
} finally {
  await output?.close().catch(() => {})
  await conn?.end().catch(() => {})
}
