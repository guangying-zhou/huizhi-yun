#!/usr/bin/env node
// G-9 clone preparation. This does not enroll a Runtime, issue a license or
// register a scheduler owner: those actions must use the existing audited APIs.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const END = '2027-12-31 23:59:59'
const TARGETS = {
  tenants: 'tenant_code', platform_accounts: 'id', tenant_subscriptions: 'id', subscriptions: 'id',
  deployment_sites: 'id', deployments: 'id', tenant_runtime_credentials: 'tenant_code',
  tenant_runtime_instances: 'id', deployment_bootstrap_secrets: 'id', platform_signing_keys: 'id'
}
const TABLES = Object.keys(TARGETS)
const FIELDS = {
  tenants: ['status'], platform_accounts: ['status'], tenant_subscriptions: ['ended_at'], subscriptions: ['ended_at'],
  deployment_sites: ['status', 'public_url', 'root_app_code'],
  deployments: ['status', 'site_id', 'base_path', 'api_base', 'route_source'],
  tenant_runtime_credentials: ['status', 'revoked_at'],
  tenant_runtime_instances: ['status', 'runtime_endpoint', 'runtime_token_hash', 'runtime_token_last4',
    'control_token_hash', 'control_token_last4', 'enrolled_at', 'last_heartbeat_at'],
  deployment_bootstrap_secrets: ['status'], platform_signing_keys: ['status', 'revoked_at', 'rotated_at']
}
const stable = value => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item))
const stableOrNull = value => value == null ? null : stable(value)
const key = (table, row) => String(row[TARGETS[table]])
const canonical = rows => rows.map(stable).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
const fullHash = rows => sha(canonical(rows))

export async function readG9Data(db, lock = false) {
  const result = {}
  for (const table of TABLES) {
    const [rows] = await db.query(`SELECT * FROM \`${table}\` ORDER BY \`${TARGETS[table]}\`${lock ? ' FOR UPDATE' : ''}`)
    result[table] = rows
  }
  return result
}

