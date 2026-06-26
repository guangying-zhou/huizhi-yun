#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import mysql from 'mysql2/promise'

const DEFAULT_FILES = {
  consoleProd: 'console/.env.prod.example',
  consoleTest: 'console/.env.test.example'
}

const FILE_OPTIONS = {
  'console-prod-env': 'consoleProd',
  'console-test-env': 'consoleTest'
}

const LOGICAL_KEYS = ['policy_bundle', 'activation_status']

function usage() {
  return `
Usage:
  pnpm run verify:console-runtime-cache -- --db hzy_console --user root --password-env CONSOLE_DB_PASSWORD

Options:
  --host <host>                         Default: 127.0.0.1
  --port <port>                         Default: 3306
  --user <user>                         Default: root
  --password <password>                 Avoid when possible; prefer --password-env.
  --password-env <env>                  Read DB password from env var.
  --db <database>                       Required. Usually hzy_console.
  --table <table>                       Default: console_runtime_cache.
  --cache-rows-file <path>              Offline JSON fixture for verifier guardrails; skips MySQL.
  --console-prod-env <path>             Default: console/.env.prod.example.
  --console-test-env <path>             Default: console/.env.test.example.
  --require-prod-cache                  Require prod scope policy_bundle and activation_status rows.
  --require-test-cache                  Require test scope policy_bundle and activation_status rows.
  --allow-legacy-unscoped               Allow legacy unscoped policy_bundle / activation_status rows.

Verifies scoped Console runtime cache keys in the shared Console DB without printing secrets.
`
}

function parseArgs(argv) {
  const args = {
    files: { ...DEFAULT_FILES },
    host: '127.0.0.1',
    port: '3306',
    user: 'root',
    table: 'console_runtime_cache',
    requireProdCache: false,
    requireTestCache: false,
    allowLegacyUnscoped: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--') continue
    if (item === '--help' || item === '-h') {
      args.help = true
      continue
    }
    if (item === '--require-prod-cache') {
      args.requireProdCache = true
      continue
    }
    if (item === '--require-test-cache') {
      args.requireTestCache = true
      continue
    }
    if (item === '--allow-legacy-unscoped') {
      args.allowLegacyUnscoped = true
      continue
    }
    if (!item.startsWith('--')) continue

    const raw = item.slice(2)
    const equalsIndex = raw.indexOf('=')
    const name = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw
    const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : argv[index + 1]

    const fileKey = FILE_OPTIONS[name]
    if (fileKey) {
      args.files[fileKey] = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (['host', 'port', 'user', 'password', 'password-env', 'db', 'table', 'cache-rows-file'].includes(name)) {
      const key = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      args[key] = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    throw new Error(`unknown option: --${name}`)
  }

  return args
}

function requiredValue(name, value) {
  if (!value || value.startsWith('--')) {
    throw new Error(`missing value for --${name}`)
  }
  return value
}

function stringValue(value) {
  return String(value || '').trim()
}

function unquote(value) {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"')
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseEnvFile(path) {
  const env = {}
  const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^export\s+/, '')
    if (!trimmed || trimmed.startsWith('#')) continue
    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex <= 0) continue
    env[trimmed.slice(0, equalsIndex).trim()] = unquote(trimmed.slice(equalsIndex + 1))
  }
  return env
}

function readEnv(path, label) {
  const absolute = resolve(process.cwd(), path)
  if (!existsSync(absolute)) {
    throw new Error(`${label} env file not found: ${path}`)
  }
  return parseEnvFile(absolute)
}

function envValue(env, ...keys) {
  for (const key of keys) {
    const value = stringValue(env[key])
    if (value) return value
  }
  return ''
}

function expectedRuntime(env, label) {
  const deploymentCode = envValue(env, 'HZY_PLATFORM_DEPLOYMENT_CODE', 'DEPLOYMENT_CODE')
  const tenantCode = envValue(env, 'HZY_PLATFORM_TENANT_CODE', 'TENANT_CODE')
  const databaseName = envValue(env, 'DB_NAME') || 'hzy_console'
  const scope = envValue(env, 'HZY_PLATFORM_BUNDLE_CACHE_SCOPE') || deploymentCode
  if (!deploymentCode) {
    throw new Error(`${label} deploymentCode is missing`)
  }
  if (!scope) {
    throw new Error(`${label} cache scope is missing`)
  }
  return { label, databaseName, deploymentCode, tenantCode, scope }
}

function passwordFrom(args) {
  if (args.password) return args.password
  if (args.passwordEnv) return stringValue(process.env[args.passwordEnv])
  return ''
}

