#!/usr/bin/env node
// Domestic host only. Production SQL is authenticated/decrypted only on this host.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync, randomBytes, publicEncrypt, privateDecrypt, createCipheriv, createDecipheriv, createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { businessTables, preservedTables, stageDatabase, refreshId, validateInventory } from './data-refresh-plan.mjs'

process.on('uncaughtException', error => {
  console.error(`Data refresh failed (${error.code || 'guard_failed'}); SQL/rows/credentials suppressed. Existing databases retained.`)
  process.exit(1)
})
const root = '/wiztek/hzy-test'
const backup = `${root}/backups/${refreshId}`
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...options })
if (run('hostname', []).toString().trim() !== 'iZcqwiqyhp9u8rZ') throw new Error('Unexpected target host')
const secret = (name, value) => fs.writeFileSync(`${backup}/${name}`, value, { mode: 0o600, flag: 'wx' })
const hash = value => createHash('sha256').update(value).digest('hex')
const sql = (input, database) => run('docker', ['exec', '-i', 'hzy-test-mysql', 'sh', '-c',
  'MYSQL_PWD="$(cat /run/secrets/mysql-root)" exec mysql -uroot --batch --skip-column-names "$@"', 'mysql', ...(database ? [database] : [])], { input }).toString().trim()
const dump = (database, tables = [], dataOnly = false) => run('docker', ['exec', 'hzy-test-mysql', 'sh', '-c',
  'MYSQL_PWD="$(cat /run/secrets/mysql-root)" exec mysqldump -uroot "$@"', 'mysqldump', '--single-transaction', '--quick',
  '--no-tablespaces', '--set-gtid-purged=OFF', '--skip-triggers', '--skip-events', '--hex-blob', '--skip-add-locks',
  ...(dataOnly ? ['--no-create-info', '--skip-comments', '--compact', '--order-by-primary'] : []), database, ...tables])
