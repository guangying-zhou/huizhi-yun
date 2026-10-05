#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const root = fileURLToPath(new URL('../../', import.meta.url))
export const tunnelArgs = ['-N', '-T', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
  '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
  '-L', '127.0.0.1:18080:127.0.0.1:18084', 'root@gitlab.wiztek.cn']

export function validateEnv(app, env) {
  if (!['console', 'people'].includes(app)) throw new Error('Unsupported app')
  const prefix = `HZY_${app.toUpperCase()}`
  const required = { HOST: '127.0.0.1', HZY_DEPLOYMENT_PROFILE: 'dev',
    HZY_PLATFORM_RUNTIME_ENABLED: 'false', [`${prefix}_DATA_ACCESS_MODE`]: 'tenant-runtime',
    [`${prefix}_TENANT_RUNTIME_URL`]: 'http://127.0.0.1:18080' }
  if (app === 'console') Object.assign(required, {
    HZY_CONSOLE_TRUST_TENANT_GATEWAY: 'false', HZY_PLATFORM_HEARTBEAT_ENABLED: 'false',
    HZY_CONSOLE_BACKGROUND_JOBS_ENABLED: 'false', HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE: 'false',
    HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT: 'false', CONSOLE_COLLAB_MODE: 'disabled'
  })
  else Object.assign(required, { HZY_SYNC_APPROVAL_ACTIONS_ON_STARTUP: 'false',
    HZY_CONSOLE_API_URL: 'http://127.0.0.1:3000/console',
    HZY_PEOPLE_OFFBOARDING_NOTIFICATIONS_ENABLED: 'false',
    HZY_PEOPLE_INTEGRATION_OPERATION_DEAD_LETTER_NOTIFICATIONS_ENABLED: 'false',
    HZY_PEOPLE_ASSETS_OFFBOARDING_SYNC_ENABLED: 'false', HZY_PEOPLE_DIRECTORY_LIFECYCLE_SYNC_ENABLED: 'false' })
  for (const [key, value] of Object.entries(required)) {
    if (env[key] !== value) throw new Error(`${app}: unsafe/missing ${key}; consult deploy/test-env/README.md`)
  }
  for (const [key, value] of Object.entries(env)) {
    if (value && (/^DB_|_DB_(HOST|USER|PASSWORD|NAME)$|VAULT_MASTER_KEY|SIGNING_PRIVATE/.test(key))) {
      throw new Error(`${app}: forbidden local credential ${key}`)
    }
  }
}

async function freePort(port) {
  await new Promise((accept, reject) => {
    const server = createServer()
    server.once('error', () => reject(new Error(`Port ${port} is occupied; stop its owner before starting this stack`)))
    server.listen(port, '127.0.0.1', () => server.close(accept))
  })
}

export function validateHealth(health) {
  if (health.tenant !== 'C000001' || health.deployment !== 'c000001-test-tenant-runtime'
    || health.status !== 'ok' || ['console', 'directory', 'people'].some(app => health.apps?.[app]?.db !== 'ok')) {
    throw new Error('Test Runtime identity/health mismatch; do not continue')
  }
}

export async function check() {
  const response = await fetch('http://127.0.0.1:18080/runtime/health', { signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error(`Runtime health: HTTP ${response.status}`)
  const health = await response.json()
  validateHealth(health)
  const denied = await fetch('http://127.0.0.1:18080/v1/console/directory/users', { signal: AbortSignal.timeout(10000) })
  if (denied.status !== 401) throw new Error(`Runtime failed unauthenticated rejection check: ${denied.status}`)
  console.log(`C000001 test Runtime ${health.version}: healthy; unauthenticated access rejected (401).`)
  for (const [app, port] of [['console', 3000], ['people', 3007]]) {
    const r = await fetch(`http://127.0.0.1:${port}/${app}/`, { signal: AbortSignal.timeout(30000) })
    if (!r.ok) throw new Error(`${app} page: HTTP ${r.status}`)
    console.log(`${app}: HTTP ${r.status} (page reachability only, not login acceptance).`)
  }
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Run nvm use first; Node 24 is required')
  const mode = process.argv[2] || '--start'
  if (mode === '--check') return check()
  if (!['--start', '--tunnel-only'].includes(mode)) throw new Error('Use --start, --tunnel-only or --check')
  if (mode === '--start') {
    for (const app of ['console', 'people']) {
      // Runtime env overrides dotenv, so inspect both before spawning Nuxt.
      validateEnv(app, { ...parseEnv(readFileSync(resolve(root, app, '.env.dev'), 'utf8')), ...process.env })
    }
  }
  for (const port of mode === '--start' ? [18080, 3000, 3007, 24685] : [18080]) await freePort(port)
  const children = []
  let stopping = false
  const stop = (code = 0) => {
    if (stopping) return
    stopping = true
    for (const child of children) {
      if (child.pid) { try { process.kill(-child.pid, 'SIGTERM') } catch {} }
    }
    setTimeout(() => {
      for (const child of children) {
        if (child.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch {} }
      }
      process.exit(code)
    }, 3000)
  }
  const start = (command, args, env = process.env) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', detached: true })
    children.push(child)
    child.on('error', () => { console.error(`${command} failed to start`); stop(1) })
    child.on('exit', code => { if (!stopping) stop(code || 1) })
  }
  process.on('SIGINT', () => stop())
  process.on('SIGTERM', () => stop())
  start('ssh', tunnelArgs)
  if (mode === '--start') {
    for (const app of ['console', 'people']) start('pnpm', ['--dir', app, 'dev'], {
      ...process.env, NODE_OPTIONS: '--max-old-space-size=2048', HOST: '127.0.0.1'
    })
  }
  console.log('Test tunnel starting: localhost:18080 → China localhost:18084. Ctrl-C stops only this command’s children.')
  console.log('Full SSO/service-token acceptance still requires the test deployment enrollment and trusted bootstrap integration.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
