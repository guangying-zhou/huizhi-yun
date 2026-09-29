#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { COLLAB_CLIENT, g7ExpectedGrants, g7ScopeJson, validateG7Bindings } from './g7-prod-grant-catalog.mjs'

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const sqlPath = name => new URL(`../docs/sql/Console-SQL-${name}-v2.33-prod-service-grants.sql`, import.meta.url)
const sql = Object.fromEntries(['Seed', 'Repair', 'Verify', 'Rollback'].map((section) => {
  const parts = readFileSync(sqlPath(section), 'utf8').split(/^-- name: ([a-z-]+)\s*$/m)
  const statements = {}
  for (let i = 1; i < parts.length; i += 2) statements[parts[i]] = parts[i + 1].trim()
  return [section, statements]
}))
const scopeOf = row => typeof row.scope_json === 'string' ? JSON.parse(row.scope_json) : row.scope_json || {}
const fullGrant = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['client_code', 'app_code'].includes(key)).sort(([a], [b]) => a.localeCompare(b)))
const grantHash = rows => sha(rows.map(fullGrant).sort((a, b) => Number(a.id) - Number(b.id)))
const fullRows = rows => ({ count: rows.length, hash: sha(rows.map(row => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))).sort((a, b) => Number(a.id) - Number(b.id))) })
export { fullRows, grantHash, scopeOf, sha, sql as g7Sql }
const sourceClient = row => row.client_code === 'enterprise.runtime' && row.app_code === 'enterprise'

export async function readG7State(db, lock = false) {
  const suffix = lock ? ' FOR UPDATE' : ''
  const [clients] = await db.query(sql.Verify.clients + suffix)
  const [oidcClients] = await db.query(sql.Verify['oidc-clients'] + suffix)
  const [grants] = await db.query(sql.Verify['all-grants'] + suffix)
  return { clients, oidcClients, grants }
}

function matching(row, item) {
  const scope = scopeOf(row)
  return row.client_code === item.client && row.status === 'active'
    && ((scope.audience === item.audience && scope.semanticScope === item.scope)
      || (row.resource_code === item.resource && row.action === item.action))
}

function canonical(row, item, tenant) {
  const scope = scopeOf(row)
  return row.resource_code === item.resource && row.action === item.action && row.status === 'active'
    && scope.audience === item.audience && scope.semanticScope === item.scope
    && scope.tenantCode === tenant && scope.deploymentCode === item.deployment
    && (!item.roleCodes || JSON.stringify(scope.roleCodes) === JSON.stringify(item.roleCodes))
}

