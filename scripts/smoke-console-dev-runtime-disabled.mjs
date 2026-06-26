#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONSOLE_DIR = resolve(ROOT_DIR, 'console')
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = Number(process.env.CONSOLE_DEV_SMOKE_PORT || '3098')
const DEFAULT_TIMEOUT_MS = Number(process.env.CONSOLE_DEV_SMOKE_TIMEOUT_MS || '60000')

function usage() {
  return `
Usage:
  pnpm run smoke:console-dev-runtime-disabled
  pnpm run smoke:console-dev-runtime-disabled -- --port 3098 --timeout-ms 60000

Starts a temporary console-dev Nuxt server with Platform runtime disabled,
probes activation status and diagnostics, then stops the server. This catches
regressions where local Console returns 503 before the runtime-disabled
short-circuit can run.
`
}

function fail(message) {
  throw new Error(message)
}

function requiredValue(name, value) {
  if (!value || value.startsWith('--')) fail(`missing value for --${name}`)
  return value
}

function parseArgs(argv) {
  const args = {
    host: process.env.CONSOLE_DEV_SMOKE_HOST || DEFAULT_HOST,
    port: DEFAULT_PORT,
    explicitPort: Boolean(process.env.CONSOLE_DEV_SMOKE_PORT),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    showLogs: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--') continue
    if (item === '--help' || item === '-h') {
      args.help = true
      continue
    }
    if (item === '--show-logs') {
      args.showLogs = true
      continue
    }
    if (!item.startsWith('--')) continue

    const raw = item.slice(2)
    const equalsIndex = raw.indexOf('=')
    const name = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw
    const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : argv[index + 1]

    if (name === 'host') {
      args.host = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }
    if (name === 'port') {
      args.port = Number(requiredValue(name, value))
      args.explicitPort = true
      if (!Number.isInteger(args.port) || args.port <= 0) fail('--port must be a positive integer')
      if (equalsIndex < 0) index += 1
      continue
    }
    if (name === 'timeout-ms') {
      args.timeoutMs = Number(requiredValue(name, value))
      if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1000) fail('--timeout-ms must be an integer >= 1000')
      if (equalsIndex < 0) index += 1
      continue
    }

    fail(`unknown option: --${name}`)
  }

  return args
}

function pushLog(logs, chunk) {
  const value = String(chunk || '')
  if (!value) return
  logs.push(value)
  while (logs.join('').length > 12000) {
    logs.shift()
  }
}

function listenOnce(host, port) {
  return new Promise((resolveListen, rejectListen) => {
    const server = createServer()
    server.once('error', rejectListen)
    server.listen(port, host, () => {
      const address = server.address()
      server.close(() => resolveListen(address))
    })
  })
}

async function resolvePort(host, preferredPort, explicitPort) {
  try {
    await listenOnce(host, preferredPort)
    return preferredPort
  } catch (error) {
    if (explicitPort) {
      fail(`port ${preferredPort} on ${host} is not available: ${error.message}`)
    }
  }

  const address = await listenOnce(host, 0)
  if (!address || typeof address === 'string') {
    fail('failed to allocate a temporary port')
  }
  return address.port
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    })
    const text = await response.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    return {
      ok: response.ok,
      status: response.status,
      body
    }
  } finally {
    clearTimeout(timer)
  }
}

