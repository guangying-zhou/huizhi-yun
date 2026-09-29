// One-off C000001/test suspension acceptance on the development Platform
// (user-approved 2026-09-23). Changes only tenants.status for C000001 between
// 'active' and 'suspended'. `suspend` arms a detached guard that restores
// 'active' after 10 minutes if still suspended.
// Run on gitlab.wiztek.cn: node suspension.mjs status|suspend|restore
import fs from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const name = 'hzy-platform-dev'
const tenant = 'C000001'
const guardMs = 10 * 60_000
const mode = process.argv[2]
if (!['status', 'suspend', 'restore', 'guard'].includes(mode)) throw Error('mode must be status, suspend or restore')
if (execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ') throw Error('host mismatch')
const live = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' })).find(p => p.name === name)
if (!live?.pid) throw Error('Platform process missing')
const env = Object.fromEntries(fs.readFileSync(`/proc/${live.pid}/environ`, 'utf8').split('\0').filter(Boolean)
  .map(item => [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)]))
if (env.DB_NAME !== 'hzy_platform_dev') throw Error('runtime binding mismatch')
const require = createRequire(`${live.pm2_env.pm_cwd}/package.json`)
const connection = await require('mysql2/promise').createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306),
  user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME })
const current = async () => {
  const [rows] = await connection.query('SELECT status FROM tenants WHERE tenant_code=?', [tenant])
  if (rows.length !== 1) throw Error('tenant row mismatch')
  return rows[0].status
}
const change = async (from, to) => {
  const [result] = await connection.query('UPDATE tenants SET status=? WHERE tenant_code=? AND status=?', [to, tenant, from])
  return result.affectedRows
}
try {
  if (mode === 'status') console.log(JSON.stringify({ tenant, status: await current() }))
  if (mode === 'suspend') {
    if (await current() !== 'active') throw Error('tenant is not active; refusing')
    if (await change('active', 'suspended') !== 1) throw Error('suspend did not change exactly one row')
    const guard = spawn(process.execPath, [process.argv[1], 'guard'], { detached: true, stdio: 'ignore' })
    guard.unref()
    console.log(JSON.stringify({ tenant, status: await current(), guardPid: guard.pid, guardRestoresAfterMs: guardMs }))
  }
  if (mode === 'restore') {
    const changed = await change('suspended', 'active')
    console.log(JSON.stringify({ tenant, restored: changed === 1, status: await current() }))
  }
  if (mode === 'guard') {
    await connection.end()
    await new Promise(resolve => setTimeout(resolve, guardMs))
    const again = await require('mysql2/promise').createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306),
      user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME })
    await again.query("UPDATE tenants SET status='active' WHERE tenant_code=? AND status='suspended'", [tenant])
    await again.end()
  }
} finally {
  if (mode !== 'guard') await connection.end()
}
