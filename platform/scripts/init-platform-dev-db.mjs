#!/usr/bin/env node
import { spawn } from 'node:child_process'
import process from 'node:process'
import mysql from 'mysql2/promise'

const SENSITIVE_TABLES = [
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

const DEPLOYMENT_RUNTIME_COLUMNS = [
  'current_kid = NULL',
  'current_pubkey_fingerprint = NULL',
  'last_kid_reported_at = NULL',
  'last_key_rotated_at = NULL',
  'reported_app_version = NULL',
  'reported_manifest_version = NULL',
  'reported_manifest_hash = NULL',
  'reported_sdk_version = NULL',
  'reported_directory_contract_version = NULL',
  'reported_directory_snapshot_hash = NULL',
  'reported_directory_sync_cursor = NULL',
  'reported_directory_user_count = NULL',
  'reported_directory_department_count = NULL',
  'reported_directory_project_count = NULL',
  'reported_directory_sync_lag_seconds = NULL',
  'last_reported_at = NULL',
  'version_status = \'unknown\'',
  'last_directory_sync_at = NULL',
  'directory_contract_status = \'n/a\'',
  'directory_sync_status = \'n/a\'',
  'last_heartbeat_at = NULL',
  'last_connectivity_check_at = NULL',
  'last_connectivity_check_status = NULL',
  'last_connectivity_check_summary = NULL',
  'connectivity_verified_at = NULL'
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

function stringValue(value) {
  return String(value || '').trim()
}

function option(args, key, fallback = '') {
  return stringValue(args[key] || fallback)
}

function optionBool(args, key) {
  return args[key] === true || ['1', 'true', 'yes', 'on'].includes(stringValue(args[key]).toLowerCase())
}

function passwordFrom(args, prefix, fallback = '') {
  const explicit = option(args, `${prefix}-password`)
  if (explicit) return explicit

  const envName = option(args, `${prefix}-password-env`)
  if (envName) return stringValue(process.env[envName])

  return fallback
}

function mysqlIdentity(config) {
  return `${config.user}@${config.host}:${config.port}/${config.database}`
}

function assertMysqlIdentifier(value, label) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`${label} must contain only letters, numbers and underscores: ${value}`)
  }
}

function mysqlArgs(config, database = '') {
  const args = [
    `--host=${config.host}`,
    `--port=${config.port}`,
    `--user=${config.user}`,
    '--default-character-set=utf8mb4'
  ]
  if (database) args.push(database)
  return args
}

function createEnvWithPassword(password) {
  return {
    ...process.env,
    MYSQL_PWD: password
  }
}

function runPipedClone(source, target) {
  return new Promise((resolve, reject) => {
    const dump = spawn('mysqldump', [
      ...mysqlArgs(source),
      '--single-transaction',
      '--routines',
      '--triggers',
      '--events',
      '--hex-blob',
      '--skip-lock-tables',
      source.database
    ], {
      env: createEnvWithPassword(source.password),
      stdio: ['ignore', 'pipe', 'inherit']
    })
    const mysqlImport = spawn('mysql', mysqlArgs(target, target.database), {
      env: createEnvWithPassword(target.password),
      stdio: ['pipe', 'inherit', 'inherit']
    })

    dump.stdout.pipe(mysqlImport.stdin)

    let failed = false
    function fail(error) {
      if (failed) return
      failed = true
      reject(error)
    }

    dump.on('error', fail)
    mysqlImport.on('error', fail)
    dump.on('close', (code) => {
      if (code) fail(new Error(`mysqldump exited with ${code}`))
    })
    mysqlImport.on('close', (code) => {
      if (failed) return
      if (code) {
        fail(new Error(`mysql import exited with ${code}`))
        return
      }
      resolve()
    })
  })
}

async function databaseExists(connection, database) {
  const [rows] = await connection.query(
    'SELECT SCHEMA_NAME AS schemaName FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ? LIMIT 1',
    [database]
  )
  return Boolean(rows[0])
}

