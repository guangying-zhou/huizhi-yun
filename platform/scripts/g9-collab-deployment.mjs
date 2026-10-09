#!/usr/bin/env node
// G-9 step: register the standalone Collab deployment `${tenant}-collab` in the
// clone of the production Platform (user decision 2026-09-29). Candidate only:
// exercised on an isolated MySQL; never pointed at a real Platform by this repo.
//
// Shape follows the other `${tenant}-<app>` production deployments: same
// deployment_mode/region as `${tenant}-console`, the `${tenant}-main` site,
// route_source=platform_override, and the route declared by collab/app.manifest.json
// (`/collab/`, `/api/v1/collab`). The application row and manifest_path
// (`collab/app.manifest.json`, tag prefix `collab/`) already exist from migration
// v2.32; this tool never creates or edits them and stops if they are missing.
// It issues no license, runtime endpoint, token or credential: Collab is a
// supporting service, its service identity is `collab.runtime` in Console (G-7).
//
// Run AFTER g9-platform-data.mjs (needs the main site and the parent
// subscription end date it sets). Plan -> apply(reviewHash) -> verify -> rollback.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import {
  COLLAB_APP_CODE, COLLAB_DEPLOYMENT_ROUTE, COLLAB_MANIFEST_PATH, COLLAB_RELEASE_TAG_PREFIX,
  assertCollabRouteMatchesManifest, collabDeploymentCode
} from '../../deploy/self-hosted/collab-deployment.mjs'

const VERSION = 'g9.collab-deployment.v1'
const ENV = 'prod'
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const stable = value => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item))
const canonical = rows => rows.map(stable).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
const digest = rows => ({ count: rows.length, sha256: sha(canonical(rows)) })
const DEPLOYMENT_FIELDS = ['status', 'site_id', 'base_path', 'api_base', 'route_source']

export function collabSubscriptionNo(tenant) {
  return `G9-COLLAB-${tenant}`
}

export async function readCollabDeploymentState(db, lock = false) {
  const suffix = lock ? ' FOR UPDATE' : ''
  const q = async sql => (await db.query(sql + suffix))[0]
  return {
    applications: await q(`SELECT * FROM platform_applications WHERE app_code='${COLLAB_APP_CODE}' ORDER BY app_code`),
    tenant_subscriptions: await q('SELECT * FROM tenant_subscriptions ORDER BY id'),
    subscriptions: await q('SELECT * FROM subscriptions ORDER BY id'),
    deployment_sites: await q('SELECT * FROM deployment_sites ORDER BY id'),
    deployments: await q('SELECT * FROM deployments ORDER BY id')
  }
}

function cardinality(rows, label) {
  assert.equal(rows.length, 1, `G9_COLLAB_${label}_CARDINALITY`)
  return rows[0]
}

