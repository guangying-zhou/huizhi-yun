#!/usr/bin/env node
import { access, mkdir, writeFile, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createConnection } from 'node:net'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { readProfile, profileSummary, record, validateProfile } from './local-enterprise/config.mjs'
import { ownedProcesses } from './local-enterprise/process-ownership.mjs'
import { readCollabClientSecret } from './local-enterprise/collab-credentials.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const [command = 'plan', ...argumentsAfterCommand] = process.argv.slice(2)
const { values } = parseArgs({
  args: argumentsAfterCommand,
  options: {
    profile: { type: 'string' },
    mode: { type: 'string' },
    app: { type: 'string' }
  },
  strict: true,
  allowPositionals: false
})
if (!['plan', 'doctor', 'build', 'up', 'status', 'logs', 'restart', 'down'].includes(command)) {
  throw Error('Use plan, doctor, build, up, status, logs, restart, or down')
}
if (!values.profile) throw Error('Use an absolute --profile path')
const loaded = await readProfile(values.profile)
if (loaded.value?.features?.codocsCollaborationV2 === true
  && (['plan', 'doctor', 'up', 'restart'].includes(command))) {
  try {
    readCollabClientSecret(loaded.profilePath)
  } catch { loaded.issues.push('Collab credential provider is unavailable or unsafe') }
}
const mode = values.mode || loaded.value.mode
if (!['dev', 'node'].includes(mode)) throw Error('Use --mode dev or node')

if (command === 'plan') {
  console.log(JSON.stringify({ ...profileSummary(loaded.value), blockers: loaded.issues }, null, 2))
} else if (command === 'doctor') {
  const result = await doctor(loaded.value, loaded.issues)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ready) process.exitCode = 1
} else {
  const issues = validateProfile(loaded.value)
  if (issues.length) throw Error(`Profile is not approved:\n- ${issues.join('\n- ')}`)
  if (command === 'build' || mode === 'node') throw Error('Node mode requires isolated, pinned build artifacts; this stage is not implemented. Existing Dev processes were not changed.')
  if (command === 'logs') throw Error('Raw PM2 logs may contain credentials or business data; use status until a redacted log adapter is implemented.')
  await requirePm2()
  const processes = await inventory(loaded.value)
  if (command === 'up') {
    if (processes.some(p => p.status !== 'online')) throw Error('Owned processes are not online; inspect status and explicitly restart the affected app')
    const missing = ['hzy0-gateway', 'hzy0-enterprise', 'hzy0-codocs-editor',
      ...(loaded.value.identity.consoleFacadeMode === 'local-canonical-facade' ? ['hzy0-console'] : []),
      ...(loaded.value.features?.codocsCollaborationV2 === true ? ['hzy0-collab'] : []),
      ...(loaded.value.features?.workflowLocal === true ? ['hzy0-workflow', 'hzy0-aims'] : [])].filter(name => !processes.some(p => p.name === name))
    if (missing.length) await pm2(loaded.value, ['start', await ecosystem(loaded.profilePath, mode), '--only', missing.join(','), '--update-env'])
    else console.log('Owned Dev stack already online; no processes changed.')
  } else if (command === 'status') console.log(JSON.stringify({ processes }, null, 2))
  else if (command === 'restart') {
    const names = values.app ? [appName(values.app)] : [
      'hzy0-gateway', 'hzy0-enterprise', 'hzy0-codocs-editor',
      ...(loaded.value.identity.consoleFacadeMode === 'local-canonical-facade' ? ['hzy0-console'] : []),
      ...(loaded.value.features?.codocsCollaborationV2 === true ? ['hzy0-collab'] : []),
      ...(loaded.value.features?.workflowLocal === true ? ['hzy0-workflow', 'hzy0-aims'] : [])
    ]
    if (names.some(name => !processes.some(p => p.name === name))) throw Error('Requested owned process is not running')
    // Preserve the already-approved PM2 credential environment. Do not replace
    // it from the caller's shell or require the secret to be exported again.
    await pm2(loaded.value, ['restart', ...names])
  } else if (command === 'down' && processes.length) await pm2(loaded.value, ['delete', ...processes.map(p => p.name)])
}

async function doctor(profile, validationIssues) {
  const listeners = record(profile.listeners)
  const ports = await Promise.all(Object.entries(listeners).map(async ([name, listener]) => ({
    name, port: listener?.port, available: await portAvailable(listener?.host, listener?.port)
  })))
  const commands = ['caddy', 'cloudflared', 'pm2', 'wrangler'].map(name => ({ name, available: commandAvailable(name) }))
  let processes = [], ownershipError = false
  try { processes = await inventory(profile) } catch { ownershipError = true }
  return {
    profile: profileSummary(profile),
    node: { version: process.version, supported: process.versions.node.startsWith('24.') },
    validationIssues,
    commands,
    ports,
    processes,
    ownershipError,
    ready: validationIssues.length === 0 && !ownershipError && process.versions.node.startsWith('24.') && commands.every(command => command.available)
      && ['gatewayIngress', 'enterprise', 'codocsEditor', ...(profile.identity?.consoleFacadeMode === 'local-canonical-facade' ? ['console'] : []),
        ...(profile.features?.codocsCollaborationV2 === true ? ['collab'] : []),
        ...(profile.features?.workflowLocal === true ? ['workflow', 'aims'] : [])].every(name => {
        const port = ports.find(p => p.name === name)
        const processName = name === 'gatewayIngress' ? 'hzy0-gateway' : name === 'codocsEditor' ? 'hzy0-codocs-editor' : `hzy0-${name}`
        return port?.available || processes.some(p => p.name === processName && p.status === 'online')
      }),
    acceptancePassed: false
  }
}

