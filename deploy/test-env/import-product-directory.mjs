// Run only on the authorized C000001 test host. Source export is read-only.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
const target = 'hzy_assets_test_product_20260909'
const order = ['product_assets', 'technology_bases', 'product_asset_bases']
if (process.argv[2] !== '--execute' || execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ') throw Error('Test host/mode required')
const file = process.argv[3]
const raw = fs.readFileSync(file)
const input = JSON.parse(raw)
if (input.source !== 'oa.wiztek.cn' || input.tenant !== 'C000001' || input.database !== 'hzy_assets'
  || Object.keys(input.tables).sort().join() !== [...order].sort().join()) throw Error('Source scope mismatch')
const config = JSON.parse(fs.readFileSync('/wiztek/hzy-test/runtime/config.json'))
const dbConfig = config.apps.assets.db
if (dbConfig.database !== target || dbConfig.host !== '127.0.0.1' || Number(dbConfig.port) !== 13316) throw Error('Target mismatch')
const env = JSON.parse(execFileSync('pm2', ['jlist'], { stdio: 'pipe' })).find(p => p.name === 'hzy-platform-dev').pm2_env
const require = createRequire(env.pm_cwd + '/.output/server/index.mjs')
const db = await require('mysql2/promise').createConnection({ host: dbConfig.host, port: dbConfig.port, user: dbConfig.user, password: dbConfig.password, database: target, dateStrings: true })
const backupDir = `/wiztek/hzy-test/backups/product-directory-${Date.now()}`
fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 })
try {
  await db.beginTransaction()
  const before = {}
  for (const table of order) {
    const [rows] = await db.query('SELECT * FROM ?? FOR UPDATE', [table])
    before[table] = rows
    if (rows.length) throw Error(`Target ${table} is not empty; merge review required`)
    const [cols] = await db.query('SHOW COLUMNS FROM ??', [table])
    const allowed = new Set(cols.map(c => c.Field))
    if (input.tables[table].columns.some(c => !allowed.has(c))) throw Error(`Schema mismatch: ${table}`)
  }
  fs.writeFileSync(backupDir + '/before.json', JSON.stringify(before), { mode: 0o600 })
  const counts = {}
  for (const table of order) {
    const { columns, rows } = input.tables[table]
    for (const row of rows) {
      const values = columns.map(c => row[c] && typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c])
      await db.query('INSERT INTO ?? (' + columns.map(() => '??').join(',') + ') VALUES (' + columns.map(() => '?').join(',') + ')', [table, ...columns, ...values])
    }
    const [count] = await db.query('SELECT COUNT(*) AS n FROM ??', [table])
    if (Number(count[0].n) !== rows.length) throw Error('Count mismatch')
    counts[table] = rows.length
  }
  const [orphans] = await db.query('SELECT COUNT(*) AS n FROM product_asset_bases r LEFT JOIN product_assets p ON p.id=r.product_asset_id LEFT JOIN technology_bases b ON b.id=r.technology_base_id WHERE p.id IS NULL OR b.id IS NULL')
  if (Number(orphans[0].n)) throw Error('Orphan relation')
  await db.commit()
  const receipt = { target, counts, sourceSha256: createHash('sha256').update(raw).digest('hex'), completedAt: new Date().toISOString(), backupDir }
  fs.writeFileSync(backupDir + '/receipt.json', JSON.stringify(receipt, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(receipt))
} catch (error) {
  await db.rollback()
  console.error('Product directory import failed:', error.code || error.message)
  process.exitCode = 1
} finally { await db.end() }
