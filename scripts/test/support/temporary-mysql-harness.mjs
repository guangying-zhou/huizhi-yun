import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { constants as fsConstants, rmSync } from 'node:fs'
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'

const APP_DATABASES = Object.freeze({
  console: 'hzy_console',
  aims: 'hzy_aims',
  altoc: 'hzy_altoc',
  people: 'hzy_people'
})

const APP_CODES = Object.freeze(Object.keys(APP_DATABASES))
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000
const MAX_CAPTURE_BYTES = 1024 * 1024

export class TemporaryMySqlConfigurationError extends Error {}
export class TemporaryMySqlExecutionError extends Error {}

function stringValue(value) {
  return String(value || '').trim()
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function insideRoot(rootDir, candidate) {
  const absolute = resolve(rootDir, candidate)
  const rel = relative(rootDir, absolute)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new TemporaryMySqlConfigurationError(`SQL file escapes workspace root: ${candidate}`)
  }
  return absolute
}

async function executablePath(command, pathValue = process.env.PATH || '') {
  const configured = stringValue(command)
  if (!configured) return ''
  const candidates = configured.includes('/')
    ? [resolve(configured)]
    : pathValue.split(delimiter).filter(Boolean).map(entry => resolve(entry, configured))
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK)
      const info = await stat(candidate)
      if (info.isFile()) return candidate
    } catch {
      // Keep searching PATH.
    }
  }
  return ''
}

function isolatedEnvironment(rootDir, additions = {}) {
  const source = process.env
  const environment = {
    PATH: source.PATH || '/usr/bin:/bin',
    HOME: rootDir,
    TMPDIR: join(rootDir, 'tmp')
  }
  for (const key of ['LANG', 'LC_ALL', 'LC_CTYPE', 'DYLD_LIBRARY_PATH', 'DYLD_FALLBACK_LIBRARY_PATH', 'SYSTEMROOT']) {
    if (source[key]) environment[key] = source[key]
  }
  return { ...environment, ...additions }
}

function appendCapture(current, chunk) {
  if (current.length >= MAX_CAPTURE_BYTES) return current
  return `${current}${String(chunk)}`.slice(0, MAX_CAPTURE_BYTES)
}

async function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout = appendCapture(stdout, chunk) })
  child.stderr.on('data', chunk => { stderr = appendCapture(stderr, chunk) })
  child.stdin.on('error', () => undefined)
  if (options.input !== undefined) child.stdin.end(options.input)
  else child.stdin.end()

  const timeoutMs = options.timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, timeoutMs)
  const result = await new Promise((resolveResult, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolveResult({ code, signal }))
  }).finally(() => clearTimeout(timer))
  if (timedOut) {
    throw new TemporaryMySqlExecutionError(`${basename(command)} timed out after ${timeoutMs}ms`)
  }
  return { ...result, stdout, stderr }
}

async function assertSupportedBinary(command, kind, environment, cwd) {
  const result = await runCommand(command, ['--no-defaults', '--version'], {
    env: environment,
    cwd,
    timeoutMs: 5_000
  })
  if (result.code !== 0) {
    throw new TemporaryMySqlExecutionError(`${kind} --version failed: ${result.stderr.trim() || `exit ${result.code}`}`)
  }
  const output = `${result.stdout}\n${result.stderr}`.trim()
  const match = output.match(/\bVer\s+(\d+)(?:\.|\b)/i) || output.match(/\b(\d+)\.\d+\.\d+\b/)
  const major = Number(match?.[1] || 0)
  if (major !== 8 && major !== 9) {
    throw new TemporaryMySqlExecutionError(`${kind} must be MySQL 8 or 9; reported: ${output || 'unknown version'}`)
  }
  return { major, output }
}

async function reserveLocalPort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolveListen)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  if (!port) throw new TemporaryMySqlExecutionError('failed to reserve a local MySQL port')
  return port
}

function mysqlSocketArgs(socketPath) {
  return ['--no-defaults', '--protocol=SOCKET', `--socket=${socketPath}`, '--user=root', '--batch', '--skip-column-names']
}

function mysqlTcpArgs(context, database) {
  return [
    '--no-defaults',
    '--protocol=TCP',
    '--host=127.0.0.1',
    `--port=${context.port}`,
    `--user=${context.user}`,
    ...(database ? [`--database=${database}`] : []),
    '--batch',
    '--skip-column-names'
  ]
}

async function mysqlCommand(context, args, input, options = {}) {
  const result = await runCommand(context.mysql, args, {
    cwd: context.rootDir,
    env: isolatedEnvironment(context.rootDir, options.password ? { MYSQL_PWD: options.password } : {}),
    input,
    timeoutMs: options.timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS
  })
  if (result.code !== 0) {
    throw new TemporaryMySqlExecutionError(`mysql command failed: ${result.stderr.trim() || `exit ${result.code}`}`)
  }
  return result
}

