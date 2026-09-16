import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { constants as fsConstants, rmSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { tmpdir } from 'node:os'
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'

const DEFAULT_TOTAL_TIMEOUT_MS = 30_000
const DEFAULT_POLL_MS = 100
const DEFAULT_CAPTURE_BYTES = 64 * 1024
const RESERVED_ENV = new Set(['NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'PATH', 'HOME', 'TMPDIR'])
const INHERITED_RUNTIME_ENVIRONMENT = Object.freeze([
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SYSTEMROOT',
  'DYLD_LIBRARY_PATH',
  'DYLD_FALLBACK_LIBRARY_PATH',
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'LIBRARY_PATH'
])
const SENSITIVE_NAME_PATTERN = /(?:authorization|cookie|credential|password|secret|token|api[_-]?key|access[_-]?token|client[_-]?secret)/i
const SENSITIVE_KEY_SEGMENT_PATTERN = /(?:^|[_-])key(?:$|[_-])/i
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi
const BASIC_PATTERN = /\bBasic\s+[A-Za-z0-9+/]+=*/gi
const AUTHORIZATION_VALUE_PATTERN = /\bauthorization\b\s*[:=]\s*[^\r\n]*/gi
const COOKIE_VALUE_PATTERN = /\b(?:set-cookie|cookie)\b\s*[:=]\s*[^\r\n]*/gi
const SENSITIVE_VALUE_PATTERN = /\b((?:[a-z0-9]+[_-])*(?:credential|key|password|secret|token))\b\s*[:=]\s*(?:\[[^\]]+\]|[^\s,;]+)/gi
const URL_USERINFO_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi

export class LocalProcessGroupConfigurationError extends Error {}
export class LocalProcessGroupExecutionError extends Error {}

function stringValue(value) {
  return String(value || '').trim()
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function isSensitiveProcessValueName(value) {
  const name = String(value || '')
  return SENSITIVE_NAME_PATTERN.test(name) || SENSITIVE_KEY_SEGMENT_PATTERN.test(name)
}

function insideRoots(candidate, roots, label) {
  const absolute = resolve(candidate)
  for (const root of roots.map(item => resolve(item))) {
    const rel = relative(root, absolute)
    if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) return absolute
  }
  throw new LocalProcessGroupConfigurationError(`${label} is outside the allowed roots: ${candidate}`)
}

function assertLoopbackReadiness(readiness, name) {
  let url
  try {
    url = new URL(readiness?.url || '')
  } catch {
    throw new LocalProcessGroupConfigurationError(`${name} readiness URL is invalid`)
  }
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new LocalProcessGroupConfigurationError(`${name} readiness URL must use loopback HTTP(S)`)
  }
  if (url.username || url.password) throw new LocalProcessGroupConfigurationError(`${name} readiness URL must not contain userinfo`)
  if (url.search || url.hash) throw new LocalProcessGroupConfigurationError(`${name} readiness URL must not contain query or fragment data`)
  const status = Number(readiness?.status)
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new LocalProcessGroupConfigurationError(`${name} readiness status must be an HTTP status code`)
  }
  return { url: url.toString(), status }
}

function normalizeAllowedEnvironment(values) {
  const result = [...new Set((values || []).map(stringValue).filter(Boolean))].sort()
  for (const name of result) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new LocalProcessGroupConfigurationError(`invalid environment allowlist name: ${name}`)
    if (RESERVED_ENV.has(name)) throw new LocalProcessGroupConfigurationError(`${name} is supervisor-owned and cannot be allowlisted`)
  }
  return result
}

function normalizeProcess(input, index, context) {
  const name = stringValue(input.name)
  if (!/^[a-z][a-z0-9._-]{0,63}$/i.test(name)) {
    throw new LocalProcessGroupConfigurationError(`process ${index + 1} has an invalid name`)
  }
  const command = stringValue(input.command)
  if (!command) throw new LocalProcessGroupConfigurationError(`${name} command is required`)
  const args = (input.args || []).map(value => String(value))
  for (const argument of args) {
    const flagName = /^--?([^=]+)/.exec(argument)?.[1] || ''
    if ((flagName && isSensitiveProcessValueName(flagName)) || redactCapturedProcessOutput(argument) !== argument) {
      throw new LocalProcessGroupConfigurationError(`${name} command arguments must not contain credentials`)
    }
  }
  const cwd = insideRoots(resolve(context.rootDir, input.cwd || '.'), context.allowedWorkingRoots, `${name} cwd`)
  const environment = {}
  for (const [key, rawValue] of Object.entries(input.env || {})) {
    if (!context.allowedEnvironment.has(key)) {
      throw new LocalProcessGroupConfigurationError(`${name} environment key is not allowlisted: ${key}`)
    }
    environment[key] = String(rawValue)
  }
  return {
    name,
    command,
    args,
    cwd,
    environment,
    readiness: assertLoopbackReadiness(input.readiness, name)
  }
}