export function planG9Data(state, options) {
  assert.deepEqual(Object.keys(options).sort(), ['oldSigningKids', 'revokedAt', 'runtimeEndpoint'].sort(), 'G9_OPTIONS')
  assert.match(options.runtimeEndpoint, /^https:\/\/[a-z0-9.-]+\.wiztek\.cn\/?$/)
  assert.notEqual(options.runtimeEndpoint, 'https://wiztek-data-runtime.huizhi.yun')
  assert.match(options.revokedAt, /^20\d\d-(0[1-9]|1[0-2])-([0-2]\d|3[01]) [0-2]\d:[0-5]\d:[0-5]\d$/)
  assert.ok(Array.isArray(options.oldSigningKids) && options.oldSigningKids.every(kid => /^[A-Za-z0-9_-]{4,64}$/.test(kid)), 'G9_OLD_KIDS_REQUIRED')
  assert.deepEqual(state.platform_signing_keys.map(row => row.kid).sort(), [...options.oldSigningKids].sort(), 'G9_SIGNING_KID_SET_CHANGED')
  const exactly = (table, predicate, label) => {
    const rows = state[table].filter(predicate)
    assert.equal(rows.length, 1, `G9_${label}_CARDINALITY`)
    return rows[0]
  }
  const tenant = exactly('tenants', r => r.tenant_code === 'C000001', 'TENANT')
  assert.equal(tenant.status, 'active', 'G9_TENANT_NOT_ACTIVE')
  const mainSite = exactly('deployment_sites', r => r.site_code === 'C000001-main' && r.tenant_code === 'C000001' && r.environment === 'prod', 'SITE')
  const vault = exactly('deployment_bootstrap_secrets', r => r.tenant_code === 'C000001' && r.app_code === 'console' && r.secret_code === 'console.vault.master_key', 'VAULT')
  assert.equal(vault.status, 'migrated', 'G9_VAULT_MARKER_MUST_SURVIVE')
  const staticTokens = state.deployment_bootstrap_secrets.filter(r => r.secret_code === 'data-runtime.static_token' && r.status === 'active')
  assert.ok(staticTokens.length === 2 || (staticTokens.length === 0 && state.deployment_bootstrap_secrets.filter(r => r.secret_code === 'data-runtime.static_token' && r.status === 'revoked').length === 2), 'G9_STATIC_TOKEN_COUNT_DRIFT')
  const ops = []
  const add = (table, row, changes) => {
    if (!row) return
    assert.ok(Object.keys(changes).every(field => FIELDS[table].includes(field)))
    const after = Object.fromEntries(Object.entries(changes).filter(([field, value]) => String(row[field] ?? '') !== String(value ?? '')))
    if (Object.keys(after).length) ops.push({ table, key: key(table, row), beforeSha256: sha(stable(row)), after })
  }
  add('tenants', exactly('tenants', r => r.tenant_code === 'C000002', 'SECOND_TENANT'), { status: 'disabled' })
  add('platform_accounts', exactly('platform_accounts', r => r.uid === 'gavin,zhouguangying', 'ANOMALOUS_ACCOUNT'), { status: 'disabled' })
  const parents = state.tenant_subscriptions.filter(r => r.tenant_code === 'C000001' && r.status === 'active')
  assert.equal(parents.length, 1, 'G9_PRIMARY_SUBSCRIPTION_CARDINALITY')
  for (const row of parents) add('tenant_subscriptions', row, { ended_at: END })
  for (const row of state.subscriptions.filter(r => r.tenant_code === 'C000001' && r.status === 'active')) add('subscriptions', row, { ended_at: END })
  // No root app: Enterprise is explicitly mounted at /enterprise/, not /.
  add('deployment_sites', mainSite, { public_url: 'https://aidcp.wiztek.cn', root_app_code: null })
  for (const row of state.deployment_sites.filter(r => r.tenant_code === 'C000002' || (r.tenant_code === 'C000001' && r.environment === 'test'))) add('deployment_sites', row, { status: 'inactive' })
  const routes = { console: ['/console/', '/api/v1/console'], aims: ['/aims/', '/api/v1/aims'], workflow: ['/workflow/', '/api/v1/workflow'],
    codocs: ['/codocs/', '/api/v1/codocs'], assets: ['/assets/', '/api/v1/assets'], altoc: ['/altoc/', '/api/v1/altoc'] }
  for (const row of state.deployments) {
    if (row.tenant_code === 'C000002' || (row.tenant_code === 'C000001' && row.environment === 'test')
      || (row.tenant_code === 'C000001' && row.environment === 'prod' && ['finance', 'people', 'webdev'].includes(row.app_code))) add('deployments', row, { status: 'inactive' })
    else if (row.tenant_code === 'C000001' && row.environment === 'prod' && routes[row.app_code]) add('deployments', row,
      { site_id: mainSite.id, base_path: routes[row.app_code][0], api_base: routes[row.app_code][1], route_source: 'platform_override' })
  }
  const runtime = exactly('tenant_runtime_instances', r => r.runtime_code === 'c000001-prod-tenant-runtime' && r.tenant_code === 'C000001', 'RUNTIME')
  add('tenant_runtime_instances', runtime, { status: 'pending', runtime_endpoint: options.runtimeEndpoint,
    runtime_token_hash: null, runtime_token_last4: null, control_token_hash: null, control_token_last4: null,
    enrolled_at: null, last_heartbeat_at: null })
  for (const row of state.tenant_runtime_credentials.filter(r => r.status === 'active')) add('tenant_runtime_credentials', row, { status: 'revoked', revoked_at: options.revokedAt })
  for (const row of staticTokens) add('deployment_bootstrap_secrets', row, { status: 'revoked' })
  // Old public keys must not remain retrievable as rotated keys. The source
  // dump is the disaster recovery copy; the protected receipt restores rows.
  for (const row of state.platform_signing_keys) ops.push({ table: 'platform_signing_keys', key: key('platform_signing_keys', row),
    beforeSha256: sha(stable(row)), after: null, kind: 'delete' })
  const targetKeys = new Map(TABLES.map(table => [table, new Set(ops.filter(op => op.table === table).map(op => op.key))]))
  const nonTarget = Object.fromEntries(TABLES.map(table => [table, {
    count: state[table].filter(row => !targetKeys.get(table).has(key(table, row))).length,
    sha256: fullHash(state[table].filter(row => !targetKeys.get(table).has(key(table, row))))
  }]))
  const handoffs = [
    'official Enterprise provisioning creates C000001-prod-enterprise after release and entitlement conversion',
    'official entitlement conversion after subscription expiry change; no direct immutable entitlement edit',
    'new Platform signing key generated on protected host and activated by existing signer; no key material in SQL',
    'official Runtime install-command/enroll issues new control credential and marks ready',
    'official Aims scheduler-ownership command after Runtime ready; Workflow owner is Gateway drain configuration',
    'official license and tenant runtime-token APIs issue new artifacts after new signing trust is active'
  ]
  const base = { version: 'g9.clone-cleanup.v1', options, operations: ops, nonTarget, handoffs }
  return { ...base, reviewHash: sha(base) }
}

