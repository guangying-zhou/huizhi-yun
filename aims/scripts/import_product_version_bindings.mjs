#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'

const AIMS_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const WORKSPACE_ROOT = path.resolve(AIMS_ROOT, '..')

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name)
  if (index === -1 || index + 1 >= process.argv.length) return fallback
  return process.argv[index + 1]
}

function hasArg(name) {
  return process.argv.includes(name)
}

function readEnv(filePath) {
  const env = {}
  if (!fs.existsSync(filePath)) return env
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const index = line.indexOf('=')
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
    env[key] = value
  }
  return env
}

function configValue(env, keys, fallback = '') {
  for (const key of keys) {
    const value = String(env[key] || process.env[key] || '').trim()
    if (value) return value
  }
  return fallback
}

function dbName(value) {
  const normalized = String(value || '').trim()
  if (!/^[a-zA-Z0-9_]+$/.test(normalized)) {
    throw new Error(`Invalid database name: ${normalized || '<empty>'}`)
  }
  return normalized
}

function quoteDB(name) {
  return `\`${dbName(name)}\``
}

function versionCode(value) {
  return String(value || '').trim()
}

async function selectVersionID(conn, aimsDB, productCode, code) {
  const [rows] = await conn.execute(
    `SELECT id FROM ${quoteDB(aimsDB)}.product_versions WHERE product_code = ? AND version_code = ? LIMIT 1`,
    [productCode, code]
  )
  return rows[0]?.id || null
}

async function ensureVersion(conn, aimsDB, row, code, status, apply, currentUser) {
  if (!code) return null
  if (!apply) return null
  await conn.execute(`
    INSERT INTO ${quoteDB(aimsDB)}.product_versions (
      product_code,
      version_code,
      name,
      status,
      owner_project_id,
      created_by
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name = IF(name IS NULL OR name = '', VALUES(name), name),
      owner_project_id = COALESCE(owner_project_id, VALUES(owner_project_id))
  `, [
    row.product_code,
    code,
    code,
    status,
    row.project_id,
    currentUser
  ])
  return selectVersionID(conn, aimsDB, row.product_code, code)
}

async function main() {
  const env = {
    ...readEnv(path.join(WORKSPACE_ROOT, '.env')),
    ...readEnv(path.join(AIMS_ROOT, '.env')),
    ...readEnv(path.join(AIMS_ROOT, '.env.dev'))
  }

  const apply = hasArg('--apply')
  const createVersions = hasArg('--create-versions')
  const bindTargetVersion = hasArg('--bind-target-version')
  const currentUser = argValue('--current-user', configValue(env, ['HZY_IMPORT_USER', 'USER'], 'migration'))
  const connection = await mysql.createConnection({
    host: argValue('--host', configValue(env, ['HZY_DATA_RUNTIME_DB_HOST', 'DB_HOST'], '127.0.0.1')),
    port: Number(argValue('--port', configValue(env, ['HZY_DATA_RUNTIME_DB_PORT', 'DB_PORT'], '3306'))),
    user: argValue('--user', configValue(env, ['HZY_DATA_RUNTIME_DB_USER', 'DB_USER'], 'root')),
    password: argValue('--password', configValue(env, ['HZY_DATA_RUNTIME_DB_PASSWORD', 'DB_PASSWORD'], '')),
    multipleStatements: false
  })
  const aimsDB = dbName(argValue('--aims-db', configValue(env, ['HZY_AIMS_DB_NAME'], 'hzy_aims')))
  const assetsDB = dbName(argValue('--assets-db', configValue(env, ['HZY_ASSETS_DB_NAME'], 'hzy_assets')))

  const [rows] = await connection.execute(`
    SELECT
      ap.id AS product_id,
      ap.product_code,
      ap.product_name,
      ap.current_version,
      ap.target_version,
      ap.project_code,
      p.id AS project_id,
      p.category AS project_category
    FROM ${quoteDB(assetsDB)}.product_assets ap
    INNER JOIN ${quoteDB(aimsDB)}.aims_projects p
      ON p.project_code = ap.project_code
    WHERE ap.project_code IS NOT NULL
      AND ap.project_code <> ''
      AND ap.product_code IS NOT NULL
      AND ap.product_code <> ''
    ORDER BY p.id ASC, ap.id ASC
  `)

  const allowedCategories = new Set(['product_dev', 'delivery', 'maintenance'])
  const candidates = rows.filter(row => allowedCategories.has(row.project_category))
  const skipped = rows.filter(row => !allowedCategories.has(row.project_category)).map(row => ({
    projectCode: row.project_code,
    productCode: row.product_code,
    reason: `unsupported project category: ${row.project_category}`
  }))

  const primarySeen = new Set()
  const planned = []

  if (apply) await connection.beginTransaction()
  try {
    for (const row of candidates) {
      const currentVersion = versionCode(row.current_version)
      const targetVersion = versionCode(row.target_version)
      let boundVersionID = null

      if (createVersions) {
        await ensureVersion(connection, aimsDB, row, currentVersion, 'released', apply, currentUser)
        const targetID = await ensureVersion(connection, aimsDB, row, targetVersion, 'planning', apply, currentUser)
        if (bindTargetVersion && targetID) boundVersionID = targetID
      }

      const primary = !primarySeen.has(row.project_id)
      primarySeen.add(row.project_id)

      planned.push({
        projectCode: row.project_code,
        productCode: row.product_code,
        productName: row.product_name,
        currentVersion: currentVersion || null,
        targetVersion: targetVersion || null,
        bindTargetVersion,
        isPrimary: primary
      })

      if (!apply) continue
      if (primary) {
        await connection.execute(
          `UPDATE ${quoteDB(aimsDB)}.aims_project_products SET is_primary = 0 WHERE project_id = ?`,
          [row.project_id]
        )
      }
      await connection.execute(`
        INSERT INTO ${quoteDB(aimsDB)}.aims_project_products (
          project_id,
          product_code,
          product_name,
          version_id,
          is_primary,
          created_by
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          product_name = VALUES(product_name),
          version_id = IF(VALUES(version_id) IS NULL, version_id, VALUES(version_id)),
          is_primary = VALUES(is_primary)
      `, [
        row.project_id,
        row.product_code,
        row.product_name || null,
        boundVersionID,
        primary ? 1 : 0,
        currentUser
      ])
    }

    if (apply) await connection.commit()
  } catch (error) {
    if (apply) await connection.rollback()
    throw error
  } finally {
    await connection.end()
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    aimsDB,
    assetsDB,
    createVersions,
    bindTargetVersion,
    plannedCount: planned.length,
    skippedCount: skipped.length,
    planned,
    skipped
  }, null, 2))
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error)
  process.exit(1)
})