function assertMysqlIdentifier(value, label) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`${label} must contain only letters, numbers and underscores: ${value}`)
  }
}

function parsePayload(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  return JSON.parse(String(value))
}

function payloadDeploymentCode(payload) {
  return stringValue(payload?.deploymentCode || payload?.deployment_code)
}

function payloadTenantCode(payload) {
  return stringValue(payload?.tenantCode || payload?.tenant_code)
}

function payloadSummary(kind, payload) {
  if (kind === 'policy_bundle') {
    return {
      deploymentCode: payloadDeploymentCode(payload),
      tenantCode: payloadTenantCode(payload),
      bundleVersion: stringValue(payload?.bundleVersion),
      bundleHash: stringValue(payload?.bundleHash),
      status: stringValue(payload?.status)
    }
  }

  return {
    deploymentCode: payloadDeploymentCode(payload),
    tenantCode: payloadTenantCode(payload),
    bundleVersion: stringValue(payload?.bundleVersion),
    bundleHash: stringValue(payload?.bundleHash),
    status: stringValue(payload?.mode)
  }
}

async function tableExists(connection, table) {
  const [rows] = await connection.query(
    'SELECT TABLE_NAME AS tableName FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1',
    [table]
  )
  return Boolean(rows[0])
}

async function readCacheRows(connection, table, keys) {
  if (keys.length === 0) return new Map()
  const placeholders = keys.map(() => '?').join(', ')
  const [rows] = await connection.query(
    `SELECT cache_key AS cacheKey, payload_json AS payloadJson, updated_at AS updatedAt
     FROM \`${table}\`
     WHERE cache_key IN (${placeholders})`,
    keys
  )
  return new Map(rows.map(row => [String(row.cacheKey), row]))
}