function planFromState(state, bindings) {
  validateG7Bindings(bindings)
  const expected = g7ExpectedGrants(bindings)
  const clients = new Map(state.clients.map(row => [row.client_code, row]))
  const enterprise = clients.get('enterprise.runtime')
  if (enterprise) assert.ok(sourceClient(enterprise) && enterprise.status === 'active', 'G7_ENTERPRISE_CLIENT_CONFLICT')
  const oidc = state.oidcClients.find(row => row.client_id === 'enterprise')
  if (oidc) assert.ok(oidc.app_code === 'enterprise' && oidc.status === 'active', 'G7_OIDC_CLIENT_CONFLICT')
  for (const [code, app] of [['workflow.runtime', 'workflow'], ['aims.runtime', 'aims'], ['codocs.runtime', 'codocs'], ['console.runtime', 'console']]) {
    const client = clients.get(code)
    assert.ok(client && client.app_code === app && client.status === 'active', `G7_${code}_MISSING_OR_INACTIVE`)
  }
  // Optional standalone Collab identity. The plan never mints a credential and
  // refuses a same-named client that belongs to another app or is not active.
  const collabWanted = bindings.deployments.collab !== undefined
  const collab = clients.get(COLLAB_CLIENT)
  if (collab) assert.ok(collab.app_code === 'collab' && collab.status === 'active', 'G7_COLLAB_CLIENT_CONFLICT')
  const operations = []
  const touched = new Set()
  for (const item of expected) {
    const rows = state.grants.filter(row => matching(row, item))
    const exactPhysical = state.grants.find(row => row.client_code === item.client && row.resource_code === item.resource && row.action === item.action)
    if (exactPhysical?.status !== undefined && exactPhysical.status !== 'active') throw Error(`G7_REVOKED_PHYSICAL_GRANT:${item.client}:${item.scope}:${item.audience}`)
    if (exactPhysical) {
      const fact = scopeOf(exactPhysical)
      assert.ok(!fact.audience || fact.audience === item.audience, `G7_AUDIENCE_CONFLICT:${item.client}:${item.scope}`)
      assert.ok(!fact.semanticScope || fact.semanticScope === item.scope, `G7_SEMANTIC_CONFLICT:${item.client}:${item.scope}`)
    }
    if (item.preserveExistingScope) {
      assert.ok(exactPhysical, `G7_CODOCS_OSS_GRANT_MISSING:${item.resource}:${item.action}`)
    }
    const foreignBound = rows.find((row) => {
      const s = scopeOf(row)
      return (s.tenantCode && s.tenantCode !== bindings.tenant)
        || (s.deploymentCode && s.deploymentCode !== item.deployment)
    })
    assert.ok(!foreignBound, `G7_FOREIGN_BINDING:${item.client}:${item.scope}`)
    const keeper = rows.find(row => canonical(row, item, bindings.tenant)) || exactPhysical || rows[0]
    if (keeper && keeper.resource_code !== item.resource) {
      // A semantic alias would leave issuance dependent on undocumented mapping.
      throw Error(`G7_NONCANONICAL_PHYSICAL:${item.client}:${item.scope}`)
    }
    for (const row of rows) if (row !== keeper && !touched.has(Number(row.id))) {
      operations.push({ kind: 'revoke', id: Number(row.id), client: item.client, scope: item.scope, audience: item.audience, before: fullGrant(row), after: { status: 'revoked' } })
      touched.add(Number(row.id))
    }
    if (!keeper) operations.push({ kind: 'insert', client: item.client, item, before: null, after: g7ScopeJson(item, bindings.tenant) })
    else if (!canonical(keeper, item, bindings.tenant)) {
      const next = g7ScopeJson(item, bindings.tenant, scopeOf(keeper))
      operations.push({ kind: 'bind', id: Number(keeper.id), client: item.client, scope: item.scope, audience: item.audience, before: fullGrant(keeper), after: next })
      touched.add(Number(keeper.id))
    }
  }
  // The old plural scheduler resource is never a substitute for the exact singular one.
  for (const row of state.grants) if (row.status === 'active' && ['workflow.runtime', 'aims.runtime'].includes(row.client_code)
    && (/(?:^|:)integration_operations$/.test(row.resource_code)
      || ['workflow:integration_operation', 'aims:integration_operation'].includes(row.resource_code))
    && row.action === 'execute' && !touched.has(Number(row.id))) {
    operations.push({ kind: 'revoke', id: Number(row.id), client: row.client_code, scope: `${row.resource_code}:execute`, audience: scopeOf(row).audience || null, before: fullGrant(row), after: { status: 'revoked' } })
    touched.add(Number(row.id))
  }
  const nonTargetRows = state.grants.filter(row => !touched.has(Number(row.id)))
  const base = { version: 'g7.v1', bindings, createServiceClient: !enterprise, createOidcClient: !oidc,
    ...(collabWanted ? { createCollabClient: !collab } : {}),
    operations, nonTarget: { count: nonTargetRows.length, hash: grantHash(nonTargetRows) },
    existingClients: fullRows(state.clients), existingOidcClients: fullRows(state.oidcClients) }
  return { ...base, reviewHash: sha(base) }
}

export function planG7(state, bindings) {
  return planFromState(state, bindings)
}

