#!/usr/bin/env node
// Production `collab.runtime` service identity + exact grants (candidate; never
// executed against a real database by the repository tests).
//
// Separate from deploy/test-env/collab-registration.mjs (hzy0 fixed values).
// Grants come from the same catalog as G-7 (collabGrantItems), so there is one
// list: codocs:collaboration-snapshots:read|publish, aud=data-runtime, bound to
// tenant + `${tenant}-collab`. Running this and the G-7 tool with a `collab`
// binding are interchangeable: whichever runs second plans no operations.
//
// Modes (plan/reviewHash/apply/verify/rollback, like g7-prod-grants.mjs):
//   --plan <config>
//   --apply <config> <reviewHash> <new-0600-receipt-path>
//   --verify <config>
//   --rollback <config> <receipt-path> <reviewHash>
// No credential, secret or hash is created: the client secret is enrolled
// through the formal credential flow and stored only in /etc/hzy/collab.env.
import assert from 'node:assert/strict'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { COLLAB_CLIENT, collabGrantItems, g7ScopeJson, validateCollabBindings } from './g7-prod-grant-catalog.mjs'
import { fullRows, g7Sql as sql, grantHash, scopeOf, sha } from './g7-prod-grants.mjs'

const fullGrant = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['client_code', 'app_code'].includes(key)).sort(([a], [b]) => a.localeCompare(b)))
const isCollab = row => row.client_code === COLLAB_CLIENT

export async function readCollabState(db, lock = false) {
  const suffix = lock ? ' FOR UPDATE' : ''
  const [clients] = await db.query(sql.Verify.clients + suffix)
  const [grants] = await db.query(sql.Verify['all-grants'] + suffix)
  return { clients, grants }
}

export function planCollab(state, input) {
  const bindings = validateCollabBindings(input)
  const expected = collabGrantItems(bindings)
  const client = state.clients.find(row => row.client_code === COLLAB_CLIENT)
  if (client) assert.ok(client.app_code === 'collab' && client.status === 'active', 'COLLAB_CLIENT_CONFLICT')
  const own = state.grants.filter(isCollab)
  const wanted = new Set(expected.map(item => `${item.resource}|${item.action}`))
  // Anything else on this identity is a widening. It is never auto-revoked or
  // adopted; the reviewer decides.
  assert.deepEqual(own.filter(row => row.status === 'active' && !wanted.has(`${row.resource_code}|${row.action}`)).map(row => `${row.resource_code}:${row.action}`), [], 'COLLAB_UNEXPECTED_ACTIVE_GRANT')
  const operations = []
  for (const item of expected) {
    const row = own.find(candidate => candidate.resource_code === item.resource && candidate.action === item.action)
    if (row && row.status !== 'active') throw Error(`COLLAB_REVOKED_GRANT:${item.scope}`)
    if (!row) { operations.push({ kind: 'insert', scope: item.scope, item, before: null, after: g7ScopeJson(item, bindings.tenant) }); continue }
    const scope = scopeOf(row)
    assert.ok(!scope.audience || scope.audience === item.audience, `COLLAB_AUDIENCE_CONFLICT:${item.scope}`)
    assert.ok(!scope.semanticScope || scope.semanticScope === item.scope, `COLLAB_SEMANTIC_CONFLICT:${item.scope}`)
    assert.ok(!(scope.tenantCode && scope.tenantCode !== bindings.tenant) && !(scope.deploymentCode && scope.deploymentCode !== item.deployment), `COLLAB_FOREIGN_BINDING:${item.scope}`)
    if (!collabCanonical(row, item, bindings.tenant)) operations.push({ kind: 'bind', id: Number(row.id), scope: item.scope, before: fullGrant(row), after: g7ScopeJson(item, bindings.tenant, scope) })
  }
  const touched = new Set(operations.filter(op => op.id).map(op => op.id))
  const nonTarget = state.grants.filter(row => !touched.has(Number(row.id)))
  const base = { version: 'collab.v1', bindings, createServiceClient: !client, operations,
    nonTarget: { count: nonTarget.length, hash: grantHash(nonTarget) }, existingClients: fullRows(state.clients) }
  return { ...base, reviewHash: sha(base) }
}