async function tableExists(connection, table) {
  const [rows] = await connection.query(
    'SELECT TABLE_NAME AS tableName FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1',
    [table]
  )
  return Boolean(rows[0])
}

async function wipeTable(connection, table) {
  if (!await tableExists(connection, table)) {
    return false
  }

  await connection.query(`DELETE FROM \`${table}\``)
  await connection.query(`ALTER TABLE \`${table}\` AUTO_INCREMENT = 1`).catch(() => undefined)
  return true
}

async function neutralizeRuntimeState(connection) {
  await connection.query('SET FOREIGN_KEY_CHECKS = 0')
  const wiped = []
  try {
    for (const table of SENSITIVE_TABLES) {
      if (await wipeTable(connection, table)) wiped.push(table)
    }
  } finally {
    await connection.query('SET FOREIGN_KEY_CHECKS = 1')
  }

  if (await tableExists(connection, 'deployment_sites')) {
    await connection.query(
      `UPDATE deployment_sites
         SET status = 'inactive',
             updated_at = UTC_TIMESTAMP()`
    )
  }

  if (await tableExists(connection, 'deployments')) {
    await connection.query(
      `UPDATE deployments
         SET status = 'inactive',
             license_status = 'pending',
             connectivity_status = 'pending',
             runtime_endpoint = NULL,
             callback_url = NULL,
             webhook_url = NULL,
             ${DEPLOYMENT_RUNTIME_COLUMNS.join(',\n             ')},
             updated_at = UTC_TIMESTAMP()`
    )
  }

  return wiped
}