export function planCollabDeployment(state, options) {
  assert.deepEqual(Object.keys(options).sort(), ['tenant'], 'G9_COLLAB_OPTIONS')
  assertCollabRouteMatchesManifest()
  const tenant = options.tenant
  const code = collabDeploymentCode(tenant)
  const app = cardinality(state.applications, 'APPLICATION')
  assert.equal(app.status, 'active', 'G9_COLLAB_APPLICATION_NOT_ACTIVE')
  assert.equal(app.manifest_path, COLLAB_MANIFEST_PATH, 'G9_COLLAB_MANIFEST_PATH_MISSING_RUN_V2_32')
  assert.equal(app.release_tag_prefix, COLLAB_RELEASE_TAG_PREFIX, 'G9_COLLAB_RELEASE_TAG_PREFIX_MISSING_RUN_V2_32')
  const site = cardinality(state.deployment_sites.filter(r => r.site_code === `${tenant}-main` && r.tenant_code === tenant && r.environment === ENV), 'SITE')
  assert.equal(site.status, 'active', 'G9_COLLAB_SITE_NOT_ACTIVE')
  const parent = cardinality(state.tenant_subscriptions.filter(r => r.tenant_code === tenant && r.status === 'active'), 'PARENT_SUBSCRIPTION')
  const consoleDeployment = cardinality(state.deployments.filter(r => r.tenant_code === tenant && r.environment === ENV && r.app_code === 'console' && r.status === 'active'), 'CONSOLE_DEPLOYMENT')
  const route = { site_id: site.id, base_path: COLLAB_DEPLOYMENT_ROUTE.basePath, api_base: COLLAB_DEPLOYMENT_ROUTE.apiBase, route_source: COLLAB_DEPLOYMENT_ROUTE.routeSource }

  const owned = state.deployments.filter(r => r.tenant_code === tenant && r.app_code === COLLAB_APP_CODE && r.environment === ENV)
  assert.ok(owned.every(r => r.deployment_code === code), 'G9_COLLAB_FOREIGN_DEPLOYMENT_CODE')
  assert.ok(!state.deployments.some(r => r.deployment_code === code && (r.tenant_code !== tenant || r.app_code !== COLLAB_APP_CODE)), 'G9_COLLAB_CODE_TAKEN')
  assert.ok(owned.length <= 1, 'G9_COLLAB_DEPLOYMENT_CARDINALITY')
  const pathClash = state.deployments.find(r => r.status === 'active' && r.site_id === site.id && r.base_path === route.base_path && r.deployment_code !== code)
  assert.ok(!pathClash, 'G9_COLLAB_ROUTE_CLASH')

  const operations = []
  let subscription = state.subscriptions.find(r => r.tenant_code === tenant && r.app_code === COLLAB_APP_CODE && r.status === 'active')
  if (owned[0])
    subscription = state.subscriptions.find(r => String(r.id) === String(owned[0].subscription_id)) || subscription
  if (!subscription) {
    operations.push({ kind: 'insert-subscription', subscription_no: collabSubscriptionNo(tenant),
      row: { subscription_no: collabSubscriptionNo(tenant), tenant_subscription_id: parent.id, tenant_code: tenant, app_code: COLLAB_APP_CODE,
        plan_code: parent.plan_code, status: 'active', source: 'ops_grant', started_at: parent.started_at ?? null, ended_at: parent.ended_at ?? null } })
  } else {
    assert.ok(subscription.tenant_code === tenant && subscription.app_code === COLLAB_APP_CODE && subscription.status === 'active', 'G9_COLLAB_SUBSCRIPTION_INVALID')
  }
  if (!owned[0]) {
    operations.push({ kind: 'insert-deployment', deployment_code: code,
      row: { deployment_code: code, tenant_code: tenant, app_code: COLLAB_APP_CODE, subscription_id: subscription ? subscription.id : null,
        ...route, deployment_name: `${tenant} · ${COLLAB_APP_CODE}`, deployment_mode: consoleDeployment.deployment_mode,
        environment: ENV, region: consoleDeployment.region ?? null, status: 'active', license_status: 'pending', connectivity_status: 'pending' } })
  } else {
    const wanted = { status: 'active', ...route }
    const after = Object.fromEntries(DEPLOYMENT_FIELDS.filter(f => String(owned[0][f] ?? '') !== String(wanted[f] ?? '')).map(f => [f, wanted[f]]))
    if (Object.keys(after).length)
      operations.push({ kind: 'update-deployment', deployment_code: code, beforeSha256: sha(stable(owned[0])), after })
  }
  const isTarget = { subscription: r => r.subscription_no === collabSubscriptionNo(tenant), deployment: r => r.deployment_code === code }
  const nonTarget = { subscriptions: digest(state.subscriptions.filter(r => !isTarget.subscription(r))), deployments: digest(state.deployments.filter(r => !isTarget.deployment(r))) }
  const base = { version: VERSION, options, deploymentCode: code, operations, nonTarget,
    handoffs: ['no license, runtime endpoint or token is issued for collab; service identity is collab.runtime (G-7 / collab-prod-registration)',
      'Gateway apps.collab.deploymentCode and Runtime deploymentBindings.collab must equal the registered code (check-collab-deployment.mjs)'] }
  return { ...base, reviewHash: sha(base) }
}