const seal = data => {
  const publicKey = fs.readFileSync(`${backup}/public.pem`)
  const key = randomBytes(32), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(gzipSync(data)), cipher.final()])
  return JSON.stringify({ version: 1, wrappedKey: publicEncrypt({ key: publicKey, oaepHash: 'sha256' }, key).toString('base64'),
    iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') })
}
const open = name => {
  const envelope = JSON.parse(fs.readFileSync(`${backup}/${name}`, 'utf8'))
  if (envelope.version !== 1) throw new Error('Unsupported snapshot')
  const key = privateDecrypt({ key: fs.readFileSync(`${backup}/private.pem`), oaepHash: 'sha256' }, Buffer.from(envelope.wrappedKey, 'base64'))
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
  cipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  // Verify the GCM tag before passing ANY SQL to MySQL.
  return gunzipSync(Buffer.concat([cipher.update(Buffer.from(envelope.data, 'base64')), cipher.final()]), { maxOutputLength: 64 * 1024 * 1024 })
}
const mode = process.argv[2]
if (mode === '--prepare') {
  const config = JSON.parse(fs.readFileSync(`${root}/runtime/config.json`, 'utf8'))
  if (config.tenant !== 'HTEST001' || config.auth.mode !== 'jwt' || config.apps.console.db.database !== 'hzy_console' || config.apps.people.db.database !== 'hzy_people') throw new Error('Unexpected active binding')
  fs.mkdirSync(backup, { mode: 0o700 }) // Refuse overwriting an earlier backup.
  const keys = generateKeyPairSync('rsa', { modulusLength: 3072 })
  secret('private.pem', keys.privateKey.export({ type: 'pkcs8', format: 'pem' }))
  secret('public.pem', keys.publicKey.export({ type: 'spki', format: 'pem' }))
  secret('runtime-config.json', JSON.stringify(config))
  const receipts = {}
  for (const app of ['console', 'people']) {
    const data = dump(`hzy_${app}`)
    secret(`${app}-before.enc`, seal(data))
    receipts[app] = { backupSha256: hash(data), protectedSha256: hash(dump(`hzy_${app}`, preservedTables[app], true)) }
  }
  secret('before.json', JSON.stringify({ createdAt: new Date().toISOString(), receipts }))
  console.log('Test databases backed up with encryption; original runtime configuration preserved.')
} else if (mode === '--receive') {
  const app = process.argv[3]
  stageDatabase(app)
  if (!fs.existsSync(`${backup}/before.json`)) throw new Error('Missing backup')
  const chunks = []; let bytes = 0
  for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 64 * 1024 * 1024) throw new Error('Snapshot too large'); chunks.push(chunk) }
  secret(`${app}-production.enc`, Buffer.concat(chunks))
  const data = JSON.parse(open(`${app}-production.enc`))
  if (data.database !== `hzy_${app}` || data.source !== 'oa.wiztek.cn' || hash(data.sql) !== data.dumpSha256) throw new Error('Invalid source snapshot')
  console.log(`${app}: authenticated encrypted snapshot received.`)
} else if (mode === '--restore') {
  const receipt = { restoredAt: new Date().toISOString(), apps: {} }
  if (fs.existsSync(`${backup}/restored.json`)) throw new Error('Already restored')
  for (const app of ['console', 'people']) {
    const stage = stageDatabase(app), source = JSON.parse(open(`${app}-production.enc`))
    if (Object.keys(source.counts).sort().join() !== [...businessTables[app]].sort().join() || hash(source.sql) !== source.dumpSha256) throw new Error('Unexpected tables or integrity')
    // Dumps are fixed database-local tables, with triggers/events/routines disabled.
    if (/^USE |^CREATE DATABASE |^DROP DATABASE |REFERENCES `hzy_/m.test(source.sql)) throw new Error('Database-qualified dump rejected')
    sql(`CREATE DATABASE \`${stage}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`)
    sql(open(`${app}-before.enc`), stage)
    sql(source.sql, stage)
    const inventory = sql(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='${stage}' ORDER BY TABLE_NAME;`).split('\n')
    validateInventory(app, inventory)
    for (const [table, count] of Object.entries(source.counts)) {
      if (Number(sql(`SELECT COUNT(*) FROM \`${table}\`;`, stage)) !== count) throw Object.assign(new Error('Row count mismatch'), { code: 'row_count' })
    }
    receipt.apps[app] = { database: stage, sourceStartedAt: source.startedAt, sourceCompletedAt: source.completedAt, sourceCounts: source.counts, dumpSha256: source.dumpSha256 }
    console.log(`${app}: ${businessTables[app].length} business tables restored and every row count verified.`)
  }
  const consoleDb = stageDatabase('console'), peopleDb = stageDatabase('people')
  // This refresh preserves the only existing synthetic login identity; refuse to silently merge other users.
  if (sql("SELECT COUNT(*) FROM hzy_console.directory_users WHERE uid<>'test-user-001';") !== '0'
    || sql('SELECT COUNT(*) FROM hzy_console.directory_identities;') !== '0') throw new Error('Account merge requires additional review')
  for (const [table, key, value] of [['directory_departments', 'dept_code', 'TEST-RD'], ['directory_users', 'uid', 'test-user-001'], ['directory_user_departments', 'uid', 'test-user-001']]) {
    if (sql(`SELECT COUNT(*) FROM \`${consoleDb}\`.\`${table}\` WHERE \`${key}\`='${value}';`) !== '0') throw new Error('Synthetic identity collision')
    const columns = sql(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='hzy_console' AND TABLE_NAME='${table}' AND COLUMN_NAME<>'id' AND EXTRA NOT LIKE '%GENERATED%' ORDER BY ORDINAL_POSITION;`).split('\n').map(c => `\`${c}\``).join(',')
    sql(`INSERT INTO \`${consoleDb}\`.\`${table}\`(${columns}) SELECT ${columns} FROM hzy_console.\`${table}\` WHERE \`${key}\`='${value}';`)
  }
  sql(`UPDATE \`${consoleDb}\`.org_profiles SET tenant_code='HTEST001';`)
  // The old synthetic People employee is not a login account and remains in the rollback DB.
  // Production employee numbers/UIDs are retained unchanged, without a synthetic number collision.
  for (const app of ['console', 'people']) {
    const stage = stageDatabase(app)
    if (hash(dump(`hzy_${app}`, preservedTables[app], true)) !== hash(dump(stage, preservedTables[app], true))) throw Object.assign(new Error('Protected data changed'), { code: 'protected_hash' })
    const fks = sql(`SELECT TABLE_NAME,CONSTRAINT_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA='${stage}' AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION;`)
    const groups = new Map()
    for (const line of fks.split('\n').filter(Boolean)) { const r = line.split('\t'); const k = r[0] + '.' + r[1]; groups.set(k, [...(groups.get(k) || []), r]) }
    let orphanRelationships = 0
    for (const rows of groups.values()) {
      const joins = rows.map(r => `s.\`${r[2]}\`=t.\`${r[4]}\``).join(' AND ')
      const present = rows.map(r => `s.\`${r[2]}\` IS NOT NULL`).join(' AND ')
      orphanRelationships += Number(sql(`SELECT COUNT(*) FROM \`${rows[0][0]}\` s LEFT JOIN \`${rows[0][3]}\` t ON ${joins} WHERE ${present} AND t.\`${rows[0][4]}\` IS NULL;`, stage))
    }
    receipt.apps[app].foreignKeyOrphans = orphanRelationships
    if (orphanRelationships) throw Object.assign(new Error('Foreign key orphan'), { code: 'foreign_key_orphan' })
    receipt.apps[app].protectedSha256 = hash(dump(stage, preservedTables[app], true))
  }
  if (sql(`SELECT COUNT(*) FROM \`${peopleDb}\`.people_employees p LEFT JOIN \`${consoleDb}\`.directory_users u ON u.uid=p.employee_uid WHERE u.uid IS NULL;`) !== '0') throw new Error('People/Directory UID mismatch')
  secret('restored.json', JSON.stringify(receipt, null, 2))
  console.log('Candidate databases verified: original business UIDs, test account, protected table hashes, foreign keys and People/Directory references.')
} else if (mode === '--cutover') {
  if (fs.existsSync(`${backup}/complete.json`)) throw new Error('Already cut over')
  const receipt = JSON.parse(fs.readFileSync(`${backup}/restored.json`, 'utf8'))
  const previous = fs.readFileSync(`${backup}/runtime-config.json`, 'utf8')
  const configPath = `${root}/runtime/config.json`, config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  if (JSON.stringify(config) !== JSON.stringify(JSON.parse(previous))) throw new Error('Active runtime config changed')
  run('systemctl', ['stop', 'hzy-test-data-runtime'])
  try {
    for (const app of ['console', 'people']) {
      if (hash(dump(`hzy_${app}`, preservedTables[app], true)) !== receipt.apps[app].protectedSha256) throw new Error('Test state changed after backup')
      sql(`GRANT SELECT,INSERT,UPDATE,DELETE,CREATE TEMPORARY TABLES ON \`${stageDatabase(app)}\`.* TO 'hzy_test_runtime'@'%';`)
    }
    config.apps.console.db.database = config.apps.directory.db.database = stageDatabase('console')
    config.apps.people.db.database = stageDatabase('people')
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    run('systemctl', ['start', 'hzy-test-data-runtime'])
    let ready = false
    for (let i = 0; i < 15; i++) {
      try {
        const health = await fetch('http://127.0.0.1:18084/runtime/health', { signal: AbortSignal.timeout(3000) })
        if (health.ok) { const data = await health.json(); if (data.tenant === 'HTEST001' && data.status === 'ok' && data.deployment === 'htest001-test-tenant-runtime' && ['console', 'directory', 'people'].every(app => data.apps?.[app]?.db === 'ok')) { ready = true; break } }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    if (!ready) throw new Error('Runtime health failed')
    const denied = await fetch('http://127.0.0.1:18084/v1/console/directory/users', { signal: AbortSignal.timeout(5000) })
    if (denied.status !== 401) throw new Error('Unauthenticated request not rejected')
    secret('complete.json', JSON.stringify({ ...receipt, cutoverAt: new Date().toISOString(), jwtRequired: true, originalDatabasesRetained: true }, null, 2))
    console.log('Runtime switched to verified candidate databases. JWT required. Original test databases and encrypted backups retained.')
  } catch (error) {
    fs.writeFileSync(configPath, previous)
    run('systemctl', ['restart', 'hzy-test-data-runtime'])
    throw error
  }
} else throw new Error('Expected --prepare, --receive, --restore or --cutover')
