#!/usr/bin/env node
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto'
import process from 'node:process'
import mysql from 'mysql2/promise'

const SANITIZED_MODE = 'sanitized'
const READY_MODE = 'ready'

const SANITIZED_EMPTY_TABLES = [
  'platform_sessions',
  'platform_email_activation_tokens',
  'platform_api_keys',
  'platform_webhooks',
  'platform_audit_logs',
  'platform_signing_keys',
  'deployment_bootstrap_secrets',
  'deployment_connectivity_checks',
  'deployment_heartbeats',
  'policy_bundle_targets',
  'policy_bundles',
  'revocation_snapshot_targets',
  'revocation_entries',
  'revocation_snapshots',
  'license_capabilities',
  'license_deployments',
  'licenses',
  'tenant_runtime_credentials',
  'tenant_sessions',
  'tenant_audit_logs'
]

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue

    const raw = item.slice(2)
    const equalsIndex = raw.indexOf('=')
    if (equalsIndex >= 0) {
      args[raw.slice(0, equalsIndex)] = raw.slice(equalsIndex + 1)
      continue
    }

    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      args[raw] = true
      continue
    }

    args[raw] = next
    index += 1
  }
  return args
}

function usage() {
  return `
Usage:
  pnpm run db:verify-dev -- --db hzy_platform_dev --mode sanitized
  pnpm run db:verify-dev -- --db hzy_platform_dev --mode ready --expected-test-deployment-code wiztek-test-console

Modes:
  sanitized  Verify the freshly cloned dev DB has no copied production runtime/signing/license/session material.
  ready      Verify platform-dev has regenerated dev signing material, test runtime token, test license and test policy bundle.

Ready-mode options:
  --expected-test-deployment-code <code>   Required. Expected active test Console deployment.
  --expected-test-environment <env>        Default: test.
  --expected-test-app-code <appCode>       Default: console.
  --expected-test-public-url <url>         Optional deployment site public URL check.
  --require-heartbeat                     Optional check that console-test has heartbeated at least once.

The script never prints token, license or private key values.
`
}

function stringValue(value) {
  return String(value || '').trim()
}

function option(args, key, fallback = '') {
  return stringValue(args[key] || fallback)
}

function optionBool(args, key) {
  return args[key] === true || ['1', 'true', 'yes', 'on'].includes(stringValue(args[key]).toLowerCase())
}

function parseJson(value) {
  if (value && typeof value === 'object') {
    return value
  }

  try {
    return JSON.parse(stringValue(value))
  } catch {
    return null
  }
}

function normalizeJson(value) {
  if (value === null || value === undefined) {
    return null
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeJson(item))
  }

  if (typeof value === 'object') {
    const record = value
    const normalized = {}
    for (const key of Object.keys(record).sort()) {
      normalized[key] = normalizeJson(record[key])
    }
    return normalized
  }

  if (['string', 'number', 'boolean'].includes(typeof value)) {
    return value
  }

  return String(value)
}

function stableStringify(value) {
  return JSON.stringify(normalizeJson(value))
}

function hashBundlePayload(payloadJson) {
  return `sha256_${createHash('sha256').update(payloadJson).digest('hex')}`
}

function verifyEd25519(publicKeyPem, payload, signature) {
  try {
    return verifySignature(
      null,
      Buffer.from(payload),
      createPublicKey(publicKeyPem),
      Buffer.from(signature, 'base64url')
    )
  } catch {
    return false
  }
}

function passwordFrom(args, fallback = '') {
  const explicit = option(args, 'password')
  if (explicit) return explicit

  const envName = option(args, 'password-env')
  if (envName) return stringValue(process.env[envName])

  return fallback
}

function assertMysqlIdentifier(value, label) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`${label} must contain only letters, numbers and underscores: ${value}`)
  }
}

async function tableExists(connection, table) {
  const [rows] = await connection.query(
    'SELECT TABLE_NAME AS tableName FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1',
    [table]
  )
  return Boolean(rows[0])
}