export function verifyCollabDeployment(state, options) {
  const { tenant } = options
  const code = collabDeploymentCode(tenant)
  const site = state.deployment_sites.find(r => r.site_code === `${tenant}-main` && r.environment === ENV)
  const rows = state.deployments.filter(r => r.tenant_code === tenant && r.app_code === COLLAB_APP_CODE && r.status === 'active')
  assert.equal(rows.length, 1, 'G9_COLLAB_VERIFY_ACTIVE_CARDINALITY')
  const row = rows[0]
  assert.equal(row.deployment_code, code, 'G9_COLLAB_VERIFY_CODE')
  assert.equal(row.environment, ENV)
  assert.equal(String(row.site_id), String(site?.id), 'G9_COLLAB_VERIFY_SITE')
  assert.equal(row.base_path, COLLAB_DEPLOYMENT_ROUTE.basePath)
  assert.equal(row.api_base, COLLAB_DEPLOYMENT_ROUTE.apiBase)
  assert.equal(row.route_source, COLLAB_DEPLOYMENT_ROUTE.routeSource)
  const subscription = state.subscriptions.find(r => String(r.id) === String(row.subscription_id))
  assert.ok(subscription && subscription.status === 'active' && subscription.tenant_code === tenant && subscription.app_code === COLLAB_APP_CODE, 'G9_COLLAB_VERIFY_SUBSCRIPTION')
  return { verified: true, deploymentCode: code }
}

const insert = async (db, table, row) => {
  const fields = Object.keys(row)
  const [result] = await db.query(`INSERT INTO \`${table}\` (${fields.map(f => `\`${f}\``).join(',')}) VALUES (${fields.map(() => '?').join(',')})`, Object.values(row))
  return result.insertId
}

export async function applyCollabDeployment(db, options, approvedHash, persistReceipt, hook) {
  assert.match(approvedHash, /^[a-f0-9]{64}$/)
  await db.beginTransaction()
  try {
    const before = await readCollabDeploymentState(db, true)
    const plan = planCollabDeployment(before, options)
    assert.equal(plan.reviewHash, approvedHash, 'G9_COLLAB_REVIEW_HASH_CHANGED')
    const saved = { insertedSubscriptionId: null, insertedDeploymentId: null, updated: null }
    let subscriptionId = null
    for (const op of plan.operations) {
      if (op.kind === 'insert-subscription') {
        subscriptionId = await insert(db, 'subscriptions', op.row)
        saved.insertedSubscriptionId = Number(subscriptionId)
      } else
        if (op.kind === 'insert-deployment') {
          const row = { ...op.row, subscription_id: op.row.subscription_id ?? subscriptionId }
          assert.ok(row.subscription_id, 'G9_COLLAB_SUBSCRIPTION_REQUIRED')
          saved.insertedDeploymentId = Number(await insert(db, 'deployments', row))
        } else {
          const current = before.deployments.find(r => r.deployment_code === op.deployment_code)
          assert.equal(sha(stable(current)), op.beforeSha256, 'G9_COLLAB_TARGET_CHANGED')
          saved.updated = { id: Number(current.id), before: Object.fromEntries(Object.keys(op.after).map(f => [f, current[f]])) }
          const assignments = Object.keys(op.after).map(f => `\`${f}\`=?`)
          if (Object.hasOwn(current, 'updated_at'))
            assignments.push('`updated_at`=UTC_TIMESTAMP()')
          const [result] = await db.query(`UPDATE deployments SET ${assignments.join(',')} WHERE id=?`, [...Object.values(op.after), current.id])
          assert.equal(result.affectedRows, 1, 'G9_COLLAB_UPDATE_CARDINALITY')
        }
    }
    if (hook)
      await hook(db)
    const after = await readCollabDeploymentState(db, true)
    assert.deepEqual({ subscriptions: digest(after.subscriptions.filter(r => r.subscription_no !== collabSubscriptionNo(options.tenant))),
      deployments: digest(after.deployments.filter(r => r.deployment_code !== plan.deploymentCode)) }, plan.nonTarget, 'G9_COLLAB_NON_TARGET_CHANGED')
    verifyCollabDeployment(after, options)
    const target = after.deployments.find(r => r.deployment_code === plan.deploymentCode)
    const receipt = { version: VERSION, reviewHash: plan.reviewHash, options, saved, deploymentCode: plan.deploymentCode,
      afterSha256: sha(stable(target)),
      afterSubscriptionSha256: saved.insertedSubscriptionId ? sha(stable(after.subscriptions.find(r => Number(r.id) === saved.insertedSubscriptionId))) : null,
      nonTarget: plan.nonTarget }
    if (persistReceipt)
      await persistReceipt(receipt)
    await db.commit()
    return receipt
  } catch (error) {
    await db.rollback()
    throw error
  }
}