async function waitForServer(baseUrl, timeoutMs, logs) {
  const deadline = Date.now() + timeoutMs
  let lastError = ''

  while (Date.now() < deadline) {
    try {
      const result = await fetchJson(`${baseUrl}/console/api/activation/status`, 2000)
      if (result.ok) return result
      lastError = `HTTP ${result.status}: ${JSON.stringify(result.body).slice(0, 300)}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise(resolveTimeout => setTimeout(resolveTimeout, 750))
  }

  fail(`console-dev did not become ready within ${timeoutMs}ms; last error: ${lastError}\n${logs.join('')}`)
}

function dataOf(result, label) {
  if (!result.ok) {
    fail(`${label} returned HTTP ${result.status}: ${JSON.stringify(result.body).slice(0, 500)}`)
  }
  if (!result.body || typeof result.body !== 'object' || result.body.code !== 0) {
    fail(`${label} returned unexpected envelope: ${JSON.stringify(result.body).slice(0, 500)}`)
  }
  return result.body.data || {}
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertFalsy(value, label) {
  if (value) {
    fail(`${label} expected empty value, got ${JSON.stringify(value)}`)
  }
}

function assertIncludes(value, needle, label) {
  if (!String(value || '').includes(needle)) {
    fail(`${label} expected to include ${JSON.stringify(needle)}, got ${JSON.stringify(value)}`)
  }
}

function assertStatus(status) {
  assertEqual(status.mode, 'active', 'activation status mode')
  assertEqual(status.activated, true, 'activation status activated')
  assertEqual(status.envValid, true, 'activation status envValid')
  assertEqual(status.licenseValid, true, 'activation status licenseValid')
  assertEqual(status.bundleReady, false, 'activation status bundleReady')
  assertFalsy(status.lastError, 'activation status lastError')
}

function assertDiagnostics(diagnostics, host, port) {
  assertEqual(diagnostics.process?.host, host, 'diagnostics process.host')
  assertEqual(diagnostics.process?.port, String(port), 'diagnostics process.port')

  assertEqual(diagnostics.runtime?.runMode, 'dev', 'diagnostics runtime.runMode')
  assertEqual(diagnostics.runtime?.runtimeEnabled, false, 'diagnostics runtime.runtimeEnabled')
  assertEqual(diagnostics.runtime?.heartbeatEnabled, false, 'diagnostics runtime.heartbeatEnabled')
  assertEqual(diagnostics.runtime?.bundleRefreshOnBoot, false, 'diagnostics runtime.bundleRefreshOnBoot')
  assertEqual(diagnostics.runtime?.authClientMaterializeEnabled, false, 'diagnostics runtime.authClientMaterializeEnabled')
  assertEqual(diagnostics.runtime?.backgroundJobsEnabled, false, 'diagnostics runtime.backgroundJobsEnabled')
  assertEqual(diagnostics.runtime?.devPolicyBypassEnabled, true, 'diagnostics runtime.devPolicyBypassEnabled')
  assertEqual(diagnostics.runtime?.trustTenantGateway, false, 'diagnostics runtime.trustTenantGateway')

  assertEqual(diagnostics.auth?.clientMaterializeMode, 'disabled', 'diagnostics auth.clientMaterializeMode')
  assertEqual(diagnostics.auth?.signingKeyAutogenerate, false, 'diagnostics auth.signingKeyAutogenerate')
  assertEqual(diagnostics.auth?.signingKeyRotateUnusable, false, 'diagnostics auth.signingKeyRotateUnusable')

  assertEqual(diagnostics.collab?.mode, 'disabled', 'diagnostics collab.mode')
  assertEqual(diagnostics.collab?.status, 'disabled', 'diagnostics collab.status')

  assertEqual(diagnostics.platform?.configured, false, 'diagnostics platform.configured')
  assertIncludes(diagnostics.platform?.error, 'runtime is disabled', 'diagnostics platform.error')

  assertEqual(diagnostics.cache?.backend, 'file', 'diagnostics cache.backend')
  assertEqual(diagnostics.cache?.cacheDir, '.data/platform-runtime-dev', 'diagnostics cache.cacheDir')
  assertEqual(diagnostics.cache?.scope, null, 'diagnostics cache.scope')
  assertEqual(diagnostics.cache?.legacyFallback, false, 'diagnostics cache.legacyFallback')

  assertStatus(diagnostics.activation || {})
  assertEqual(diagnostics.bundle?.ready, false, 'diagnostics bundle.ready')
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise(resolveExit => child.once('exit', resolveExit)),
    new Promise(resolveTimeout => setTimeout(resolveTimeout, 5000))
  ])
  if (child.exitCode === null && !child.signalCode) {
    child.kill('SIGKILL')
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.info(usage().trim())
    return
  }

  if (!existsSync(CONSOLE_DIR)) {
    fail(`console directory not found: ${CONSOLE_DIR}`)
  }

  const port = await resolvePort(args.host, args.port, args.explicitPort)
  const baseUrl = `http://${args.host}:${port}`
  const logs = []
  const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

  const env = {
    ...process.env,
    NODE_ENV: 'development',
    HOST: args.host,
    PORT: String(port),
    NITRO_HOST: args.host,
    NITRO_PORT: String(port),
    HZY_CONSOLE_RUN_MODE: 'dev',
    HZY_PLATFORM_RUNTIME_ENABLED: 'false',
    HZY_PLATFORM_HEARTBEAT_ENABLED: 'false',
    HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT: 'false',
    HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE: 'false',
    HZY_PLATFORM_BUNDLE_CACHE_BACKEND: 'file',
    HZY_PLATFORM_BUNDLE_CACHE_DIR: '.data/platform-runtime-dev',
    HZY_PLATFORM_BUNDLE_CACHE_SCOPE: '',
    HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK: 'false',
    HZY_CONSOLE_BACKGROUND_JOBS_ENABLED: 'false',
    HZY_CONSOLE_DEV_POLICY_BYPASS: 'true',
    HZY_CONSOLE_TRUST_TENANT_GATEWAY: 'false',
    HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_MODE: 'disabled',
    CONSOLE_COLLAB_MODE: 'disabled',
    CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE: 'false',
    CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE: 'false'
  }

  const child = spawn(
    pnpmBin,
    ['exec', 'nuxt', 'dev', '--dotenv', '.env.example', '--host', args.host, '--port', String(port)],
    {
      cwd: CONSOLE_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  child.stdout.on('data', chunk => {
    pushLog(logs, chunk)
    if (args.showLogs) process.stdout.write(chunk)
  })
  child.stderr.on('data', chunk => {
    pushLog(logs, chunk)
    if (args.showLogs) process.stderr.write(chunk)
  })

  child.once('error', error => {
    pushLog(logs, `${error.message}\n`)
  })

  try {
    const initialStatus = await waitForServer(baseUrl, args.timeoutMs, logs)
    assertStatus(dataOf(initialStatus, 'activation status'))

    const diagnosticsResult = await fetchJson(`${baseUrl}/console/api/activation/diagnostics`, 5000)
    assertDiagnostics(dataOf(diagnosticsResult, 'activation diagnostics'), args.host, port)

    console.info(`[console-dev-smoke] passed: ${baseUrl}/console runtime disabled activation stays HTTP 200`)
  } finally {
    await stopChild(child)
  }
}

main().catch((error) => {
  console.error(`[console-dev-smoke] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