async function countRows(connection, table, where = '1=1', params = []) {
  if (!await tableExists(connection, table)) {
    return null
  }

  const [rows] = await connection.query(`SELECT COUNT(*) AS total FROM \`${table}\` WHERE ${where}`, params)
  return Number(rows[0]?.total || 0)
}

async function checkEmptyTables(connection) {
  const failures = []
  for (const table of SANITIZED_EMPTY_TABLES) {
    const total = await countRows(connection, table)
    if (total == null) continue
    if (total > 0) {
      failures.push(`${table} has ${total} row(s)`)
    }
  }
  return failures
}

async function queryOne(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params)
  return rows[0] || null
}

async function checkReadyArtifacts(connection, args) {
  const failures = []
  const expectedTestDeployment = option(args, 'expected-test-deployment-code')
  const expectedEnvironment = option(args, 'expected-test-environment', 'test')
  const expectedAppCode = option(args, 'expected-test-app-code', 'console')
  const expectedPublicUrl = option(args, 'expected-test-public-url')
  const requireHeartbeat = optionBool(args, 'require-heartbeat')

  if (!expectedTestDeployment) {
    failures.push('--expected-test-deployment-code is required in ready mode')
    return failures
  }

  for (const table of [
    'platform_signing_keys',
    'deployments',
    'tenant_runtime_credentials',
    'licenses',
    'license_deployments',
    'policy_bundles',
    'policy_bundle_targets'
  ]) {
    if (!await tableExists(connection, table)) {
      failures.push(`required table is missing in ready mode: ${table}`)
    }
  }
  if (failures.length) return failures

  const activeSigningCountRow = await queryOne(
    connection,
    `SELECT COUNT(*) AS total
     FROM platform_signing_keys
     WHERE status = 'active'`
  )
  const activeSigningCount = Number(activeSigningCountRow?.total || 0)
  if (activeSigningCount !== 1) {
    failures.push(`platform_signing_keys must contain exactly one active dev key, found ${activeSigningCount}`)
  }
  const activeSigning = activeSigningCount === 1
    ? await queryOne(
        connection,
        `SELECT kid, alg, public_key AS publicKey
         FROM platform_signing_keys
         WHERE status = 'active'
         LIMIT 1`
      )
    : null
  const activeSigningKid = stringValue(activeSigning?.kid)
  const activeSigningPublicKey = stringValue(activeSigning?.publicKey)
  if (activeSigning && stringValue(activeSigning.alg) !== 'Ed25519') {
    failures.push(`expected active signing key alg Ed25519, got ${stringValue(activeSigning.alg) || '<empty>'}`)
  }

  const deployment = await queryOne(
    connection,
    `SELECT id, tenant_code, app_code, deployment_code, environment, status,
            license_status, connectivity_status, last_heartbeat_at, site_id
     FROM deployments
     WHERE deployment_code = ?
     LIMIT 1`,
    [expectedTestDeployment]
  )

  if (!deployment) {
    failures.push(`expected test deployment not found: ${expectedTestDeployment}`)
    return failures
  }

  const tenantCode = stringValue(deployment.tenant_code)
  const deploymentId = Number(deployment.id || 0)

  if (stringValue(deployment.environment) !== expectedEnvironment) {
    failures.push(`expected deployment environment ${expectedEnvironment}, got ${stringValue(deployment.environment) || '<empty>'}`)
  }
  if (stringValue(deployment.status) !== 'active') {
    failures.push(`expected deployment status active, got ${stringValue(deployment.status) || '<empty>'}`)
  }
  if (stringValue(deployment.app_code) !== expectedAppCode) {
    failures.push(`expected deployment app_code ${expectedAppCode}, got ${stringValue(deployment.app_code) || '<empty>'}`)
  }
  if (stringValue(deployment.license_status) !== 'active') {
    failures.push(`expected deployment license_status active, got ${stringValue(deployment.license_status) || '<empty>'}`)
  }
  if (requireHeartbeat && !deployment.last_heartbeat_at) {
    failures.push(`expected heartbeat on deployment: ${expectedTestDeployment}`)
  }

  if (expectedPublicUrl && await tableExists(connection, 'deployment_sites')) {
    const site = await queryOne(
      connection,
      `SELECT public_url AS publicUrl, environment, status
       FROM deployment_sites
       WHERE id = ?
       LIMIT 1`,
      [deployment.site_id]
    )
    if (!site) {
      failures.push(`expected deployment site for ${expectedTestDeployment}`)
    } else {
      const publicUrl = stringValue(site.publicUrl).replace(/\/+$/, '')
      if (publicUrl !== expectedPublicUrl.replace(/\/+$/, '')) {
        failures.push(`expected deployment site public_url ${expectedPublicUrl}, got ${publicUrl || '<empty>'}`)
      }
      if (stringValue(site.environment) !== expectedEnvironment || stringValue(site.status) !== 'active') {
        failures.push(`expected active ${expectedEnvironment} deployment site, got environment=${stringValue(site.environment) || '<empty>'}, status=${stringValue(site.status) || '<empty>'}`)
      }
    }
  }

  const credential = await queryOne(
    connection,
    `SELECT runtime_token_last4 AS runtimeTokenLast4, status, revoked_at AS revokedAt, expires_at AS expiresAt
     FROM tenant_runtime_credentials
     WHERE tenant_code = ?
     LIMIT 1`,
    [tenantCode]
  )
  if (!credential) {
    failures.push(`expected active runtime credential for tenant: ${tenantCode}`)
  } else {
    if (stringValue(credential.status) !== 'active') {
      failures.push(`expected runtime credential status active, got ${stringValue(credential.status) || '<empty>'}`)
    }
    if (credential.revokedAt) {
      failures.push(`runtime credential is revoked for tenant: ${tenantCode}`)
    }
    if (!stringValue(credential.runtimeTokenLast4)) {
      failures.push(`runtime credential last4 is missing for tenant: ${tenantCode}`)
    }
  }

  const license = await queryOne(
    connection,
    `SELECT l.id, l.license_code AS licenseCode, l.status, l.signed_token AS signedToken,
            ld.status AS deploymentStatus
     FROM licenses l
     INNER JOIN license_deployments ld ON ld.license_id = l.id
     WHERE l.tenant_code = ?
       AND ld.deployment_id = ?
     ORDER BY CASE WHEN ld.status = 'active' THEN 0 ELSE 1 END, l.id DESC
     LIMIT 1`,
    [tenantCode, deploymentId]
  )
  if (!license) {
    failures.push(`expected license bound to deployment: ${expectedTestDeployment}`)
  } else {
    if (!['active', 'grace'].includes(stringValue(license.status))) {
      failures.push(`expected license status active/grace, got ${stringValue(license.status) || '<empty>'}`)
    }
    if (stringValue(license.deploymentStatus) !== 'active') {
      failures.push(`expected active license_deployments row, got ${stringValue(license.deploymentStatus) || '<empty>'}`)
    }
    if (!stringValue(license.signedToken)) {
      failures.push(`expected signed license token for deployment: ${expectedTestDeployment}`)
    } else if (activeSigningKid) {
      const licenseToken = parseJson(license.signedToken)
      if (!licenseToken) {
        failures.push(`expected signed license token to be valid JSON for deployment: ${expectedTestDeployment}`)
      } else {
        if (stringValue(licenseToken.schemaVersion) !== 'license-token.v1') {
          failures.push(`expected license token schemaVersion license-token.v1, got ${stringValue(licenseToken.schemaVersion) || '<empty>'}`)
        }
        if (stringValue(licenseToken.kid) !== activeSigningKid) {
          failures.push(`expected license token kid ${activeSigningKid}, got ${stringValue(licenseToken.kid) || '<empty>'}`)
        }
        if (stringValue(licenseToken.alg) !== 'Ed25519') {
          failures.push(`expected license token alg Ed25519, got ${stringValue(licenseToken.alg) || '<empty>'}`)
        }
        if (!stringValue(licenseToken.signature)) {
          failures.push(`expected license token signature for deployment: ${expectedTestDeployment}`)
        }
        if (!licenseToken.payload || typeof licenseToken.payload !== 'object') {
          failures.push(`expected license token payload for deployment: ${expectedTestDeployment}`)
        } else {
          const payload = licenseToken.payload
          if (stringValue(payload.tenantCode) !== tenantCode) {
            failures.push(`expected license token tenantCode ${tenantCode}, got ${stringValue(payload.tenantCode) || '<empty>'}`)
          }
          if (stringValue(payload.appCode) !== expectedAppCode) {
            failures.push(`expected license token appCode ${expectedAppCode}, got ${stringValue(payload.appCode) || '<empty>'}`)
          }
          if (Number(payload.deploymentId || 0) !== deploymentId) {
            failures.push(`expected license token deploymentId ${deploymentId}, got ${Number(payload.deploymentId || 0)}`)
          }
          if (stringValue(payload.deploymentCode) !== expectedTestDeployment) {
            failures.push(`expected license token deploymentCode ${expectedTestDeployment}, got ${stringValue(payload.deploymentCode) || '<empty>'}`)
          }
          if (
            activeSigningPublicKey
            && stringValue(licenseToken.signature)
            && !verifyEd25519(activeSigningPublicKey, JSON.stringify(payload), stringValue(licenseToken.signature))
          ) {
            failures.push(`license token signature does not verify with active dev signing key: ${expectedTestDeployment}`)
          }
        }
      }
    }
  }

  const bundle = await queryOne(
    connection,
    `SELECT pb.id, pb.bundle_version AS bundleVersion, pb.bundle_hash AS bundleHash,
            pb.bundle_payload_json AS payloadJson,
            pb.signature, pb.signed_by_kid AS signedByKid, pb.signed_at AS signedAt,
            pb.schema_version AS schemaVersion,
            pbt.status AS targetStatus
     FROM policy_bundles pb
     INNER JOIN policy_bundle_targets pbt ON pbt.bundle_id = pb.id
     WHERE pb.tenant_code = ?
       AND pb.environment = ?
       AND pb.status = 'active'
       AND pbt.deployment_id = ?
     ORDER BY pb.issued_at DESC, pb.id DESC
     LIMIT 1`,
    [tenantCode, expectedEnvironment, deploymentId]
  )
  if (!bundle) {
    failures.push(`expected active policy bundle target for deployment: ${expectedTestDeployment}`)
  } else {
    for (const [key, label] of [
      ['bundleVersion', 'bundle version'],
      ['bundleHash', 'bundle hash'],
      ['signature', 'bundle signature'],
      ['signedByKid', 'bundle signing kid'],
      ['signedAt', 'bundle signed_at']
    ]) {
      if (!stringValue(bundle[key])) {
        failures.push(`expected ${label} on active policy bundle for ${expectedTestDeployment}`)
      }
    }
    if (!['pending', 'delivered'].includes(stringValue(bundle.targetStatus))) {
      failures.push(`expected policy bundle target status pending/delivered, got ${stringValue(bundle.targetStatus) || '<empty>'}`)
    }
    if (activeSigningKid && stringValue(bundle.signedByKid) !== activeSigningKid) {
      failures.push(`expected policy bundle signed_by_kid ${activeSigningKid}, got ${stringValue(bundle.signedByKid) || '<empty>'}`)
    }
    if (stringValue(bundle.schemaVersion) !== 'policy-bundle.v1') {
      failures.push(`expected policy bundle schemaVersion policy-bundle.v1, got ${stringValue(bundle.schemaVersion) || '<empty>'}`)
    }

    const bundlePayload = parseJson(bundle.payloadJson)
    if (!bundlePayload) {
      failures.push(`expected policy bundle payload JSON for ${expectedTestDeployment}`)
    } else {
      const payloadJson = stableStringify(bundlePayload)
      const expectedBundleHash = hashBundlePayload(payloadJson)
      if (stringValue(bundle.bundleHash) !== expectedBundleHash) {
        failures.push(`expected policy bundle hash ${expectedBundleHash}, got ${stringValue(bundle.bundleHash) || '<empty>'}`)
      }
      if (activeSigningPublicKey && stringValue(bundle.signature) && !verifyEd25519(activeSigningPublicKey, payloadJson, stringValue(bundle.signature))) {
        failures.push(`policy bundle signature does not verify with active dev signing key: ${expectedTestDeployment}`)
      }
    }
  }

  if (requireHeartbeat && await tableExists(connection, 'deployment_heartbeats')) {
    const heartbeatCount = await countRows(connection, 'deployment_heartbeats', 'deployment_id = ?', [deploymentId])
    if (!heartbeatCount) {
      failures.push(`expected at least one deployment_heartbeats row for ${expectedTestDeployment}`)
    }
  }

  return failures
}

