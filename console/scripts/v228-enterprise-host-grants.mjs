#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import mysql from 'mysql2/promise'

const inventory = JSON.parse(readFileSync(new URL('../docs/sql/Console-v2.28-enterprise-host-precise-scopes.json', import.meta.url)))
const scopes = new Set(inventory.scopes)
if (inventory.version !== 'v2.28' || scopes.size !== 172) throw Error('V228_SCOPE_INVENTORY_INVALID')
const revokeSql = readFileSync(new URL('../docs/sql/Console-SQL-Revoke-v2.28-enterprise-host-precise-grants.sql', import.meta.url), 'utf8')
const verifySql = readFileSync(new URL('../docs/sql/Console-SQL-Verify-v2.28-enterprise-host-precise-grants.sql', import.meta.url), 'utf8')
const domains = ['aims', 'assets', 'codocs', 'altoc', 'console']
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const metadata = row => typeof row.scope_json === 'string' ? JSON.parse(row.scope_json) : row.scope_json || {}
const stable = row => ({ id: Number(row.id), client: row.client_code, app: row.app_code,
  resource: row.resource_code, action: row.action, status: row.status,
  scope: metadata(row), updatedAt: String(row.updated_at ?? '') })

function fullGrant(row) {
  return Object.fromEntries(Object.entries(row)
    .filter(([key]) => !['client_code', 'app_code'].includes(key))
    .sort(([left], [right]) => left.localeCompare(right)))
}

function immutableTargetFields(row) {
  const { status, updated_at, ...fields } = fullGrant(row)
  return fields
}

function nonTargetSnapshot(rows, targetIds) {
  const values = rows.filter(row => !targetIds.has(Number(row.id)))
    .sort((a, b) => Number(a.id) - Number(b.id)).map(fullGrant)
  return { count: values.length, hash: digest(values) }
}

export function classifyV228(rows) {
  const candidates = [], protectedRows = []
  for (const raw of rows) {
    const row = stable(raw), scope = row.scope
    if (row.client === 'enterprise.runtime' && row.app === 'enterprise' && row.status === 'active'
      && scopes.has(scope.semanticScope) && ['data-runtime', 'tenant-runtime'].includes(scope.audience)) {
      const [domain, resource, action] = scope.semanticScope.split(':')
      const physical = `${domain}:${resource}`
      if (row.action === action && [physical, `${scope.audience}:${physical}`].includes(row.resource)
        && !['enterprise-host'].includes(resource)) candidates.push(row)
    }
    if (row.client === 'enterprise.runtime' && domains.some(domain =>
      row.resource === `data-runtime:${domain}:enterprise-host` && row.action === 'execute')) protectedRows.push(row)
  }
  candidates.sort((a, b) => a.id - b.id)
  protectedRows.sort((a, b) => a.id - b.id)
  return { candidates, protectedRows }
}

function assertProtected(rows) {
  for (const domain of domains) {
    const found = rows.filter(row => row.client === 'enterprise.runtime'
      && row.resource === `data-runtime:${domain}:enterprise-host` && row.action === 'execute')
    assert.equal(found.length, 1, `V228_DOMAIN_${domain}_MISSING_OR_DUPLICATE`)
    assert.equal(found[0].status, 'active')
    assert.equal(found[0].scope.audience, 'data-runtime')
    assert.equal(found[0].scope.semanticScope, `${domain}:enterprise-host:execute`)
  }
}

export async function readV228Rows(db, { lock = false } = {}) {
  const [rows] = await db.query(`SELECT g.*, sc.client_code, sc.app_code
    FROM service_client_grants g LEFT JOIN service_clients sc ON sc.id=g.service_client_id
    ORDER BY g.id${lock ? ' FOR UPDATE' : ''}`)
  return rows
}

export function planV228(rows, { requireProtected = false } = {}) {
  const { candidates, protectedRows } = classifyV228(rows)
  if (requireProtected) assertProtected(protectedRows)
  const nonTarget = nonTargetSnapshot(rows, new Set(candidates.map(row => row.id)))
  const plan = { tenant: 'C000001', deployment: 'C000001-test-enterprise',
    targets: candidates.map(row => ({ id: row.id, scope: row.scope.semanticScope,
      audience: row.scope.audience, resource: row.resource, action: row.action, before: 'active', after: 'revoked' })),
    domainHash: digest(protectedRows), targetHash: digest(candidates), nonTarget }
  return { ...plan, reviewHash: digest(plan) }
}