export function verifyG7(state, bindings) {
  const items = g7ExpectedGrants(bindings)
  const errors = []
  for (const [code, app] of [['enterprise.runtime', 'enterprise'], ['workflow.runtime', 'workflow'], ['aims.runtime', 'aims'], ['codocs.runtime', 'codocs'], ['console.runtime', 'console']]) {
    const matches = state.clients.filter(row => row.client_code === code && row.app_code === app && row.status === 'active')
    if (matches.length !== 1) errors.push(`${code}:client_not_active`)
  }
  if (bindings.deployments.collab !== undefined
    && state.clients.filter(row => row.client_code === COLLAB_CLIENT && row.app_code === 'collab' && row.status === 'active').length !== 1)
    errors.push(`${COLLAB_CLIENT}:client_not_active`)
  if (state.oidcClients.filter(row => row.client_id === 'enterprise' && row.app_code === 'enterprise' && row.status === 'active').length !== 1)
    errors.push('enterprise_oidc_not_active')
  for (const item of items) {
    const matches = state.grants.filter(row => matching(row, item) && canonical(row, item, bindings.tenant))
    const all = state.grants.filter(row => matching(row, item))
    if (matches.length !== 1 || all.length !== 1) errors.push(`${item.client}|${item.audience}|${item.scope}:${all.length}/${matches.length}`)
  }
  for (const code of ['workflow.runtime', 'aims.runtime']) if (state.grants.some(row => row.client_code === code && row.status === 'active'
    && (/(?:^|:)integration_operations$/.test(row.resource_code)
      || ['workflow:integration_operation', 'aims:integration_operation'].includes(row.resource_code))
    && row.action === 'execute')) errors.push(`${code}:legacy_scheduler_active`)
  if (state.grants.some(row => row.client_code === 'aims.runtime' && row.status === 'active'
    && (scopeOf(row).semanticScope === 'aims:notifications-due:execute'
      || (/(?:^|:)aims:notifications-due$/.test(row.resource_code) && row.action === 'execute')))) errors.push('notifications_due_granted')
  const consoleClient = state.clients.find(row => row.client_code === 'console.runtime')
  for (const action of ['read', 'write']) if (state.grants.filter(row => row.service_client_id === consoleClient?.id && row.resource_code === 'console:policy-bundle' && row.action === action && row.status === 'active').length !== 1) errors.push(`console_policy_bundle_${action}`)
  assert.deepEqual(errors, [], 'G7_VERIFY_FAILED')
  return { expected: items.length, active: items.length, consolePolicy: 2, legacyPlural: 0, notificationsDue: 0 }
}

export async function applyG7(db, bindings, approvedHash, hook, persistReceipt) {
  assert.match(approvedHash || '', /^[a-f0-9]{64}$/)
  await db.beginTransaction()
  try {
    const before = await readG7State(db, true)
    const plan = planG7(before, bindings)
    assert.equal(plan.reviewHash, approvedHash, 'G7_REVIEW_HASH_CHANGED')
    const inserted = { grants: [], serviceClient: null, oidcClient: null, ...(plan.createCollabClient ? { collabClient: null } : {}) }
    if (plan.createServiceClient) inserted.serviceClient = (await db.query(sql.Seed['service-client']))[0].insertId
    if (plan.createCollabClient) inserted.collabClient = (await db.query(sql.Seed['collab-service-client']))[0].insertId
    if (plan.createOidcClient) inserted.oidcClient = (await db.query(sql.Seed['oidc-client']))[0].insertId
    const clients = await readG7State(db)
    const byCode = new Map(clients.clients.map(row => [row.client_code, row.id]))
    for (const op of plan.operations) {
      if (op.kind === 'insert') {
        const item = op.item
        const [result] = await db.query(sql.Seed.grant, [byCode.get(item.client), item.resource, item.action, JSON.stringify(op.after)])
        assert.equal(result.affectedRows, 1)
        inserted.grants.push(Number(result.insertId))
      } else {
        const [result] = op.kind === 'bind'
          ? await db.query(sql.Repair.bind, [JSON.stringify(op.after), op.id])
          : await db.query(sql.Repair.revoke, [op.id])
        assert.equal(result.affectedRows, 1, `G7_${op.kind.toUpperCase()}_DRIFT`)
      }
    }
    if (hook) await hook(db)
    const after = await readG7State(db)
    verifyG7(after, bindings)
    const protectedIds = new Set([...plan.operations.filter(op => op.id).map(op => op.id), ...inserted.grants])
    const unchanged = after.grants.filter(row => !protectedIds.has(Number(row.id)))
    assert.deepEqual({ count: unchanged.length, hash: grantHash(unchanged) }, plan.nonTarget, 'G7_NON_TARGET_CHANGED')
    assert.deepEqual(fullRows(after.clients.filter(row => ![inserted.serviceClient, inserted.collabClient].includes(Number(row.id)))), plan.existingClients, 'G7_OTHER_CLIENT_CHANGED')
    assert.deepEqual(fullRows(after.oidcClients.filter(row => Number(row.id) !== inserted.oidcClient)), plan.existingOidcClients, 'G7_OTHER_OIDC_CHANGED')
    const receipt = { version: 'g7.v1', reviewHash: plan.reviewHash, bindings, inserted,
      restoredRows: plan.operations.filter(op => op.id).map(op => ({ id: op.id, before: op.before })),
      appliedTargetsHash: grantHash(after.grants.filter(row => protectedIds.has(Number(row.id)))), nonTarget: plan.nonTarget,
      existingClients: plan.existingClients, existingOidcClients: plan.existingOidcClients }
    if (persistReceipt) await persistReceipt(receipt)
    await db.commit()
    return receipt
  } catch (error) {
    await db.rollback()
    throw error
  }
}