export function redactCapturedProcessOutput(value, sensitiveValues = []) {
  let output = String(value || '')
  for (const sensitive of [...new Set(sensitiveValues.map(String).filter(Boolean))].sort((left, right) => right.length - left.length)) {
    output = output.replaceAll(sensitive, '[redacted]')
  }
  return output
    .replace(URL_USERINFO_PATTERN, '$1[redacted]@')
    .replace(AUTHORIZATION_VALUE_PATTERN, 'Authorization=[redacted]')
    .replace(COOKIE_VALUE_PATTERN, 'Cookie=[redacted]')
    .replace(SENSITIVE_VALUE_PATTERN, '$1=[redacted]')
    .replace(BEARER_PATTERN, 'Bearer [redacted]')
    .replace(BASIC_PATTERN, 'Basic [redacted]')
    .replace(JWT_PATTERN, '[redacted-jwt]')
}

const redact = redactCapturedProcessOutput

function environmentSensitiveValues(processes) {
  const values = []
  for (const processSpec of processes) {
    for (const [key, rawValue] of Object.entries(processSpec.environment)) {
      const value = String(rawValue || '')
      if (!value) continue
      if (isSensitiveProcessValueName(key)) values.push(value)
      try {
        const url = new URL(value)
        if (url.username || url.password) {
          if (url.username) values.push(url.username, decodeURIComponent(url.username))
          if (url.password) values.push(url.password, decodeURIComponent(url.password))
          values.push(`${url.username}:${url.password}`)
        }
      } catch {
        // Non-URL environment values need no userinfo extraction.
      }
    }
  }
  return [...new Set(values.filter(Boolean))].sort((left, right) => right.length - left.length)
}

function boundedAppend(current, chunk, maximum) {
  if (current.length >= maximum) return current
  return `${current}${String(chunk)}`.slice(0, maximum)
}

async function executableDescriptor(command, pathValue) {
  const candidates = command.includes('/')
    ? [resolve(command)]
    : String(pathValue || '').split(delimiter).filter(Boolean).map(entry => resolve(entry, command))
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK)
      if ((await stat(candidate)).isFile()) {
        const path = await realpath(candidate)
        return { path, sha256: sha256(await readFile(path)) }
      }
    } catch {
      // Keep searching PATH.
    }
  }
  return null
}

function inheritedRuntimeEnvironment(source = process.env, pathValue = source.PATH) {
  const values = {}
  for (const key of INHERITED_RUNTIME_ENVIRONMENT) {
    if (source[key]) values[key] = String(source[key])
  }
  return {
    pathValue: String(pathValue || '/usr/bin:/bin'),
    values
  }
}

function isolatedEnvironment(homeDir, explicit, caFile, runtimeEnvironment) {
  const environment = {
    PATH: runtimeEnvironment.pathValue,
    HOME: homeDir,
    TMPDIR: join(homeDir, 'tmp'),
    NODE_OPTIONS: '--dns-result-order=ipv4first',
    ...(caFile ? { NODE_EXTRA_CA_CERTS: caFile } : {}),
    ...runtimeEnvironment.values
  }
  return { ...environment, ...explicit }
}

async function readinessStatus(readiness, ca, timeoutMs) {
  const url = new URL(readiness.url)
  const transport = url.protocol === 'https:' ? https : http
  return await new Promise((resolveStatus, reject) => {
    const request = transport.request(url, {
      method: 'GET',
      ...(url.protocol === 'https:' && ca ? { ca } : {})
    }, (response) => {
      response.resume()
      response.once('end', () => resolveStatus(response.statusCode || 0))
    })
    request.setTimeout(timeoutMs, () => request.destroy(new Error('readiness request timed out')))
    request.once('error', reject)
    request.end()
  })
}