function collabCanonical(row, item, tenant) {
  const scope = scopeOf(row)
  return row.resource_code === item.resource && row.action === item.action && row.status === 'active'
    && scope.audience === item.audience && scope.semanticScope === item.scope
    && scope.tenantCode === tenant && scope.deploymentCode === item.deployment
}

export function verifyCollab(state, bindings) {
  const expected = collabGrantItems(bindings)
  const errors = []
  const clients = state.clients.filter(row => row.client_code === COLLAB_CLIENT && row.app_code === 'collab' && row.status === 'active')
  if (clients.length !== 1) errors.push('client_not_active')
  const own = state.grants.filter(row => isCollab(row) && row.status === 'active')
  for (const item of expected) {
    const matches = own.filter(row => row.resource_code === item.resource && row.action === item.action)
    if (matches.length !== 1 || !collabCanonical(matches[0], item, bindings.tenant)) errors.push(`${item.audience}|${item.scope}`)
  }
  if (own.length !== expected.length) errors.push(`unexpected_active:${own.length}/${expected.length}`)
  assert.deepEqual(errors, [], 'COLLAB_VERIFY_FAILED')
  // Token issuance is proven separately by probe-prod-service-tokens.mjs.
  return { expected: expected.length, active: expected.length, currentCredentialPointer: Boolean(clients[0].current_credential_id), tokenIssuanceVerified: false }
}

export async function applyCollab(db, input, approvedHash, hook, persistReceipt) {
  const bindings = validateCollabBindings(input)
  assert.match(approvedHash || '', /^[a-f0-9]{64}$/)
  await db.beginTransaction()
  try {
    const before = await readCollabState(db, true)
    const plan = planCollab(before, bindings)
    assert.equal(plan.reviewHash, approvedHash, 'COLLAB_REVIEW_HASH_CHANGED')
    const inserted = { grants: [], serviceClient: null }
    if (plan.createServiceClient) inserted.serviceClient = (await db.query(sql.Seed['collab-service-client']))[0].insertId
    const clientId = (await readCollabState(db)).clients.find(row => row.client_code === COLLAB_CLIENT).id
    for (const op of plan.operations) {
      if (op.kind === 'insert') {
        const [result] = await db.query(sql.Seed.grant, [clientId, op.item.resource, op.item.action, JSON.stringify(op.after)])
        assert.equal(result.affectedRows, 1)
        inserted.grants.push(Number(result.insertId))
      } else {
        const [result] = await db.query(sql.Repair.bind, [JSON.stringify(op.after), op.id])
        assert.equal(result.affectedRows, 1, 'COLLAB_BIND_DRIFT')
      }
    }
    if (hook) await hook(db)
    const after = await readCollabState(db)
    verifyCollab(after, bindings)
    const protectedIds = new Set([...plan.operations.filter(op => op.id).map(op => op.id), ...inserted.grants])
    const unchanged = after.grants.filter(row => !protectedIds.has(Number(row.id)))
    assert.deepEqual({ count: unchanged.length, hash: grantHash(unchanged) }, plan.nonTarget, 'COLLAB_NON_TARGET_CHANGED')
    assert.deepEqual(fullRows(after.clients.filter(row => Number(row.id) !== inserted.serviceClient)), plan.existingClients, 'COLLAB_OTHER_CLIENT_CHANGED')
    const receipt = { version: 'collab.v1', reviewHash: plan.reviewHash, bindings, inserted,
      restoredRows: plan.operations.filter(op => op.id).map(op => ({ id: op.id, before: op.before })),
      appliedTargetsHash: grantHash(after.grants.filter(row => protectedIds.has(Number(row.id)))), nonTarget: plan.nonTarget, existingClients: plan.existingClients }
    if (persistReceipt) await persistReceipt(receipt)
    await db.commit()
    return receipt
  } catch (error) {
    await db.rollback()
    throw error
  }
}