export async function rollbackG7(db, receipt) {
  assert.equal(receipt.version, 'g7.v1')
  await db.beginTransaction()
  try {
    const state = await readG7State(db, true)
    const targets = new Set([...receipt.restoredRows.map(row => row.id), ...receipt.inserted.grants])
    assert.equal(grantHash(state.grants.filter(row => targets.has(Number(row.id)))), receipt.appliedTargetsHash, 'G7_ROLLBACK_TARGET_DRIFT')
    const other = state.grants.filter(row => !targets.has(Number(row.id)))
    assert.deepEqual({ count: other.length, hash: grantHash(other) }, receipt.nonTarget, 'G7_ROLLBACK_NON_TARGET_DRIFT')
    assert.deepEqual(fullRows(state.clients.filter(row => ![receipt.inserted.serviceClient, receipt.inserted.collabClient].includes(Number(row.id)))), receipt.existingClients, 'G7_ROLLBACK_OTHER_CLIENT_DRIFT')
    assert.deepEqual(fullRows(state.oidcClients.filter(row => Number(row.id) !== receipt.inserted.oidcClient)), receipt.existingOidcClients, 'G7_ROLLBACK_OTHER_OIDC_DRIFT')
    for (const id of receipt.inserted.grants) assert.equal((await db.query(sql.Rollback['remove-grant'], [id]))[0].affectedRows, 1)
    for (const { id, before } of receipt.restoredRows) {
      const [result] = await db.query(sql.Rollback['restore-grant'], [before.service_client_id, before.resource_code, before.action,
        before.scope_json == null ? null : JSON.stringify(scopeOf(before)), before.status, before.created_at, before.updated_at, id])
      assert.equal(result.affectedRows, 1)
    }
    if (receipt.inserted.oidcClient) assert.equal((await db.query(sql.Rollback['remove-oidc-client'], [receipt.inserted.oidcClient]))[0].affectedRows, 1)
    if (receipt.inserted.collabClient) assert.equal((await db.query(sql.Rollback['remove-collab-service-client'], [receipt.inserted.collabClient]))[0].affectedRows, 1)
    if (receipt.inserted.serviceClient) assert.equal((await db.query(sql.Rollback['remove-service-client'], [receipt.inserted.serviceClient]))[0].affectedRows, 1)
    await db.commit()
    return { restored: receipt.restoredRows.length, removed: receipt.inserted.grants.length }
  } catch (error) {
    await db.rollback()
    throw error
  }
}

function protectedJson(path) {
  const stat = statSync(path)
  assert.equal(stat.uid, process.getuid())
  assert.equal(stat.mode & 0o077, 0, 'G7_CONFIG_PERMISSIONS')
  return JSON.parse(readFileSync(path, 'utf8'))
}

async function main() {
  const [mode, configPath, hashOrReceipt, receiptPath] = process.argv.slice(2)
  assert.ok(['--plan', '--apply', '--verify', '--rollback'].includes(mode), 'G7_MODE_REQUIRED')
  const config = protectedJson(resolve(configPath))
  const bindings = validateG7Bindings(config.bindings)
  const db = await mysql.createConnection({ ...config.db, dateStrings: true })
  try {
    if (mode === '--plan' || mode === '--verify') {
      await db.query('START TRANSACTION READ ONLY')
      try {
        const state = await readG7State(db)
        console.log(mode === '--plan'
          ? JSON.stringify(planG7(state, bindings), null, 2)
          : JSON.stringify(verifyG7(state, bindings)))
      } finally { await db.rollback() }
    } else if (mode === '--apply') {
      assert.ok(receiptPath && /^[a-f0-9]{64}$/.test(hashOrReceipt || ''), 'G7_HASH_AND_RECEIPT_PATH_REQUIRED')
      const receipt = await applyG7(db, bindings, hashOrReceipt, null, (value) => {
        writeFileSync(receiptPath, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 })
      })
      console.log(JSON.stringify({ applied: true, reviewHash: receipt.reviewHash, receiptPath }))
    } else {
      const receipt = protectedJson(resolve(hashOrReceipt))
      assert.equal(receipt.reviewHash, receiptPath, 'G7_ROLLBACK_HASH_REQUIRED')
      console.log(JSON.stringify(await rollbackG7(db, receipt)))
    }
  } finally { await db.end() }
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) main().catch((error) => {
  console.error(`G7_STOPPED:${String(error?.message || error).replace(/[A-Za-z0-9._~-]{40,}/g, '[redacted]').slice(0, 160)}`)
  process.exitCode = 1
})
