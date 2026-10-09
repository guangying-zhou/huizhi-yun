#!/usr/bin/env node
// Destructive clone hygiene. The approved encrypted source dump is the rollback
// artifact for removed ephemeral rows; this script never exports their values.
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

export const G9_EPHEMERAL_TABLES = [
  'policy_bundle_targets', 'policy_bundles',
  'revocation_snapshot_targets', 'revocation_entries', 'revocation_snapshots',
  'deployment_connectivity_checks', 'deployment_heartbeats',
  'tenant_runtime_heartbeats', 'tenant_runtime_enrollments',
  'tenant_sessions', 'platform_sessions', 'platform_email_activation_tokens',
  'platform_api_keys', 'platform_webhooks'
]

export async function sanitizeG9Clone(db, approvedCounts, hook) {
  assert.ok(approvedCounts && Object.keys(approvedCounts).every(key => G9_EPHEMERAL_TABLES.includes(key)), 'G9_COUNTS_REQUIRED')
  await db.beginTransaction()
  try {
    const result = {}
    for (const table of G9_EPHEMERAL_TABLES) {
      const [exists] = await db.query(`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`, [table])
      if (Number(exists[0].n) !== 1) continue
      assert.ok(Object.hasOwn(approvedCounts, table), `G9_UNREVIEWED_TABLE:${table}`)
      const [count] = await db.query(`SELECT COUNT(*) AS n FROM \`${table}\` FOR UPDATE`)
      assert.equal(Number(count[0].n), approvedCounts[table], `G9_ROW_COUNT_DRIFT:${table}`)
      const [deleted] = await db.query(`DELETE FROM \`${table}\``)
      assert.equal(deleted.affectedRows, approvedCounts[table])
      result[table] = deleted.affectedRows
    }
    if (hook) await hook(db)
    await db.commit()
    return result
  } catch (error) {
    await db.rollback()
    throw error
  }
}

export async function planG9Sanitize(db) {
  const counts = {}
  for (const table of G9_EPHEMERAL_TABLES) {
    const [exists] = await db.query(`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`, [table])
    if (Number(exists[0].n) !== 1) continue
    const [rows] = await db.query(`SELECT COUNT(*) AS n FROM \`${table}\``)
    counts[table] = Number(rows[0].n)
  }
  return counts
}

async function main() {
  const [mode, configPath, approvedCountsPath] = process.argv.slice(2)
  assert.ok(['--plan', '--apply'].includes(mode))
  const stat = statSync(configPath)
  assert.equal(stat.mode & 0o077, 0, 'G9_CONFIG_MUST_BE_0600')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const db = await mysql.createConnection({ ...config.db, dateStrings: true })
  try {
    if (mode === '--plan') console.log(JSON.stringify(await planG9Sanitize(db)))
    else {
      assert.ok(config.encryptedCloneBackupSha256?.match(/^[a-f0-9]{64}$/), 'G9_ENCRYPTED_BACKUP_REQUIRED')
      const counts = JSON.parse(readFileSync(approvedCountsPath, 'utf8'))
      console.log(JSON.stringify({ removed: await sanitizeG9Clone(db, counts), rollback: 'restore_approved_encrypted_clone_dump' }))
    }
  } finally { await db.end() }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(`G9_STOPPED:${String(error.message).slice(0, 200)}`)
  process.exitCode = 1
})