async function inventory(profile) {
  const home = profile.processManagement?.pm2Home
  if (!home || !resolve(home).endsWith('/hzy0/pm2')) throw Error('Unsafe PM2_HOME')
  let pid
  try { pid = Number((await readFile(resolve(home, 'pm2.pid'), 'utf8')).trim()) } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  if (!Number.isInteger(pid) || pid <= 0) throw Error('Invalid PM2 daemon PID')
  try { process.kill(pid, 0) } catch (error) { if (error.code === 'ESRCH') return []; throw error }
  const result = spawnSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 10000, maxBuffer: 8*1024*1024, env: { ...safeEnvironment(profile), PM2_HOME: home } })
  if (result.status !== 0) throw Error('Unable to read PM2 inventory')
  return ownedProcesses(JSON.parse(result.stdout), { root, profilePath: loaded.profilePath, mode })
}

async function ecosystem(profilePath, mode) {
  const source = resolve(dirname(new URL(import.meta.url).pathname), 'local-enterprise/pm2.config.cjs')
  await access(source, constants.R_OK)
  const target = resolve(record((await readProfile(profilePath)).value).processManagement.pm2Home, 'ecosystem.config.cjs')
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  await writeFile(target, `module.exports = require(${JSON.stringify(source)})\n`, { mode: 0o600 })
  process.env.HZY0_PROFILE_FILE = profilePath
  process.env.HZY0_MODE = mode
  process.env.HZY0_REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..')
  process.env.HZY0_NODE_BIN = process.execPath
  return target
}

async function pm2(profile, args) {
  let gatewayToken = String(process.env.HZY0_GATEWAY_INTERNAL_TOKEN || '').trim()
  const onlyIndex = args.indexOf('--only')
  const startsGateway = onlyIndex < 0 || String(args[onlyIndex + 1] || '').split(',').includes('hzy0-gateway')
  if (args[0] === 'start' && !startsGateway && !gatewayToken) {
    const result = spawnSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 10000, maxBuffer: 8*1024*1024,
      env: { ...safeEnvironment(profile), PM2_HOME: profile.processManagement.pm2Home } })
    if (result.status !== 0) throw Error('Owned Gateway credential unavailable')
    const rows = JSON.parse(result.stdout)
    ownedProcesses(rows, { root, profilePath: loaded.profilePath, mode })
    gatewayToken = String(rows.find(row => row.name === 'hzy0-gateway')?.pm2_env?.HZY0_GATEWAY_INTERNAL_TOKEN || '')
    if (!gatewayToken) throw Error('Owned Gateway credential unavailable')
  }
  if (args[0] === 'start' && startsGateway && !gatewayToken) {
    throw Error('HZY0_GATEWAY_INTERNAL_TOKEN must be supplied by the approved credential provider.')
  }
  const result = spawnSync('pm2', args, { stdio: 'inherit', env: {
    ...safeEnvironment(profile),
    PM2_HOME: profile.processManagement.pm2Home,
    HZY0_PROFILE_FILE: values.profile,
    HZY0_MODE: mode,
    HZY0_REPO_ROOT: resolve(dirname(new URL(import.meta.url).pathname), '../..'),
    HZY0_NODE_BIN: process.execPath,
    ...(gatewayToken ? { HZY0_GATEWAY_INTERNAL_TOKEN: gatewayToken } : {})
  } })
  if (result.status !== 0) throw Error(`pm2 ${args[0]} failed`)
}

function safeEnvironment(profile) {
  const environment = {}
  for (const key of ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL']) if (process.env[key]) environment[key] = process.env[key]
  return {
    ...environment,
    NODE_ENV: 'development',
    HZY_APP_RUN_MODE: 'test',
    HZY_PLATFORM_ENVIRONMENT: 'test',
    HZY_DEV_APPLICATIONS_ENABLED: 'false',
    HZY_LOCAL_DEV_APPLICATIONS_ENABLED: 'false',
    HZY_LOCAL_DEV_RUNTIME_BYPASS: 'false',
    HZY_DEV_RUNTIME_BYPASS: 'false',
    HZY_CONSOLE_DEV_POLICY_BYPASS: 'false',
    CONSOLE_DEV_POLICY_BYPASS: 'false',
    PM2_HOME: profile.processManagement.pm2Home
  }
}

function appName(app) {
  if (!['gateway', 'enterprise', 'codocs-editor', 'console', 'collab', 'workflow', 'aims'].includes(app || '')) throw Error('Use --app gateway, enterprise, codocs-editor, console, collab, workflow, or aims')
  return `hzy0-${app}`
}

function commandAvailable(command) {
  return spawnSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' }).status === 0
}

async function portAvailable(host, port) {
  if (host !== '127.0.0.1' || !Number.isInteger(port)) return false
  return await new Promise(resolve => {
    const socket = createConnection({ host, port })
    socket.setTimeout(1500, () => { socket.destroy(); resolve(false) })
    socket.once('connect', () => { socket.destroy(); resolve(false) })
    socket.once('error', error => resolve(error.code === 'ECONNREFUSED'))
  })
}

async function requirePm2() {
  if (!commandAvailable('pm2')) throw Error('pm2 is required for this command; install it through the approved local toolchain.')
}