export async function rollbackCollabDeployment(db, receipt) {
  assert.equal(receipt.version, VERSION)
  await db.beginTransaction()
  try {
    const state = await readCollabDeploymentState(db, true)
    const { tenant } = receipt.options
    const isSub = r => r.subscription_no === collabSubscriptionNo(tenant)
    const isDep = r => r.deployment_code === receipt.deploymentCode
    assert.deepEqual({ subscriptions: digest(state.subscriptions.filter(r => !isSub(r))), deployments: digest(state.deployments.filter(r => !isDep(r))) },
      receipt.nonTarget, 'G9_COLLAB_ROLLBACK_NON_TARGET_CHANGED')
    assert.equal(sha(stable(state.deployments.find(isDep) ?? null)), receipt.afterSha256, 'G9_COLLAB_ROLLBACK_TARGET_CHANGED')
    if (receipt.saved.insertedDeploymentId) {
      const [result] = await db.query('DELETE FROM deployments WHERE id=? AND deployment_code=?', [receipt.saved.insertedDeploymentId, receipt.deploymentCode])
      assert.equal(result.affectedRows, 1, 'G9_COLLAB_ROLLBACK_DELETE_DEPLOYMENT')
    }
    if (receipt.saved.insertedSubscriptionId) {
      assert.equal(sha(stable(state.subscriptions.find(r => Number(r.id) === receipt.saved.insertedSubscriptionId))), receipt.afterSubscriptionSha256, 'G9_COLLAB_ROLLBACK_SUBSCRIPTION_CHANGED')
      const [result] = await db.query('DELETE FROM subscriptions WHERE id=? AND subscription_no=?', [receipt.saved.insertedSubscriptionId, collabSubscriptionNo(tenant)])
      assert.equal(result.affectedRows, 1, 'G9_COLLAB_ROLLBACK_DELETE_SUBSCRIPTION')
    }
    if (receipt.saved.updated) {
      const fields = Object.keys(receipt.saved.updated.before)
      const [result] = await db.query(`UPDATE deployments SET ${fields.map(f => `\`${f}\`=?`).join(',')} WHERE id=?`, [...Object.values(receipt.saved.updated.before), receipt.saved.updated.id])
      assert.equal(result.affectedRows, 1)
    }
    await db.commit()
    return { restored: true }
  } catch (error) {
    await db.rollback()
    throw error
  }
}

function protectedJson(path) {
  const stat = statSync(path)
  assert.ok(stat.isFile() && (stat.mode & 0o077) === 0, 'G9_PROTECTED_FILE_REQUIRED')
  return JSON.parse(readFileSync(path, 'utf8'))
}
async function main() {
  const [mode, configPath, hashOrReceipt, receiptPath] = process.argv.slice(2)
  assert.ok(['--plan', '--apply', '--rollback', '--verify'].includes(mode), 'G9_COLLAB_MODE')
  // Same db.json as g9-platform-data.mjs, plus {"collab":{"tenant":"C000001"}}.
  const { db, collab } = protectedJson(resolve(configPath))
  const options = { tenant: collab?.tenant }
  const connection = await mysql.createConnection({ ...db, dateStrings: true, timezone: 'Z' })
  try {
    if (mode === '--plan' || mode === '--verify') {
      await connection.query('START TRANSACTION READ ONLY')
      try {
        const state = await readCollabDeploymentState(connection)
        console.log(mode === '--plan' ? JSON.stringify(planCollabDeployment(state, options), null, 2) : JSON.stringify(verifyCollabDeployment(state, options)))
      } finally {
        await connection.rollback()
      }
    } else
      if (mode === '--apply') {
        assert.ok(receiptPath, 'G9_COLLAB_RECEIPT_PATH_REQUIRED')
        const receipt = await applyCollabDeployment(connection, options, hashOrReceipt, value => writeFileSync(receiptPath, JSON.stringify(value), { flag: 'wx', mode: 0o600 }))
        console.log(JSON.stringify({ applied: true, reviewHash: receipt.reviewHash, receiptPath }))
      } else {
        const receipt = protectedJson(resolve(hashOrReceipt))
        assert.equal(receipt.reviewHash, receiptPath, 'G9_COLLAB_ROLLBACK_HASH_REQUIRED')
        console.log(JSON.stringify(await rollbackCollabDeployment(connection, receipt)))
      }
  } finally {
    await connection.end()
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(`G9_COLLAB_STOPPED:${String(error.message).slice(0, 200)}`)
    process.exitCode = 1
  })