function signalProcessGroup(record, signal) {
  if (!record.child.pid) return
  try {
    process.kill(-record.child.pid, signal)
  } catch {
    try { record.child.kill(signal) } catch {}
  }
}

function processGroupExists(pid) {
  if (!pid) return false
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

function waitForClose(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise(resolveClose => {
    const timer = setTimeout(() => resolveClose(false), timeoutMs)
    child.once('close', () => {
      clearTimeout(timer)
      resolveClose(true)
    })
  })
}

async function stopRecord(record, graceMs) {
  const pid = record.child.pid
  record.stopping = true
  signalProcessGroup(record, 'SIGTERM')
  await waitForClose(record.child, graceMs)
  if (processGroupExists(pid)) signalProcessGroup(record, 'SIGKILL')
  await waitForClose(record.child, 1_000)
}

function assertHealthy(health) {
  if (health.error) throw health.error
}

async function waitUntilReady(record, deadline, pollMs, ca, health) {
  let lastStatus = 0
  let lastError = ''
  while (Date.now() < deadline) {
    assertHealthy(health)
    if (record.startError) throw record.startError
    if (record.child.exitCode !== null || record.child.signalCode !== null) {
      throw new LocalProcessGroupExecutionError(`${record.name} exited before readiness with ${record.child.signalCode || record.child.exitCode}`)
    }
    const remaining = deadline - Date.now()
    try {
      lastStatus = await Promise.race([
        readinessStatus(record.readiness, ca, Math.max(100, Math.min(1_000, remaining))),
        health.promise.then(error => Promise.reject(error))
      ])
      if (lastStatus === record.readiness.status) return
      lastError = `HTTP ${lastStatus}`
    } catch (error) {
      lastError = redact(error.message)
    }
    await new Promise(resolveWait => setTimeout(resolveWait, Math.min(pollMs, Math.max(1, deadline - Date.now()))))
  }
  throw new LocalProcessGroupExecutionError(`${record.name} readiness timed out${lastError ? `; last=${lastError}` : ''}`)
}

function callbackWithDeadline(callback, context, deadline, controller, health) {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new LocalProcessGroupExecutionError('process group total timeout expired before callback')
  let timer
  const callbackResult = new Promise((resolveCallback, reject) => {
    timer = setTimeout(() => {
      controller.abort(new Error('process group total timeout'))
      reject(new LocalProcessGroupExecutionError('process group total timeout expired during callback'))
    }, remaining)
    Promise.resolve()
      .then(() => callback(context))
      .then(resolveCallback, reject)
  })
  return Promise.race([
    callbackResult,
    health.promise.then(error => Promise.reject(error))
  ]).finally(() => clearTimeout(timer))
}

export async function buildLocalProcessGroupPlan(input = {}) {
  const rootDir = resolve(input.rootDir || process.cwd())
  const allowedWorkingRoots = (input.allowedWorkingRoots || [rootDir]).map(value => resolve(value))
  const allowedFileRoots = (input.allowedFileRoots || [rootDir]).map(value => resolve(value))
  const allowedEnvironment = normalizeAllowedEnvironment(input.allowedEnvironment)
  const totalTimeoutMs = Number(input.totalTimeoutMs || DEFAULT_TOTAL_TIMEOUT_MS)
  if (!Number.isInteger(totalTimeoutMs) || totalTimeoutMs < 500 || totalTimeoutMs > 300_000) {
    throw new LocalProcessGroupConfigurationError('totalTimeoutMs must be an integer from 500 to 300000')
  }
  const pollMs = Number(input.pollMs || DEFAULT_POLL_MS)
  if (!Number.isInteger(pollMs) || pollMs < 20 || pollMs > 2_000) {
    throw new LocalProcessGroupConfigurationError('pollMs must be an integer from 20 to 2000')
  }
  const caFile = input.caFile
    ? insideRoots(input.caFile, allowedFileRoots, 'CA file')
    : ''
  let caSha256 = null
  if (caFile) {
    try { caSha256 = sha256(await readFile(caFile)) } catch (error) {
      throw new LocalProcessGroupConfigurationError(`cannot read CA file: ${error.message}`)
    }
  }
  const context = {
    rootDir,
    allowedWorkingRoots,
    allowedEnvironment: new Set(allowedEnvironment)
  }
  const processes = (input.processes || []).map((item, index) => normalizeProcess(item, index, context))
  if (processes.length === 0) throw new LocalProcessGroupConfigurationError('at least one process is required')
  if (new Set(processes.map(item => item.name)).size !== processes.length) {
    throw new LocalProcessGroupConfigurationError('process names must be unique')
  }
  const runtimeEnvironment = inheritedRuntimeEnvironment(input.inheritedEnvironment || process.env, input.pathValue)
  const executables = []
  for (const item of processes) {
    const executable = await executableDescriptor(item.command, runtimeEnvironment.pathValue)
    if (!executable) throw new LocalProcessGroupConfigurationError(`${item.name} executable not found: ${item.command}`)
    executables.push(executable)
  }

  const summary = {
    schemaVersion: 1,
    mode: 'local-process-group',
    executionDefault: 'preview',
    shell: false,
    detachedProcessGroups: true,
    totalTimeoutMs,
    pollMs,
    nodeOptions: '--dns-result-order=ipv4first',
    inheritedRuntimeEnvironment: {
      pathSha256: sha256(runtimeEnvironment.pathValue),
      keys: Object.keys(runtimeEnvironment.values).sort(),
      valuesSha256: sha256(JSON.stringify(Object.entries(runtimeEnvironment.values).sort(([left], [right]) => left.localeCompare(right))))
    },
    caFile: caFile ? { path: caFile, sha256: caSha256 } : null,
    allowedEnvironment,
    processes: processes.map((item, index) => ({
      name: item.name,
      command: item.command,
      executable: executables[index].path,
      executableSha256: executables[index].sha256,
      argCount: item.args.length,
      argsSha256: sha256(JSON.stringify(item.args)),
      cwd: item.cwd,
      environmentKeys: Object.keys(item.environment).sort(),
      readiness: item.readiness
    }))
  }
  const binding = {
    ...summary,
    inheritedRuntimeEnvironment: runtimeEnvironment,
    commandArgs: processes.map(item => ({ name: item.name, args: item.args })),
    environment: processes.map(item => ({ name: item.name, values: Object.entries(item.environment).sort(([left], [right]) => left.localeCompare(right)) }))
  }
  const plan = { ...summary, confirmationSha256: sha256(JSON.stringify(binding)) }
  Object.defineProperty(plan, 'execution', {
    enumerable: false,
    value: {
      rootDir,
      caFile,
      ca: caFile ? await readFile(caFile) : null,
      processes,
      executables,
      runtimeEnvironment,
      sensitiveValues: environmentSensitiveValues(processes)
    }
  })
  return plan
}

export async function withLocalProcessGroup(plan, callback, options = {}) {
  if (options.execute !== true) return { mode: 'preview', plan }
  if (options.confirm !== plan.confirmationSha256) {
    throw new LocalProcessGroupConfigurationError('--confirm must exactly match the preview confirmation SHA-256')
  }
  const execution = plan.execution
  if (!execution) throw new LocalProcessGroupConfigurationError('plan does not contain local execution details')
  if (execution.caFile) {
    let actualCaSha256 = ''
    try { actualCaSha256 = sha256(await readFile(execution.caFile)) } catch {}
    if (!plan.caFile || actualCaSha256 !== plan.caFile.sha256) {
      throw new LocalProcessGroupConfigurationError('CA file changed since preview; create a new confirmation digest')
    }
  }
  const commands = []
  for (const [index, item] of execution.processes.entries()) {
    const expected = execution.executables[index]
    const command = await executableDescriptor(expected?.path || item.command, execution.runtimeEnvironment.pathValue)
    if (!command || command.path !== expected.path || command.sha256 !== expected.sha256) {
      throw new LocalProcessGroupConfigurationError(`${item.name} executable changed since preview; create a new confirmation digest`)
    }
    commands.push(command.path)
  }

  const temporaryParent = resolve(options.temporaryParent || tmpdir())
  await mkdir(temporaryParent, { recursive: true, mode: 0o700 })
  const homeDir = await mkdtemp(join(temporaryParent, 'hzy-process-group-'))
  const records = []
  const health = { error: null, resolve: null, promise: null }
  health.promise = new Promise(resolveFailure => { health.resolve = resolveFailure })
  const controller = new AbortController()
  const externalSignal = options.signal
  if (externalSignal && (typeof externalSignal.addEventListener !== 'function' || typeof externalSignal.aborted !== 'boolean')) {
    throw new LocalProcessGroupConfigurationError('signal must be an AbortSignal')
  }
  const cancelGroup = () => {
    if (health.error) return
    health.error = new LocalProcessGroupExecutionError('process group cancelled')
    controller.abort(health.error)
    health.resolve(health.error)
  }
  const abortListener = () => cancelGroup()
  if (externalSignal?.aborted) cancelGroup()
  else externalSignal?.addEventListener('abort', abortListener, { once: true })
  const redactOutput = value => redact(value, execution.sensitiveValues)
  const captureBytes = Math.max(1_024, Math.min(Number(options.captureBytes || DEFAULT_CAPTURE_BYTES), 1024 * 1024))
  const graceMs = Math.max(50, Math.min(Number(options.terminationGraceMs || 1_000), 10_000))
  const emergencyCleanup = () => {
    for (const record of [...records].reverse()) signalProcessGroup(record, 'SIGKILL')
    try { rmSync(homeDir, { recursive: true, force: true }) } catch {}
  }
  process.once('exit', emergencyCleanup)
  try {
    assertHealthy(health)
    await mkdir(join(homeDir, 'tmp'), { recursive: true, mode: 0o700 })
    const deadline = Date.now() + plan.totalTimeoutMs
    for (const [index, item] of execution.processes.entries()) {
      const child = spawn(commands[index], item.args, {
        cwd: item.cwd,
        env: isolatedEnvironment(homeDir, item.environment, execution.caFile, execution.runtimeEnvironment),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false
      })
      const record = {
        name: item.name,
        child,
        readiness: item.readiness,
        stdout: '',
        stderr: '',
        startError: null,
        stopping: false,
        ready: false
      }
      records.push(record)
      child.stdout.on('data', chunk => { record.stdout = boundedAppend(record.stdout, chunk, captureBytes) })
      child.stderr.on('data', chunk => { record.stderr = boundedAppend(record.stderr, chunk, captureBytes) })
      child.once('error', error => { record.startError = error })
      child.once('close', (code, signal) => {
        if (record.stopping || health.error) return
        health.error = new LocalProcessGroupExecutionError(
          record.ready
            ? `${record.name} exited unexpectedly after readiness with ${signal || code}`
            : `${record.name} exited before readiness unexpectedly with ${signal || code}`
        )
        health.resolve(health.error)
      })
      await waitUntilReady(record, deadline, plan.pollMs, execution.ca, health)
      record.ready = true
    }

    const context = {
      signal: controller.signal,
      processes: records.map(record => ({ name: record.name, pid: record.child.pid, readiness: record.readiness })),
      logs(name) {
        const record = records.find(item => item.name === name)
        if (!record) throw new LocalProcessGroupConfigurationError(`unknown process: ${name}`)
        return { stdout: redactOutput(record.stdout), stderr: redactOutput(record.stderr) }
      }
    }
    assertHealthy(health)
    const value = await callbackWithDeadline(callback, context, deadline, controller, health)
    assertHealthy(health)
    return { mode: 'executed', value }
  } catch (error) {
    const diagnostics = records
      .map(record => {
        const stdout = redactOutput(record.stdout).trim()
        const stderr = redactOutput(record.stderr).trim()
        return [stdout && `${record.name}.stdout=${stdout}`, stderr && `${record.name}.stderr=${stderr}`].filter(Boolean).join('\n')
      })
      .filter(Boolean)
      .join('\n')
    if (error instanceof LocalProcessGroupConfigurationError || error instanceof LocalProcessGroupExecutionError) {
      error.message = `${redactOutput(error.message)}${diagnostics ? `\n${diagnostics}` : ''}`
      throw error
    }
    throw new LocalProcessGroupExecutionError(`${redactOutput(error.message)}${diagnostics ? `\n${diagnostics}` : ''}`)
  } finally {
    controller.abort(new Error('process group stopped'))
    for (const record of records) record.stopping = true
    for (const record of [...records].reverse()) await stopRecord(record, graceMs)
    process.removeListener('exit', emergencyCleanup)
    externalSignal?.removeEventListener('abort', abortListener)
    await rm(homeDir, { recursive: true, force: true })
  }
}
