#!/usr/bin/env node
// Reuse the reviewed 74-pair SQL, including its JSON_TABLE column collation.
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
export function orphanGateSql() {
  const markdown = readFileSync(resolve(root, 'docs/Go-Live-Prod-Read-Only-Checklist.md'), 'utf8')
  const section = markdown.split('## 02.')[1]?.split('## 03.')[0]
  const sql = section?.match(/```sql\n([\s\S]*?)\n```/)?.[1]
  assert.ok(sql?.includes('JSON_TABLE') && sql.includes('COLLATE utf8mb4_unicode_ci'), 'G9_ORPHAN_SQL_CHANGED')
  return sql
}
export async function checkG9Orphans(db) {
  const [rows] = await db.query(orphanGateSql())
  assert.equal(rows.length, 0, 'G9_ORPHAN_RESOURCES_PRESENT')
  return { pairs: 74, orphanRows: 0 }
}
async function main() {
  const [configPath] = process.argv.slice(2)
  const stat = statSync(configPath)
  assert.equal(stat.mode & 0o077, 0, 'G9_CONFIG_MUST_BE_0600')
  const { db } = JSON.parse(readFileSync(configPath, 'utf8'))
  const connection = await mysql.createConnection({ ...db, dateStrings: true })
  try {
    await connection.query('START TRANSACTION READ ONLY')
    try {
      console.log(JSON.stringify(await checkG9Orphans(connection)))
    } finally {
      await connection.rollback()
    }
  } finally {
    await connection.end()
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(`G9_STOPPED:${String(error.message).slice(0, 200)}`)
  process.exitCode = 1
})