async function waitForReady(context, child, startupError, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = ''
  while (Date.now() < deadline) {
    if (startupError.value) throw startupError.value
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new TemporaryMySqlExecutionError(`mysqld exited during startup with ${child.signalCode || child.exitCode}`)
    }
    const result = await runCommand(context.mysql, [...mysqlSocketArgs(context.socketPath), '--execute=SELECT 1'], {
      cwd: context.rootDir,
      env: isolatedEnvironment(context.rootDir),
      timeoutMs: 2_000
    }).catch(error => ({ code: -1, stderr: error.message }))
    if (result.code === 0) return
    lastError = stringValue(result.stderr)
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new TemporaryMySqlExecutionError(`mysqld did not become ready within ${timeoutMs}ms${lastError ? `: ${lastError}` : ''}`)
}

async function stopChild(child, graceMs = 5_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const waitForClose = timeoutMs => new Promise(resolveClose => {
    const timer = setTimeout(() => resolveClose(false), timeoutMs)
    child.once('close', () => {
      clearTimeout(timer)
      resolveClose(true)
    })
  })
  child.kill('SIGTERM')
  await waitForClose(graceMs)
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await waitForClose(1_000)
  }
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

async function bootstrapDatabases(context) {
  const statements = Object.values(APP_DATABASES)
    .map(database => `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`)
  statements.push(
    `CREATE USER IF NOT EXISTS ${sqlQuote(context.user)}@'127.0.0.1' IDENTIFIED BY ${sqlQuote(context.password)};`,
    `ALTER USER ${sqlQuote(context.user)}@'127.0.0.1' IDENTIFIED BY ${sqlQuote(context.password)};`
  )
  for (const database of Object.values(APP_DATABASES)) {
    statements.push(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO ${sqlQuote(context.user)}@'127.0.0.1';`)
  }
  statements.push('FLUSH PRIVILEGES;')
  await mysqlCommand(context, mysqlSocketArgs(context.socketPath), `${statements.join('\n')}\n`)
  await mysqlCommand(context, [...mysqlTcpArgs(context), '--execute=SELECT 1'], undefined, { password: context.password })
}

async function applySqlFiles(context, sqlFiles) {
  const results = []
  for (const item of sqlFiles) {
    const contents = await readFile(item.absolutePath)
    const result = await mysqlCommand(
      context,
      [...mysqlSocketArgs(context.socketPath), `--database=${APP_DATABASES[item.appCode]}`, '--binary-mode'],
      contents
    )
    results.push({
      appCode: item.appCode,
      path: item.path,
      stdout: result.stdout,
      stderr: result.stderr
    })
  }
  return results
}

function connectionFor(context, appCode) {
  if (!APP_DATABASES[appCode]) throw new TemporaryMySqlConfigurationError(`unsupported app: ${appCode}`)
  return {
    host: '127.0.0.1',
    port: context.port,
    user: context.user,
    password: context.password,
    database: APP_DATABASES[appCode]
  }
}

export async function buildTemporaryMySqlPlan(input = {}) {
  const rootDir = resolve(input.rootDir || process.cwd())
  const sqlFiles = []
  for (const raw of input.sqlFiles || []) {
    const appCode = stringValue(raw.appCode).toLowerCase()
    if (!APP_CODES.includes(appCode)) {
      throw new TemporaryMySqlConfigurationError(`SQL app must be one of ${APP_CODES.join(', ')}: ${raw.appCode}`)
    }
    const absolutePath = insideRoot(rootDir, raw.path)
    let contents
    try {
      contents = await readFile(absolutePath)
    } catch (error) {
      throw new TemporaryMySqlConfigurationError(`cannot read ${appCode} SQL file ${raw.path}: ${error.message}`)
    }
    sqlFiles.push({
      appCode,
      path: relative(rootDir, absolutePath),
      absolutePath,
      sha256: sha256(contents)
    })
  }
  const summary = {
    schemaVersion: 1,
    mode: 'temporary-mysql',
    bindAddress: '127.0.0.1',
    randomPort: true,
    initializeInsecure: true,
    readsDefaultFiles: false,
    performanceSchema: input.performanceSchema === true,
    freshDatadirPerRun: true,
    sqlFilesAppliedOnceInInputOrder: true,
    repeatedImportIdempotencyClaimed: false,
    databases: APP_DATABASES,
    mysqld: stringValue(input.mysqld || 'mysqld'),
    mysql: stringValue(input.mysql || 'mysql'),
    sqlFiles: sqlFiles.map(({ absolutePath, ...item }) => item)
  }
  return {
    ...summary,
    sqlFiles,
    confirmationSha256: sha256(JSON.stringify(summary))
  }
}

export async function withTemporaryMySql(plan, callback, options = {}) {
  const execute = options.execute === true
  if (!execute) return { mode: 'preview', plan }
  if (options.confirm !== plan.confirmationSha256) {
    throw new TemporaryMySqlConfigurationError('--confirm must exactly match the preview confirmation SHA-256')
  }

  const pathValue = options.pathValue || process.env.PATH || ''
  const mysqld = await executablePath(plan.mysqld, pathValue)
  const mysql = await executablePath(plan.mysql, pathValue)
  if (!mysqld) throw new TemporaryMySqlConfigurationError(`mysqld executable not found: ${plan.mysqld}`)
  if (!mysql) throw new TemporaryMySqlConfigurationError(`mysql executable not found: ${plan.mysql}`)

  const port = await reserveLocalPort()
  const temporaryParent = resolve(options.temporaryParent || tmpdir())
  await mkdir(temporaryParent, { recursive: true, mode: 0o700 })
  const rootDir = await mkdtemp(join(temporaryParent, 'hzy-test-mysql-'))
  try {
    await chmod(rootDir, 0o700)
  } catch (error) {
    await rm(rootDir, { recursive: true, force: true })
    throw error
  }
  const context = {
    rootDir,
    datadir: join(rootDir, 'data'),
    socketPath: join(rootDir, 'mysql.sock'),
    pidFile: join(rootDir, 'mysqld.pid'),
    logFile: join(rootDir, 'mysqld.log'),
    secureFileDir: join(rootDir, 'secure-files'),
    mysqld,
    mysql,
    port,
    user: 'hzy_test',
    password: randomBytes(24).toString('base64url'),
    databases: APP_DATABASES,
    connection(appCode) { return connectionFor(context, appCode) },
    connectionEnv(appCode, prefix = 'DB') {
      const connection = connectionFor(context, appCode)
      return {
        [`${prefix}_HOST`]: connection.host,
        [`${prefix}_PORT`]: String(connection.port),
        [`${prefix}_USER`]: connection.user,
        [`${prefix}_PASSWORD`]: connection.password,
        [`${prefix}_NAME`]: connection.database
      }
    }
  }
  let child = null
  const emergencyCleanup = () => {
    try { child?.kill('SIGKILL') } catch {}
    try { rmSync(rootDir, { recursive: true, force: true }) } catch {}
  }
  process.once('exit', emergencyCleanup)
  try {
    await Promise.all([
      mkdir(context.datadir, { recursive: true, mode: 0o700 }),
      mkdir(join(rootDir, 'tmp'), { recursive: true, mode: 0o700 }),
      mkdir(context.secureFileDir, { recursive: true, mode: 0o700 })
    ])
    const environment = isolatedEnvironment(rootDir)
    context.versions = {
      mysqld: await assertSupportedBinary(mysqld, 'mysqld', environment, rootDir),
      mysql: await assertSupportedBinary(mysql, 'mysql', environment, rootDir)
    }
    const initialize = await runCommand(mysqld, [
      '--no-defaults',
      '--initialize-insecure',
      `--datadir=${context.datadir}`,
      `--log-error=${context.logFile}`
    ], {
      cwd: rootDir,
      env: environment,
      timeoutMs: options.initializeTimeoutMs || DEFAULT_COMMAND_TIMEOUT_MS
    })
    if (initialize.code !== 0) {
      throw new TemporaryMySqlExecutionError(`mysqld initialize failed: ${initialize.stderr.trim() || `exit ${initialize.code}`}`)
    }

    const startupError = { value: null }
    child = spawn(mysqld, [
      '--no-defaults',
      `--datadir=${context.datadir}`,
      `--socket=${context.socketPath}`,
      `--pid-file=${context.pidFile}`,
      `--log-error=${context.logFile}`,
      '--bind-address=127.0.0.1',
      `--port=${context.port}`,
      '--mysqlx=0',
      '--skip-name-resolve',
      '--skip-log-bin',
      `--secure-file-priv=${context.secureFileDir}`,
      `--tmpdir=${join(rootDir, 'tmp')}`,
      '--max-connections=32',
      plan.performanceSchema ? '--performance-schema=ON' : '--performance-schema=OFF'
    ], {
      cwd: rootDir,
      env: environment,
      stdio: 'ignore'
    })
    child.once('error', error => { startupError.value = error })
    await waitForReady(context, child, startupError, options.startupTimeoutMs || DEFAULT_STARTUP_TIMEOUT_MS)
    await bootstrapDatabases(context)
    context.sqlFileResults = await applySqlFiles(context, plan.sqlFiles)
    const value = await callback(context)
    return { mode: 'executed', value, databases: APP_DATABASES }
  } catch (error) {
    if (error instanceof TemporaryMySqlConfigurationError || error instanceof TemporaryMySqlExecutionError) throw error
    let logTail = ''
    try { logTail = (await readFile(context.logFile, 'utf8')).slice(-4_000).trim() } catch {}
    throw new TemporaryMySqlExecutionError(`${error.message}${logTail ? `\nmysqld log tail:\n${logTail}` : ''}`)
  } finally {
    process.removeListener('exit', emergencyCleanup)
    await stopChild(child)
    await rm(rootDir, { recursive: true, force: true })
  }
}

export { APP_DATABASES }