export async function applyV228(db, approvedHash, { afterUpdate } = {}) {
  assert.match(approvedHash || '', /^[a-f0-9]{64}$/)
  await db.beginTransaction()
  try {
    const beforeRows = await readV228Rows(db, { lock: true })
    const plan = planV228(beforeRows, { requireProtected: true })
    assert.equal(plan.reviewHash, approvedHash, 'V228_REVIEW_HASH_CHANGED')
    assert.ok(plan.targets.length > 0, 'V228_NO_ACTIVE_TARGETS')
    await db.query('CREATE TEMPORARY TABLE v228_targets(id BIGINT PRIMARY KEY)')
    // Match service_client_grants (utf8mb4_unicode_ci); the server default
    // utf8mb4_0900_ai_ci would make the scope join an illegal collation mix.
    await db.query('CREATE TEMPORARY TABLE v228_scopes(semantic_scope VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PRIMARY KEY)')
    for (const target of plan.targets) await db.query('INSERT INTO v228_targets(id) VALUES(?)', [target.id])
    for (const scope of scopes) await db.query('INSERT INTO v228_scopes(semantic_scope) VALUES(?)', [scope])
    const [changed] = await db.query(revokeSql)
    assert.equal(changed.affectedRows, plan.targets.length, 'V228_AFFECTED_ROWS_CHANGED')
    const [verified] = await db.query(verifySql)
    assert.deepEqual(Object.fromEntries(verified.map(row => [row.section, Number(row.observed)])),
      { target_revoked: plan.targets.length, legacy_active: 0, domain_total: 5, domain_active: 5 }, 'V228_VERIFY_FAILED')
    if (afterUpdate) await afterUpdate(db)
    const afterRows = await readV228Rows(db)
    const afterProtected = classifyV228(afterRows).protectedRows
    assert.equal(digest(afterProtected), plan.domainHash, 'V228_DOMAIN_GRANT_CHANGED')
    const targetIds = new Set(plan.targets.map(row => row.id))
    assert.deepEqual(nonTargetSnapshot(afterRows, targetIds), plan.nonTarget, 'V228_NON_TARGET_TABLE_CHANGED')
    const beforeById = new Map(beforeRows.map(row => [Number(row.id), row]))
    const afterById = new Map(afterRows.map(row => [Number(row.id), row]))
    for (const [id, before] of beforeById) {
      const after = afterById.get(id)
      assert.ok(after, 'V228_GRANT_DISAPPEARED')
      if (targetIds.has(id)) {
        assert.equal(after.status, 'revoked')
        assert.deepEqual(immutableTargetFields(after), immutableTargetFields(before), 'V228_TARGET_OTHER_FIELDS_CHANGED')
      } else assert.deepEqual(fullGrant(after), fullGrant(before), 'V228_OUT_OF_SCOPE_CHANGED')
    }
    await db.commit()
    return { reviewHash: plan.reviewHash, revokedIds: plan.targets.map(row => row.id), protectedUnchanged: true }
  } catch (error) { await db.rollback(); throw error }
  finally {
    await db.query('DROP TEMPORARY TABLE IF EXISTS v228_targets').catch(() => {})
    await db.query('DROP TEMPORARY TABLE IF EXISTS v228_scopes').catch(() => {})
  }
}

function connectionFromProtectedConfig(path) {
  const info = statSync(path)
  assert.equal(info.uid, process.getuid(), 'V228_CONFIG_OWNER_INVALID')
  assert.equal(info.mode & 0o077, 0, 'V228_CONFIG_MODE_INVALID')
  const config = JSON.parse(readFileSync(path, 'utf8'))
  const db = config.apps?.console?.db
  assert.equal(config.tenant, 'C000001')
  assert.equal(config.deploymentBindings?.enterprise, 'C000001-test-enterprise')
  assert.equal(db?.host, '127.0.0.1')
  assert.equal(db?.database, 'hzy_console_test_local_20260910')
  return { ...db, dateStrings: true }
}

async function main() {
  const [mode, hash] = process.argv.slice(2)
  if (!['--plan', '--apply'].includes(mode) || (mode === '--apply' && !hash) || (mode === '--plan' && hash)) throw Error('V228_MODE_OR_REVIEW_HASH_REQUIRED')
  const path = join(homedir(), 'Library/Application Support/HuizhiYun/test-runtime/config.json')
  const db = await mysql.createConnection(connectionFromProtectedConfig(path))
  try {
    if (mode === '--plan') console.log(JSON.stringify({ mode: 'plan', ...planV228(await readV228Rows(db)) }, null, 2))
    else console.log(JSON.stringify({ mode: 'applied', ...await applyV228(db, hash) }))
  } finally { await db.end() }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) main().catch(error => {
  console.error(`v2.28 stopped: ${String(error?.message || error).replace(/[A-Za-z0-9._~-]{40,}/g, '[redacted]').slice(0, 180)}`)
  process.exitCode = 1
})
