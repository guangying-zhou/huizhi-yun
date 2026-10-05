#!/usr/bin/env node
// Approved development-control-plane backup and schema inspection only.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { execFileSync, spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'

process.on('uncaughtException', error => {
  console.error(`Platform preflight failed (${error.code || 'check_failed'}); details suppressed to protect credentials.`)
  process.exit(1)
})
const root = '/wiztek/hzy-test'
if (execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ') throw new Error('Unexpected host')
const app = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' })).find(p => p.name === 'hzy-platform-dev')
if (!app?.pid) throw new Error('Development Platform not running')
const env = Object.fromEntries(fs.readFileSync(`/proc/${app.pid}/environ`, 'utf8').split('\0').filter(Boolean).map(v => [v.slice(0, v.indexOf('=')), v.slice(v.indexOf('=') + 1)]))
if (env.DB_NAME !== 'hzy_platform_dev' || env.PORT !== '3011') throw new Error('Unexpected Platform binding')
const require = createRequire(`${app.pm2_env.pm_cwd}/.output/server/index.mjs`)
const mysql = require('mysql2/promise')
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, connectTimeout: 10000 })
const [columns] = await db.query('SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME,ORDINAL_POSITION', [env.DB_NAME])
const [tables] = await db.query('SELECT TABLE_NAME,ENGINE,TABLE_ROWS,DATA_LENGTH,INDEX_LENGTH FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME', [env.DB_NAME])
await db.end()
fs.writeFileSync(`${root}/platform-schema.json`, JSON.stringify({ database: env.DB_NAME, checkedAt: new Date().toISOString(), tables, columns }, null, 2), { mode: 0o600 })
console.log(JSON.stringify({ database: env.DB_NAME, tables: tables.length, columns: columns.length, approximateBytes: tables.reduce((n, t) => n + Number(t.DATA_LENGTH) + Number(t.INDEX_LENGTH), 0) }))
if (process.argv[2] !== '--backup') process.exit(0)
const backup = `${root}/backups/platform-dev-20260905`
fs.mkdirSync(`${root}/backups`, { recursive: true, mode: 0o700 })
fs.mkdirSync(backup, { mode: 0o700 }) // Refuse overwriting an earlier backup.
const secret = (name, data) => fs.writeFileSync(`${backup}/${name}`, data, { mode: 0o600, flag: 'wx' })
secret('process.json', JSON.stringify(app))
secret('runtime-env.json', JSON.stringify(env))
const quote = value => `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"`
secret('mysql.cnf', `[client]\nhost=${quote(env.DB_HOST)}\nport=${Number(env.DB_PORT || 3306)}\nuser=${quote(env.DB_USER)}\npassword=${quote(env.DB_PASSWORD)}\n`)
const key = randomBytes(32)
const iv = randomBytes(12)
secret('backup-key', key.toString('base64'))
const image = execFileSync('docker', ['inspect', 'hzy-test-mysql', '--format', '{{.Config.Image}}'], { encoding: 'utf8' }).trim()
const child = spawn('docker', ['run', '--rm', '--network', 'host', '--memory', '192m', '--cpus', '0.5',
  '-v', `${backup}/mysql.cnf:/run/secrets/mysql.cnf:ro`, image, 'mysqldump', '--defaults-extra-file=/run/secrets/mysql.cnf',
  '--single-transaction', '--quick', '--no-tablespaces', '--set-gtid-purged=OFF', '--routines', '--events', '--triggers', '--hex-blob', 'hzy_platform_dev'], { stdio: ['ignore', 'pipe', 'pipe'] })
child.stderr.resume() // Never forward client diagnostics containing connection material.
const exited = new Promise((accept, reject) => { child.on('error', reject); child.on('close', code => code === 0 ? accept() : reject(new Error('mysqldump failed'))) })
const cipher = createCipheriv('aes-256-gcm', key, iv)
await Promise.all([exited, pipeline(child.stdout, createGzip(), cipher, fs.createWriteStream(`${backup}/database.sql.gz.enc`, { mode: 0o600, flags: 'wx' }))])
execFileSync('tar', ['-czf', `${backup}/output.tar.gz`, '-C', app.pm2_env.pm_cwd, '.output'], { stdio: 'pipe' })
fs.chmodSync(`${backup}/output.tar.gz`, 0o600)
const digest = file => createHash('sha256').update(fs.readFileSync(`${backup}/${file}`)).digest('hex')
secret('receipt.json', JSON.stringify({ database: env.DB_NAME, createdAt: new Date().toISOString(), oldWorkdir: app.pm2_env.pm_cwd,
  encryption: { alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') },
  databaseSha256: digest('database.sql.gz.enc'), outputSha256: digest('output.tar.gz'), tables: tables.length }, null, 2))
fs.unlinkSync(`${backup}/mysql.cnf`)
console.log('Development database encrypted backup, original deployment output and protected process/env snapshots saved; receipt complete.')