async function checkDeploymentState(connection, args, options = {}) {
  const failures = []
  if (!await tableExists(connection, 'deployments')) {
    return failures
  }

  const prodActive = await countRows(connection, 'deployments', 'environment = ? AND status = ?', ['prod', 'active'])
  if (prodActive && prodActive > 0) {
    failures.push(`deployments has ${prodActive} active prod deployment(s)`)
  }

  if (!options.allowRuntimeState) {
    const staleRuntime = await countRows(
      connection,
      'deployments',
      `current_kid IS NOT NULL
        OR current_pubkey_fingerprint IS NOT NULL
        OR last_kid_reported_at IS NOT NULL
        OR last_key_rotated_at IS NOT NULL
        OR last_heartbeat_at IS NOT NULL
        OR last_reported_at IS NOT NULL
        OR last_connectivity_check_at IS NOT NULL
        OR connectivity_verified_at IS NOT NULL`
    )
    if (staleRuntime && staleRuntime > 0) {
      failures.push(`deployments has ${staleRuntime} row(s) with stale runtime state`)
    }
  }

  const expectedTestDeployment = option(args, 'expected-test-deployment-code')
  if (expectedTestDeployment) {
    const environment = option(args, 'expected-test-environment', 'test')
    const activeTest = await countRows(
      connection,
      'deployments',
      'deployment_code = ? AND environment = ? AND status = ?',
      [expectedTestDeployment, environment, 'active']
    )
    if (!activeTest) {
      failures.push(`expected active ${environment} deployment not found: ${expectedTestDeployment}`)
    }
  }

  return failures
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || args.h) {
    console.info(usage().trim())
    return
  }

  const database = option(args, 'db', process.env.DB_NAME || 'hzy_platform_dev')
  const mode = option(args, 'mode', SANITIZED_MODE)
  if (![SANITIZED_MODE, READY_MODE].includes(mode)) {
    throw new Error(`mode must be ${SANITIZED_MODE} or ${READY_MODE}: ${mode}`)
  }
  const allowUnsafeTarget = optionBool(args, 'allow-target-without-dev-suffix')
  if (!allowUnsafeTarget && !database.endsWith('_dev')) {
    throw new Error(`target database must end with _dev: ${database}`)
  }
  assertMysqlIdentifier(database, 'db')

  const config = {
    host: option(args, 'host', process.env.DB_HOST || '127.0.0.1'),
    port: Number(option(args, 'port', process.env.DB_PORT || '3306')),
    user: option(args, 'user', process.env.DB_USER || 'root'),
    password: passwordFrom(args, process.env.DB_PASSWORD || ''),
    database
  }

  console.info(`[platform-dev-db] verifying ${config.user}@${config.host}:${config.port}/${config.database} mode=${mode}`)

  const connection = await mysql.createConnection({
    ...config,
    multipleStatements: false
  })
  try {
    const failures = mode === READY_MODE
      ? [
          ...await checkDeploymentState(connection, args, { allowRuntimeState: true }),
          ...await checkReadyArtifacts(connection, args)
        ]
      : [
          ...await checkEmptyTables(connection),
          ...await checkDeploymentState(connection, args)
        ]

    if (failures.length) {
      console.error('[platform-dev-db] verification failed:')
      for (const failure of failures) {
        console.error(`  - ${failure}`)
      }
      process.exitCode = 1
      return
    }

    console.info('[platform-dev-db] verification passed')
  } finally {
    await connection.end()
  }
}

main().catch((error) => {
  console.error(`[platform-dev-db] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
