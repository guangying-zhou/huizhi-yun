#!/usr/bin/env node

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import mysql from 'mysql2/promise'

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const value = argv[index + 1]
    args[item.slice(2)] = value && !value.startsWith('--') ? value : true
    if (args[item.slice(2)] !== true) index += 1
  }
  return args
}

function parseEnv(content) {
  return Object.fromEntries(content.split(/\r?\n/).flatMap((rawLine) => {
    const line = rawLine.trim().replace(/^export\s+/, '')
    if (!line || line.startsWith('#')) return []
    const separator = line.indexOf('=')
    if (separator <= 0) return []
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1)
    return [[line.slice(0, separator).trim(), value]]
  }))
}

async function tableSnapshot(connection, tableName) {
  const [present] = await connection.execute(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [tableName]
  )
  if (!present[0]) return { present: false, create: null, rows: [] }
  const [createRows] = await connection.query(`SHOW CREATE TABLE \`${tableName}\``)
  const [rows] = await connection.query(`SELECT * FROM \`${tableName}\``)
  return {
    present: true,
    create: createRows[0]?.['Create Table'] || null,
    rows
  }
}

const args = parseArgs(process.argv.slice(2))
const envFile = resolve(String(args['env-file'] || ''))
const migrationFile = resolve(String(args.migration || ''))
const backupFile = resolve(String(args.backup || ''))
if (!envFile || !migrationFile || !backupFile || args.execute !== true) {
  throw new Error('usage: --env-file <path> --migration <path> --backup <path> --execute')
}

const env = { ...process.env, ...parseEnv(await readFile(envFile, 'utf8')) }
if (env.DB_NAME !== 'hzy_platform_dev') {
  throw new Error(`refusing non-development database: ${env.DB_NAME || '<empty>'}`)
}

const connection = await mysql.createConnection({
  host: env.DB_HOST,
  port: Number(env.DB_PORT || 3306),
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  charset: 'utf8mb4',
  multipleStatements: true
})

try {
  const before = {
    capturedAt: new Date().toISOString(),
    database: env.DB_NAME,
    platformLifecycleScopeVersions: await tableSnapshot(connection, 'platform_lifecycle_scope_versions'),
    serviceCommandReceipt: await tableSnapshot(connection, 'service_command_receipt')
  }
  await mkdir(dirname(backupFile), { recursive: true, mode: 0o700 })
  await writeFile(backupFile, `${JSON.stringify(before, null, 2)}\n`, { mode: 0o600 })
  await chmod(backupFile, 0o600)

  await connection.query(await readFile(migrationFile, 'utf8'))

  const after = {
    platformLifecycleScopeVersions: await tableSnapshot(connection, 'platform_lifecycle_scope_versions'),
    serviceCommandReceipt: await tableSnapshot(connection, 'service_command_receipt')
  }
  if (!after.platformLifecycleScopeVersions.present || !after.serviceCommandReceipt.present) {
    throw new Error('lifecycle reliability migration verification failed')
  }
  console.info(JSON.stringify({
    status: 'verified',
    database: env.DB_NAME,
    tables: ['platform_lifecycle_scope_versions', 'service_command_receipt'],
    backupMode: '0600'
  }))
} finally {
  await connection.end()
}
