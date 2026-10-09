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
    const key = item.slice(2)
    const value = argv[index + 1]
    args[key] = value && !value.startsWith('--') ? value : true
    if (args[key] !== true) index += 1
  }
  return args
}

function parseEnv(content) {
  const env = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const equalsIndex = line.indexOf('=')
    if (equalsIndex <= 0) continue
    const key = line.slice(0, equalsIndex).trim()
    let value = line.slice(equalsIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

async function columnExists(connection, columnName) {
  const [rows] = await connection.execute(
    `SELECT 1
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'policy_bundles'
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [columnName]
  )
  return Boolean(rows[0])
}

async function indexExists(connection, indexName) {
  const [rows] = await connection.execute(
    `SELECT 1
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'policy_bundles'
        AND INDEX_NAME = ?
      LIMIT 1`,
    [indexName]
  )
  return Boolean(rows[0])
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.execute(
    `SELECT 1
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      LIMIT 1`,
    [tableName]
  )
  return Boolean(rows[0])
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const envFile = resolve(String(args['env-file'] || ''))
  const backupFile = resolve(String(args.backup || ''))
  if (!envFile || !backupFile || args.execute !== true) {
    throw new Error('usage: --env-file <path> --backup <path> --execute')
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
    charset: 'utf8mb4'
  })

  try {
    const [policyCreateRows] = await connection.query('SHOW CREATE TABLE `policy_bundles`')
    const revisionTablePresent = await tableExists(connection, 'tenant_policy_revisions')
    const [policyRows] = await connection.query('SELECT * FROM `policy_bundles`')
    const revisionRows = revisionTablePresent
      ? (await connection.query('SELECT * FROM `tenant_policy_revisions`'))[0]
      : []
    await mkdir(dirname(backupFile), { recursive: true, mode: 0o700 })
    await writeFile(
      backupFile,
      `${JSON.stringify({
        capturedAt: new Date().toISOString(),
        database: env.DB_NAME,
        policyBundlesCreate: policyCreateRows[0]?.['Create Table'] || '',
        policyBundles: policyRows,
        tenantPolicyRevisionsPresent: revisionTablePresent,
        tenantPolicyRevisions: revisionRows
      }, null, 2)}\n`,
      { mode: 0o600 }
    )
    await chmod(backupFile, 0o600)

    await connection.query(
      `CREATE TABLE IF NOT EXISTS \`tenant_policy_revisions\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`tenant_code\` VARCHAR(64) NOT NULL,
        \`policy_revision\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
        \`policy_hash\` VARCHAR(96) NULL,
        \`policy_updated_at\` DATETIME NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_tenant_policy_revisions_tenant\` (\`tenant_code\`),
        CONSTRAINT \`fk_tenant_policy_revisions_tenant\`
          FOREIGN KEY (\`tenant_code\`) REFERENCES \`tenants\` (\`tenant_code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    )

    const columns = [
      ['environment', "ADD COLUMN `environment` VARCHAR(32) NOT NULL DEFAULT 'prod' AFTER `tenant_code`"],
      ['policy_revision', 'ADD COLUMN `policy_revision` BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER `bundle_hash`'],
      ['policy_hash', 'ADD COLUMN `policy_hash` VARCHAR(96) NULL AFTER `policy_revision`'],
      ['signed_at', 'ADD COLUMN `signed_at` DATETIME NULL AFTER `signed_by_kid`'],
      ['schema_version', 'ADD COLUMN `schema_version` VARCHAR(32) NULL AFTER `signed_at`'],
      ['issued_at', 'ADD COLUMN `issued_at` DATETIME NULL AFTER `schema_version`'],
      ['expires_at', 'ADD COLUMN `expires_at` DATETIME NULL AFTER `issued_at`']
    ]
    for (const [name, ddl] of columns) {
      if (!await columnExists(connection, name)) {
        await connection.query(`ALTER TABLE \`policy_bundles\` ${ddl}`)
      }
    }

    await connection.query(
      `UPDATE \`policy_bundles\`
          SET \`schema_version\` = COALESCE(NULLIF(\`schema_version\`, ''), 'policy-bundle.v1'),
              \`issued_at\` = COALESCE(\`issued_at\`, \`signed_at\`, \`created_at\`, UTC_TIMESTAMP())
        WHERE \`schema_version\` IS NULL
           OR \`schema_version\` = ''
           OR \`issued_at\` IS NULL`
    )
    await connection.query(
      `ALTER TABLE \`policy_bundles\`
         MODIFY COLUMN \`schema_version\` VARCHAR(32) NOT NULL,
         MODIFY COLUMN \`issued_at\` DATETIME NOT NULL`
    )

    const indexes = [
      ['idx_policy_bundles_policy_revision', 'ADD KEY `idx_policy_bundles_policy_revision` (`tenant_code`, `environment`, `policy_revision`)'],
      ['idx_policy_bundles_signed_kid', 'ADD KEY `idx_policy_bundles_signed_kid` (`signed_by_kid`, `issued_at`)'],
      ['idx_policy_bundles_expires_at', 'ADD KEY `idx_policy_bundles_expires_at` (`expires_at`)']
    ]
    for (const [name, ddl] of indexes) {
      if (!await indexExists(connection, name)) {
        await connection.query(`ALTER TABLE \`policy_bundles\` ${ddl}`)
      }
    }

    const requiredColumns = columns.map(([name]) => name)
    for (const columnName of requiredColumns) {
      if (!await columnExists(connection, columnName)) {
        throw new Error(`migration verification failed for column: ${columnName}`)
      }
    }
    for (const [indexName] of indexes) {
      if (!await indexExists(connection, indexName)) {
        throw new Error(`migration verification failed for index: ${indexName}`)
      }
    }
    if (!await tableExists(connection, 'tenant_policy_revisions')) {
      throw new Error('migration verification failed for tenant_policy_revisions')
    }

    console.info('[platform-dev-v2.24] backup=ready mode=600')
    console.info('[platform-dev-v2.24] migration=verified')
  } finally {
    await connection.end()
  }
}

main().catch((error) => {
  console.error(`[platform-dev-v2.24] ${error.message}`)
  process.exitCode = 1
})