function find(state, op) {
  return state[op.table].find(row => key(op.table, row) === op.key)
}
export async function applyG9Data(db, options, approvedHash, persistReceipt, hook) {
  assert.match(approvedHash, /^[a-f0-9]{64}$/)
  await db.beginTransaction()
  try {
    const before = await readG9Data(db, true)
    const plan = planG9Data(before, options)
    assert.equal(plan.reviewHash, approvedHash, 'G9_REVIEW_HASH_CHANGED')
    const saved = []
    for (const op of plan.operations) {
      const row = find(before, op)
      assert.equal(sha(stable(row)), op.beforeSha256, 'G9_TARGET_CHANGED')
      if (op.kind === 'delete') {
        saved.push({ table: op.table, key: op.key, kind: 'delete', before: stable(row) })
        const [result] = await db.query(`DELETE FROM \`${op.table}\` WHERE \`${TARGETS[op.table]}\`=?`, [op.key])
        assert.equal(result.affectedRows, 1, 'G9_DELETE_CARDINALITY')
        continue
      }
      const fields = [...new Set([...Object.keys(op.after), ...(Object.hasOwn(row, 'updated_at') ? ['updated_at'] : [])])]
      saved.push({ table: op.table, key: op.key, before: Object.fromEntries(fields.map(field => [field, row[field]])) })
      const assignments = Object.keys(op.after).map(field => `\`${field}\`=?`)
      if (Object.hasOwn(row, 'updated_at')) assignments.push('`updated_at`=UTC_TIMESTAMP()')
      const params = [...Object.values(op.after), op.key]
      const [result] = await db.query(`UPDATE \`${op.table}\` SET ${assignments.join(',')} WHERE \`${TARGETS[op.table]}\`=?`, params)
      assert.equal(result.affectedRows, 1, 'G9_UPDATE_CARDINALITY')
    }
    if (hook) await hook(db)
    const after = await readG9Data(db, true)
    const targetKeys = new Map(TABLES.map(table => [table, new Set(plan.operations.filter(op => op.table === table).map(op => op.key))]))
    for (const table of TABLES) {
      const rows = after[table].filter(row => !targetKeys.get(table).has(key(table, row)))
      assert.deepEqual({ count: rows.length, sha256: fullHash(rows) }, plan.nonTarget[table], 'G9_NON_TARGET_CHANGED')
    }
    const receipt = { version: plan.version, reviewHash: plan.reviewHash, options, saved,
      afterSha256: plan.operations.map(op => ({ table: op.table, key: op.key, sha256: sha(stableOrNull(find(after, op))) })),
      nonTarget: plan.nonTarget }
    if (persistReceipt) await persistReceipt(receipt)
    await db.commit()
    return receipt
  } catch (error) {
    await db.rollback()
    throw error
  }
}