function readFixtureCacheRows(path, keys) {
  const absolute = resolve(process.cwd(), path)
  if (!existsSync(absolute)) {
    throw new Error(`cache rows fixture not found: ${path}`)
  }

  let rows
  try {
    rows = JSON.parse(readFileSync(absolute, 'utf8'))
  } catch (error) {
    throw new Error(`cache rows fixture did not contain valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!Array.isArray(rows)) {
    throw new Error('cache rows fixture must be a JSON array')
  }

  const wanted = new Set(keys)
  return new Map(
    rows
      .map(row => ({
        cacheKey: stringValue(row?.cacheKey || row?.cache_key),
        payloadJson: row?.payloadJson ?? row?.payload_json ?? null,
        updatedAt: row?.updatedAt || row?.updated_at || null
      }))
      .filter(row => row.cacheKey && wanted.has(row.cacheKey))
      .map(row => [row.cacheKey, row])
  )
}

function validateLogicalRows(rows, runtime, options) {
  const errors = []
  const present = []

  for (const kind of LOGICAL_KEYS) {
    const key = `${runtime.scope}:${kind}`
    const row = rows.get(key)
    if (!row) {
      if (options.requireCache) {
        errors.push(`${runtime.label} missing scoped cache key ${key}`)
      }
      continue
    }

    const payload = parsePayload(row.payloadJson)
    const summary = payloadSummary(kind, payload)
    if (summary.deploymentCode && summary.deploymentCode !== runtime.deploymentCode) {
      errors.push(`${key} deploymentCode mismatch: ${summary.deploymentCode} !== ${runtime.deploymentCode}`)
    }
    if (runtime.tenantCode && summary.tenantCode && summary.tenantCode !== runtime.tenantCode) {
      errors.push(`${key} tenantCode mismatch: ${summary.tenantCode} !== ${runtime.tenantCode}`)
    }

    present.push({
      key,
      kind,
      ...summary,
      updatedAt: row.updatedAt
    })
  }

  const bundle = present.find(item => item.kind === 'policy_bundle')
  const status = present.find(item => item.kind === 'activation_status')
  if (bundle && status) {
    if (bundle.bundleHash && status.bundleHash && bundle.bundleHash !== status.bundleHash) {
      errors.push(`${runtime.label} policy_bundle and activation_status bundleHash differ`)
    }
  }

  return { errors, present }
}

function validateExpectedDatabase(args, prod, test) {
  const errors = []
  if (prod.databaseName !== test.databaseName) {
    errors.push(`console-prod and console-test DB_NAME must match for shared Console DB cache verification: ${prod.databaseName} !== ${test.databaseName}`)
  }
  if (prod.databaseName !== args.db) {
    errors.push(`--db must match Console DB_NAME from env files: ${args.db} !== ${prod.databaseName}`)
  }
  return errors
}

function validateProdTestBundleSeparation(prodResult, testResult) {
  const errors = []
  const prodBundle = prodResult.present.find(item => item.kind === 'policy_bundle')
  const testBundle = testResult.present.find(item => item.kind === 'policy_bundle')
  if (prodBundle?.bundleHash && testBundle?.bundleHash && prodBundle.bundleHash === testBundle.bundleHash) {
    errors.push(`console-prod and console-test policy_bundle cache rows must not share bundleHash: ${prodBundle.bundleHash}`)
  }

  const prodStatus = prodResult.present.find(item => item.kind === 'activation_status')
  const testStatus = testResult.present.find(item => item.kind === 'activation_status')
  if (prodStatus?.bundleHash && testStatus?.bundleHash && prodStatus.bundleHash === testStatus.bundleHash) {
    errors.push(`console-prod and console-test activation_status cache rows must not share bundleHash: ${prodStatus.bundleHash}`)
  }

  return errors
}

function validateLegacyRows(rows, allowLegacyUnscoped) {
  const legacy = LOGICAL_KEYS.filter(key => rows.has(key))
  if (!legacy.length || allowLegacyUnscoped) return []
  return [`legacy unscoped cache keys must be removed or explicitly allowed: ${legacy.join(', ')}`]
}

async function verifyRows(args, rows, prod, test) {
  const prodResult = validateLogicalRows(rows, prod, { requireCache: args.requireProdCache })
  const testResult = validateLogicalRows(rows, test, { requireCache: args.requireTestCache })
  const errors = [
    ...validateExpectedDatabase(args, prod, test),
    ...validateLegacyRows(rows, args.allowLegacyUnscoped),
    ...prodResult.errors,
    ...testResult.errors,
    ...validateProdTestBundleSeparation(prodResult, testResult)
  ]

  console.info(`[console-runtime-cache] checked ${args.cacheRowsFile ? `fixture ${args.cacheRowsFile}` : `${args.user}@${args.host}:${args.port}/${args.db}.${args.table}`}`)
  for (const item of [...prodResult.present, ...testResult.present]) {
    console.info(`[console-runtime-cache] ${item.key}: deployment=${item.deploymentCode || '<empty>'}, tenant=${item.tenantCode || '<empty>'}, bundle=${item.bundleVersion || '<none>'}, status=${item.status || '<none>'}, updated=${item.updatedAt || '<unknown>'}`)
  }
  if (!prodResult.present.length) {
    console.info(`[console-runtime-cache] ${prod.label}: no scoped cache rows found for ${prod.scope}`)
  }
  if (!testResult.present.length) {
    console.info(`[console-runtime-cache] ${test.label}: no scoped cache rows found for ${test.scope}`)
  }

  if (errors.length) {
    console.error('[console-runtime-cache] verification failed:')
    for (const error of errors) {
      console.error(`  - ${error}`)
    }
    process.exit(1)
  }

  console.info('[console-runtime-cache] verification passed')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.info(usage().trim())
    return
  }

  if (!args.db) {
    throw new Error('--db is required')
  }
  assertMysqlIdentifier(args.db, '--db')
  assertMysqlIdentifier(args.table, '--table')

  const prod = expectedRuntime(readEnv(args.files.consoleProd, 'console-prod'), 'console-prod')
  const test = expectedRuntime(readEnv(args.files.consoleTest, 'console-test'), 'console-test')
  if (prod.scope === test.scope) {
    throw new Error(`console-prod and console-test cache scopes must differ, both are ${prod.scope}`)
  }

  const keys = [
    ...LOGICAL_KEYS,
    ...LOGICAL_KEYS.map(kind => `${prod.scope}:${kind}`),
    ...LOGICAL_KEYS.map(kind => `${test.scope}:${kind}`)
  ]

  if (args.cacheRowsFile) {
    await verifyRows(args, readFixtureCacheRows(args.cacheRowsFile, keys), prod, test)
    return
  }

  const connection = await mysql.createConnection({
    host: args.host,
    port: Number(args.port),
    user: args.user,
    password: passwordFrom(args),
    database: args.db,
    multipleStatements: false
  })

  try {
    if (!await tableExists(connection, args.table)) {
      throw new Error(`${args.db}.${args.table} does not exist`)
    }

    const rows = await readCacheRows(connection, args.table, keys)
    await verifyRows(args, rows, prod, test)
  } finally {
    await connection.end()
  }
}

main().catch((error) => {
  console.error(`[console-runtime-cache] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
