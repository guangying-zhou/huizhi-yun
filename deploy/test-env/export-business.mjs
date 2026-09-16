// This source is sent over SSH to Japan. It creates no files and executes no writes.
// refreshInput is supplied by the orchestrator: public encryption key + table allowlist.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomBytes, publicEncrypt, createCipheriv, createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

process.on('uncaughtException', () => { console.error('Read-only export failed; details suppressed.'); process.exit(1) })
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts })
if (run('hostname', []).toString().trim() !== 'vultr.guest') throw new Error('Unexpected source host')
const pid = run('systemctl', ['show', 'hzy-data-runtime', '-p', 'MainPID', '--value']).toString().trim()
const env = Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean).map(v => [v.slice(0, v.indexOf('=')), v.slice(v.indexOf('=') + 1)]))
const { app, tables, knownTables, publicKey } = refreshInput
if (!['console', 'people'].includes(app) || !tables.every(t => /^[a-z_]+$/.test(t))) throw new Error('Unexpected export scope')
const prefix = `HZY_${app.toUpperCase()}`
const db = env[`${prefix}_DB_NAME`] || `hzy_${app}`
if (db !== `hzy_${app}` || env.HZY_DATA_RUNTIME_TENANT !== 'C000001') throw new Error('Unexpected source database/tenant')
const auth = ['--host=127.0.0.1', '--port=3306', `--user=${env[`${prefix}_DB_USER`] || env.HZY_DATA_RUNTIME_DB_USER}`]
const options = { env: { ...process.env, MYSQL_PWD: env[`${prefix}_DB_PASSWORD`] || env.HZY_DATA_RUNTIME_DB_PASSWORD } }
const query = input => run('mysql', [...auth, '--batch', '--skip-column-names', db], { ...options, input }).toString().trim()
const inventory = query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='${db}' ORDER BY TABLE_NAME;`).split('\n')
if (inventory.some(t => !knownTables.includes(t)) || tables.some(t => !inventory.includes(t))) throw new Error('Unreviewed source tables')
if (query(`SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${db}' AND ENGINE<>'InnoDB';`) !== '0') throw new Error('Nontransactional source')
const count = () => Object.fromEntries(query(tables.map(t => `SELECT '${t}', COUNT(*) FROM \`${t}\`;`).join('\n')).split('\n').map(v => { const [t, n] = v.split('\t'); return [t, Number(n)] }))
const before = count()
const startedAt = new Date().toISOString()
const dump = run('mysqldump', [...auth, '--single-transaction', '--quick', '--no-tablespaces', '--set-gtid-purged=OFF',
  '--skip-triggers', '--skip-events', '--hex-blob', '--skip-add-locks', '--default-character-set=utf8mb4', db, ...tables], options)
const after = count()
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Source row counts changed during export; retry required')
const payload = gzipSync(JSON.stringify({ source: 'oa.wiztek.cn', database: db, startedAt, completedAt: new Date().toISOString(),
  counts: after, dumpSha256: createHash('sha256').update(dump).digest('hex'), sql: dump.toString() }))
const key = randomBytes(32), iv = randomBytes(12)
const cipher = createCipheriv('aes-256-gcm', key, iv)
const encrypted = Buffer.concat([cipher.update(payload), cipher.final()])
process.stdout.write(JSON.stringify({ version: 1, wrappedKey: publicEncrypt({ key: publicKey, oaepHash: 'sha256' }, key).toString('base64'),
  iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') }))