export async function rollbackG9Data(db, receipt) {
  assert.equal(receipt.version, 'g9.clone-cleanup.v1')
  await db.beginTransaction()
  try {
    const state = await readG9Data(db, true)
    const keys = new Map(TABLES.map(table => [table, new Set(receipt.saved.filter(op => op.table === table).map(op => op.key))]))
    for (const table of TABLES) {
      const rows = state[table].filter(row => !keys.get(table).has(key(table, row)))
      assert.deepEqual({ count: rows.length, sha256: fullHash(rows) }, receipt.nonTarget[table], 'G9_ROLLBACK_NON_TARGET_CHANGED')
    }
    for (const target of receipt.afterSha256) assert.equal(sha(stableOrNull(find(state, target))), target.sha256, 'G9_ROLLBACK_TARGET_CHANGED')
    for (const op of [...receipt.saved].reverse()) {
      const fields = Object.keys(op.before)
      if (op.kind === 'delete') {
        await db.query(`INSERT INTO \`${op.table}\` (${fields.map(field => `\`${field}\``).join(',')}) VALUES (${fields.map(() => '?').join(',')})`, Object.values(op.before))
        continue
      }
      const [result] = await db.query(`UPDATE \`${op.table}\` SET ${fields.map(field => `\`${field}\`=?`).join(',')} WHERE \`${TARGETS[op.table]}\`=?`,
        [...Object.values(op.before), op.key])
      assert.equal(result.affectedRows, 1)
    }
    await db.commit()
    return { restored: receipt.saved.length }
  } catch (error) {
    await db.rollback()
    throw error
  }
}

export function verifyG9Data(state, options) {
  const row = (table, predicate) => state[table].find(predicate)
  assert.equal(row('tenants', r => r.tenant_code === 'C000002')?.status, 'disabled')
  assert.equal(row('platform_accounts', r => r.uid === 'gavin,zhouguangying')?.status, 'disabled')
  assert.equal(row('deployment_sites', r => r.site_code === 'C000001-main')?.public_url, 'https://aidcp.wiztek.cn')
  assert.equal(row('deployment_bootstrap_secrets', r => r.secret_code === 'console.vault.master_key')?.status, 'migrated')
  assert.equal(state.deployment_bootstrap_secrets.filter(r => r.secret_code === 'data-runtime.static_token' && r.status === 'active').length, 0)
  assert.equal(state.platform_signing_keys.length, 0)
  assert.equal(row('tenant_runtime_instances', r => r.runtime_code === 'c000001-prod-tenant-runtime')?.runtime_endpoint, options.runtimeEndpoint)
  assert.ok(state.tenant_subscriptions.filter(r => r.tenant_code === 'C000001' && r.status === 'active').every(r => String(r.ended_at) === END))
  return { verified: true, deferred: ['enterprise_provisioning', 'entitlement_conversion', 'signing_key_activation', 'runtime_enrollment', 'scheduler_ownership', 'license_issuance'] }
}

function protectedJson(path) {
  const stat = statSync(path)
  assert.ok(stat.isFile() && (stat.mode & 0o077) === 0, 'G9_PROTECTED_FILE_REQUIRED')
  return JSON.parse(readFileSync(path, 'utf8'))
}
async function main() {
  const [mode, configPath, hashOrReceipt, receiptPath] = process.argv.slice(2)
  assert.ok(['--plan', '--apply', '--rollback', '--verify'].includes(mode), 'G9_MODE')
  const { db, options } = protectedJson(resolve(configPath))
  const connection = await mysql.createConnection({ ...db, dateStrings: true, timezone: 'Z' })
  try {
    if (mode === '--plan') {
      await connection.query('START TRANSACTION READ ONLY')
      try {
        console.log(JSON.stringify(planG9Data(await readG9Data(connection), options), null, 2))
      } finally {
        await connection.rollback()
      }
    } else if (mode === '--apply') {
      assert.ok(receiptPath, 'G9_RECEIPT_PATH_REQUIRED')
      const receipt = await applyG9Data(connection, options, hashOrReceipt, value =>
        writeFileSync(receiptPath, JSON.stringify(value), { flag: 'wx', mode: 0o600 }))
      console.log(JSON.stringify({ applied: true, reviewHash: receipt.reviewHash, receiptPath }))
    } else if (mode === '--rollback') {
      const receipt = protectedJson(resolve(hashOrReceipt))
      assert.equal(receipt.reviewHash, receiptPath, 'G9_ROLLBACK_HASH_REQUIRED')
      console.log(JSON.stringify(await rollbackG9Data(connection, receipt)))
    } else {
      await connection.query('START TRANSACTION READ ONLY')
      try {
        console.log(JSON.stringify(verifyG9Data(await readG9Data(connection), options)))
      } finally { await connection.rollback() }
    }
  } finally { await connection.end() }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(`G9_STOPPED:${String(error.message).slice(0, 200)}`)
  process.exitCode = 1
})