export async function rollbackCollab(db, receipt) {
  assert.equal(receipt.version, 'collab.v1')
  await db.beginTransaction()
  try {
    const state = await readCollabState(db, true)
    const targets = new Set([...receipt.restoredRows.map(row => row.id), ...receipt.inserted.grants])
    assert.equal(grantHash(state.grants.filter(row => targets.has(Number(row.id)))), receipt.appliedTargetsHash, 'COLLAB_ROLLBACK_TARGET_DRIFT')
    const other = state.grants.filter(row => !targets.has(Number(row.id)))
    assert.deepEqual({ count: other.length, hash: grantHash(other) }, receipt.nonTarget, 'COLLAB_ROLLBACK_NON_TARGET_DRIFT')
    assert.deepEqual(fullRows(state.clients.filter(row => Number(row.id) !== receipt.inserted.serviceClient)), receipt.existingClients, 'COLLAB_ROLLBACK_OTHER_CLIENT_DRIFT')
    for (const id of receipt.inserted.grants) assert.equal((await db.query(sql.Rollback['remove-grant'], [id]))[0].affectedRows, 1)
    for (const { id, before } of receipt.restoredRows) {
      const [result] = await db.query(sql.Rollback['restore-grant'], [before.service_client_id, before.resource_code, before.action,
        before.scope_json == null ? null : JSON.stringify(scopeOf(before)), before.status, before.created_at, before.updated_at, id])
      assert.equal(result.affectedRows, 1)
    }
    // Refuses (affectedRows 0) once a credential pointer exists.
    if (receipt.inserted.serviceClient) assert.equal((await db.query(sql.Rollback['remove-collab-service-client'], [receipt.inserted.serviceClient]))[0].affectedRows, 1, 'COLLAB_ROLLBACK_CREDENTIAL_ISSUED')
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
  assert.equal(stat.mode & 0o077, 0, 'COLLAB_CONFIG_PERMISSIONS')
  return JSON.parse(readFileSync(path, 'utf8'))
}

async function main() {
  const [mode, configPath, hashOrReceipt, receiptPath] = process.argv.slice(2)
  assert.ok(['--plan', '--apply', '--verify', '--rollback'].includes(mode), 'COLLAB_MODE_REQUIRED')
  const config = protectedJson(resolve(configPath))
  const bindings = validateCollabBindings(config.bindings)
  const db = await mysql.createConnection({ ...config.db, dateStrings: true })
  try {
    if (mode === '--plan' || mode === '--verify') {
      await db.query('START TRANSACTION READ ONLY')
      try {
        const state = await readCollabState(db)
        console.log(mode === '--plan' ? JSON.stringify(planCollab(state, bindings), null, 2) : JSON.stringify(verifyCollab(state, bindings)))
      } finally { await db.rollback() }
    } else if (mode === '--apply') {
      assert.ok(receiptPath && /^[a-f0-9]{64}$/.test(hashOrReceipt || ''), 'COLLAB_HASH_AND_RECEIPT_PATH_REQUIRED')
      const receipt = await applyCollab(db, bindings, hashOrReceipt, null, (value) => {
        writeFileSync(receiptPath, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 })
      })
      console.log(JSON.stringify({ applied: true, reviewHash: receipt.reviewHash, receiptPath }))
    } else {
      const receipt = protectedJson(resolve(hashOrReceipt))
      assert.equal(receipt.reviewHash, receiptPath, 'COLLAB_ROLLBACK_HASH_REQUIRED')
      console.log(JSON.stringify(await rollbackCollab(db, receipt)))
    }
  } finally { await db.end() }
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) main().catch((error) => {
  console.error(`COLLAB_STOPPED:${String(error?.message || error).replace(/[A-Za-z0-9._~-]{40,}/g, '[redacted]').slice(0, 160)}`)
  process.exitCode = 1
})
