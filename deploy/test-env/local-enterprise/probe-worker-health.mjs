#!/usr/bin/env node
// Read-only by default. Explicit --recover may restart one owned local Dev
// process after two failed Nitro requests; it never touches Runtime or MySQL.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { readProfile, validateProfile } from './config.mjs'
import { ownedProcesses } from './process-ownership.mjs'

const profilePath = resolve(homedir(), '.config/huizhi-yun/hzy0/profile.json')
const cliPath = fileURLToPath(new URL('../local-enterprise.mjs', import.meta.url))
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)))

export async function probeWorker(url, token, fetchImpl = fetch) {
  const startedAt = Date.now()
  try {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'error', cache: 'no-store',
      headers: { 'x-hzy0-local-health': token }, signal: AbortSignal.timeout(5000) })
    const body = response.ok ? await response.json() : null
    if (response.status !== 200 || body?.status !== 'ok' || !Number.isInteger(body.pid)
      || !Number.isFinite(body.rssBytes) || !Number.isFinite(body.heapUsedBytes)) throw Error('worker_unhealthy')
    return { healthy: true, elapsedMs: Date.now() - startedAt, pid: body.pid,
      rssBytes: body.rssBytes, heapUsedBytes: body.heapUsedBytes }
  } catch { return { healthy: false, elapsedMs: Date.now() - startedAt } }
}

async function main() {
  const argument = process.argv[2] || '--probe'
  if (!['--probe', '--recover=enterprise', '--recover=console'].includes(argument) || process.argv.length > 3) {
    throw Error('Use --probe or --recover=enterprise|console')
  }
  const loaded = await readProfile(profilePath)
  if (loaded.issues.length || validateProfile(loaded.value).length
    || loaded.value.identity.consoleFacadeMode !== 'local-canonical-facade'
    || loaded.value.listeners.enterprise.host !== '127.0.0.1') throw Error('Unapproved local profile')
  const inventory = spawnSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 10000, maxBuffer: 8*1024*1024,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PM2_HOME: loaded.value.processManagement.pm2Home } })
  if (inventory.status !== 0) throw Error('Owned process inventory unavailable')
  const rows = JSON.parse(inventory.stdout)
  ownedProcesses(rows, { root, profilePath, mode: loaded.value.mode })
  const token = rows.find(row => row.name === 'hzy0-gateway')?.pm2_env?.HZY0_GATEWAY_INTERNAL_TOKEN
  if (typeof token !== 'string' || token.length < 16) throw Error('Owned local probe credential unavailable')
  const urls = {
    enterprise: `http://127.0.0.1:${loaded.value.listeners.enterprise.port}/enterprise/_hzy0_worker_health`,
    console: 'http://127.0.0.1:23100/console/_hzy0_worker_health'
  }
  const names = argument === '--probe' ? ['enterprise', 'console'] : [argument.slice('--recover='.length)]
  const result = {}
  for (const name of names) result[name] = await probeWorker(urls[name], token)
  if (argument.startsWith('--recover=') && !result[names[0]].healthy) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    result[names[0]].secondCheck = await probeWorker(urls[names[0]], token)
    if (!result[names[0]].secondCheck.healthy) {
      const restarted = spawnSync(process.execPath, [cliPath, 'restart', '--profile', profilePath, '--app', names[0]], {
        encoding: 'utf8', timeout: 30000
      })
      result[names[0]].recovery = restarted.status === 0 ? 'owned-process-restarted' : 'restart-failed'
      if (restarted.status !== 0) process.exitCode = 1
    }
  } else if (names.some(name => !result[name].healthy)) process.exitCode = 1
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), workers: result }))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => { console.error('Local worker probe unavailable; details suppressed'); process.exitCode = 1 })
}
