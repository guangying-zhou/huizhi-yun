#!/usr/bin/env node
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appConfig, gatewayConfig, validateLocalConfig, root, stateDir, wranglerVersion } from './worker-config.mjs'

const command = process.argv[2] || 'check'
if (!['check', 'configure', 'build', 'smoke', 'start', 'provision', 'verify'].includes(command)) throw Error('Use check, configure, build, provision, start, smoke or verify')
if (Number(process.versions.node.split('.')[0]) !== 24) throw Error('Node 24 required')
const configs = { gateway: gatewayConfig(command === 'start' ? 'integration' : 'smoke'), console: appConfig('console'), people: appConfig('people') }
for (const config of Object.values(configs)) validateLocalConfig(config)
await mkdir(stateDir, { recursive: true, mode: 0o700 })
const children = new Set()

async function run(executable, args, options = {}) {
  const child = spawn(executable, args, { cwd: root, stdio: 'inherit', ...options })
  children.add(child)
  const stop = () => child.kill('SIGTERM')
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  try {
    await new Promise((accept, reject) => {
      child.once('error', reject)
      child.once('exit', code => code === 0 ? accept() : reject(Error(`${executable} exited (${code})`)))
    })
  } catch (error) {
    for (const running of children) running.kill('SIGTERM')
    throw error
  } finally { children.delete(child); process.off('SIGINT', stop); process.off('SIGTERM', stop) }
}

if (command === 'configure') {
  for (const [app, config] of Object.entries(configs)) {
    await mkdir(resolve(stateDir, app), { recursive: true, mode: 0o700 })
    await writeFile(resolve(stateDir, app, 'wrangler.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  }
  console.log('Local configs updated; rebuild applications after changing public origin.')
} else if (command === 'check') {
  console.log(`Local configs valid; Wrangler ${wranglerVersion}; no remote resources or Platform Binding.`)
  for (const app of ['console', 'people']) {
    try { await readFile(resolve(stateDir, app, 'output/server/index.mjs')); console.log(`${app}: build exists`) }
    catch { console.log(`${app}: build required`) }
  }
} else if (command === 'build') {
  for (const app of ['console', 'people']) await run(process.execPath, ['deploy/test-env/build-worker.mjs', app], {
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' }
  })
} else if (command === 'provision') {
  await run(process.execPath, ['deploy/test-env/provision-workers.mjs'])
} else if (command === 'smoke' || command === 'start') {
  for (const [app, config] of Object.entries(configs)) {
    await mkdir(resolve(stateDir, app), { recursive: true, mode: 0o700 })
    await writeFile(resolve(stateDir, app, 'wrangler.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  }
  const secret = randomBytes(32).toString('base64url')
  // No Platform or user credentials in a smoke run. Common file contains ONLY
  // the local gateway identity shared by the three local processes.
  if (command === 'smoke') {
    for (const app of Object.keys(configs)) {
      // Refuse to destroy provisioned integration credentials.
      await writeFile(resolve(stateDir, app, '.dev.vars'), `HZY_TENANT_GATEWAY_INTERNAL_TOKEN=${secret}\n`, { mode: 0o600, flag: 'wx' })
    }
  } else {
    const secrets = {}
    for (const app of Object.keys(configs)) {
      const path = resolve(stateDir, app, '.dev.vars')
      if ((await stat(path)).mode & 0o077) throw Error('Worker secret file permissions must be 0600')
      secrets[app] = parseEnv(await readFile(path, 'utf8'))
    }
    const token = secrets.gateway.HZY_TENANT_GATEWAY_INTERNAL_TOKEN
    if (!token || secrets.console.HZY_TENANT_GATEWAY_INTERNAL_TOKEN !== token
      || secrets.people.HZY_TENANT_GATEWAY_INTERNAL_TOKEN !== token
      || Object.keys(secrets.people).some(k => k !== 'HZY_TENANT_GATEWAY_INTERNAL_TOKEN')
      || !secrets.gateway.HZY_PLATFORM_INTERNAL_TOKEN || !secrets.console.HZY_CONSOLE_PLATFORM_SERVICE_TOKEN) {
      throw Error('Incomplete or overprivileged local Worker secrets; run provision')
    }
  }
  console.log(`Starting local ${command === 'start' ? 'integration' : 'transport smoke'} on 127.0.0.1:19090. Ctrl-C stops this process.`)
  if (command === 'start' && !process.argv.includes('--no-policy-sync')) {
    const syncSecrets = parseEnv(await readFile(resolve(stateDir, 'gateway', '.dev.vars'), 'utf8'))
    let syncing = false
    const sync = async () => {
      if (syncing) return
      syncing = true
      try {
        const response = await fetch('http://127.0.0.1:19090/__local/policy-sync', {
          method: 'POST', headers: { authorization: `Bearer ${syncSecrets.HZY_TENANT_GATEWAY_INTERNAL_TOKEN}` }, signal: AbortSignal.timeout(40_000)
        })
        await response.arrayBuffer()
        console.log(`Independent policy sync: ${response.status}`)
      } catch { console.warn('Independent policy sync unavailable; will retry') }
      finally { syncing = false }
    }
    const interval = setInterval(sync, 60_000)
    const initial = setTimeout(sync, 10_000)
    const stopSync = () => { clearInterval(interval); clearTimeout(initial) }
    process.once('SIGINT', stopSync); process.once('SIGTERM', stopSync)
  }
  // Miniflare 4.20260708.1 uses one assets:storage service name across configs.
  // Separate dev processes isolate asset stores; Wrangler's local registry still
  // connects the named Service Bindings without public HTTP self-calls.
  await Promise.all(Object.keys(configs).map((app, index) => run('pnpm',
    ['dlx', `wrangler@${wranglerVersion}`, 'dev', '--local', '--ip', '127.0.0.1',
      '--port', String(19090 + index), '--inspector-port', String(19290 + index),
      '--persist-to', resolve(stateDir, app, 'storage'),
      '-c', resolve(stateDir, app, 'wrangler.json')], {
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
    })))
} else {
  for (const path of ['/', '/people/employees']) {
    const response = await fetch(`http://127.0.0.1:19090${path}`, { redirect: 'manual', signal: AbortSignal.timeout(15000) })
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html')) throw Error(`${path}: smoke HTTP ${response.status}`)
    console.log(`${path}: HTML 200 (transport only)`)
  }
}