async function seedConsoleTestDeployment(connection, options) {
  const sourceDeploymentCode = option(options, 'source-deployment-code')
  const targetDeploymentCode = option(options, 'target-deployment-code')
  const targetSiteCode = option(options, 'target-site-code')
  const publicUrl = option(options, 'target-public-url').replace(/\/+$/, '')
  const environment = option(options, 'target-environment', 'test')
  const basePath = option(options, 'target-base-path', '/')
  const apiBase = option(options, 'target-api-base', '/api/v1/console')

  const missing = Object.entries({
    'source-deployment-code': sourceDeploymentCode,
    'target-deployment-code': targetDeploymentCode,
    'target-site-code': targetSiteCode,
    'target-public-url': publicUrl
  }).filter(([, value]) => !value).map(([key]) => key)
  if (missing.length) {
    throw new Error(`--seed-console-test requires ${missing.join(', ')}`)
  }

  const [rows] = await connection.query(
    `SELECT id, tenant_code AS tenantCode, app_code AS appCode, site_id AS siteId
       FROM deployments
      WHERE deployment_code = ?
      LIMIT 1`,
    [sourceDeploymentCode]
  )
  const deployment = rows[0]
  if (!deployment) {
    throw new Error(`source deployment not found after clone: ${sourceDeploymentCode}`)
  }

  const callbackUrl = `${publicUrl}/api/auth/oidc-callback`
  const logoutUrl = `${publicUrl}/api/auth/oidc-post-logout`

  if (deployment.siteId) {
    await connection.query(
      `UPDATE deployment_sites
         SET site_code = ?,
             site_name = ?,
             public_url = ?,
             root_app_code = COALESCE(root_app_code, ?),
             environment = ?,
             status = 'active',
             updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        targetSiteCode,
        `${deployment.tenantCode} test site`,
        publicUrl,
        deployment.appCode,
        environment,
        deployment.siteId
      ]
    )
  }

  await connection.query(
    `UPDATE deployments
       SET deployment_code = ?,
           deployment_name = ?,
           environment = ?,
           status = 'active',
           license_status = 'pending',
           connectivity_status = 'pending',
           runtime_endpoint = ?,
           callback_url = ?,
           webhook_url = NULL,
           base_path = ?,
           api_base = ?,
           deployment_config_json = JSON_SET(
             COALESCE(deployment_config_json, JSON_OBJECT()),
             '$.homeUrl', ?,
             '$.callbackUrl', ?,
             '$.logoutUrl', ?
           ),
           ${DEPLOYMENT_RUNTIME_COLUMNS.join(',\n           ')},
           updated_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [
      targetDeploymentCode,
      `${deployment.tenantCode} console test`,
      environment,
      publicUrl,
      callbackUrl,
      basePath,
      apiBase,
      publicUrl,
      callbackUrl,
      logoutUrl,
      deployment.id
    ]
  )

  return {
    tenantCode: deployment.tenantCode,
    appCode: deployment.appCode,
    deploymentCode: targetDeploymentCode,
    siteCode: targetSiteCode,
    publicUrl
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const commonPassword = passwordFrom(args, 'db', stringValue(process.env.DB_PASSWORD))
  const source = {
    host: option(args, 'source-host', option(args, 'host', process.env.DB_HOST || '127.0.0.1')),
    port: Number(option(args, 'source-port', option(args, 'port', process.env.DB_PORT || '3306'))),
    user: option(args, 'source-user', option(args, 'user', process.env.DB_USER || 'root')),
    password: passwordFrom(args, 'source', commonPassword),
    database: option(args, 'source-db', 'hzy_platform')
  }
  const target = {
    host: option(args, 'target-host', source.host),
    port: Number(option(args, 'target-port', String(source.port))),
    user: option(args, 'target-user', source.user),
    password: passwordFrom(args, 'target', commonPassword || source.password),
    database: option(args, 'target-db', 'hzy_platform_dev')
  }
  const execute = optionBool(args, 'execute')
  const dropTarget = optionBool(args, 'drop-target')
  const allowUnsafeTarget = optionBool(args, 'allow-target-without-dev-suffix')
  const seedConsoleTest = optionBool(args, 'seed-console-test')

  if (source.database === target.database && source.host === target.host && source.port === target.port) {
    throw new Error('source and target database resolve to the same database')
  }
  assertMysqlIdentifier(source.database, 'source-db')
  assertMysqlIdentifier(target.database, 'target-db')
  if (!allowUnsafeTarget && !target.database.endsWith('_dev')) {
    throw new Error(`target database must end with _dev: ${target.database}`)
  }

  console.info('[platform-dev-db] plan')
  console.info(`  source: ${mysqlIdentity(source)}`)
  console.info(`  target: ${mysqlIdentity(target)}`)
  console.info(`  drop target: ${dropTarget ? 'yes' : 'no'}`)
  console.info(`  seed console-test deployment: ${seedConsoleTest ? 'yes' : 'no'}`)

  if (!execute) {
    console.info('[platform-dev-db] dry run only. Add --execute to clone and sanitize the target database.')
    return
  }

  const admin = await mysql.createConnection({
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    multipleStatements: false
  })
  try {
    const exists = await databaseExists(admin, target.database)
    if (exists && !dropTarget) {
      throw new Error(`target database already exists; rerun with --drop-target to replace ${target.database}`)
    }
    if (exists) {
      await admin.query(`DROP DATABASE \`${target.database}\``)
    }
    await admin.query(`CREATE DATABASE \`${target.database}\` DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci`)
  } finally {
    await admin.end()
  }

  console.info('[platform-dev-db] importing source database into target')
  await runPipedClone(source, target)

  const targetConnection = await mysql.createConnection({
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database: target.database,
    multipleStatements: false
  })
  try {
    console.info('[platform-dev-db] sanitizing target runtime state')
    const wiped = await neutralizeRuntimeState(targetConnection)
    console.info(`[platform-dev-db] wiped tables: ${wiped.join(', ') || 'none'}`)

    if (seedConsoleTest) {
      const seeded = await seedConsoleTestDeployment(targetConnection, args)
      console.info(`[platform-dev-db] seeded console-test deployment: ${JSON.stringify(seeded)}`)
    }
  } finally {
    await targetConnection.end()
  }

  console.info('[platform-dev-db] done. Next: start platform-dev with a dev signing key, rotate the tenant runtime token, reissue console-test license, then generate a fresh test bundle.')
}

main().catch((error) => {
  console.error(`[platform-dev-db] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
