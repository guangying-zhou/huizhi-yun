#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(import.meta.dirname, '..')
const DEFAULT_MANIFEST = resolve(ROOT, 'docs/demo/p3-p4/manifest.json')
const DEFAULT_JOURNAL_DIR = resolve(ROOT, 'build/release/p3-p4-demo-data')

function fail(message) {
  console.error(`[p3-p4-demo] ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const options = {
    action: '',
    apply: false,
    keepPartial: false,
    manifestPath: DEFAULT_MANIFEST,
    mysqlBin: process.env.HZY_DEMO_MYSQL_BIN || 'mysql',
    journalPath: ''
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--apply') options.apply = true
    else if (argument === '--keep-partial') options.keepPartial = true
    else if (argument === '--action') options.action = argv[++index] || ''
    else if (argument.startsWith('--action=')) options.action = argument.slice('--action='.length)
    else if (argument === '--manifest') options.manifestPath = resolve(process.cwd(), argv[++index] || '')
    else if (argument.startsWith('--manifest=')) options.manifestPath = resolve(process.cwd(), argument.slice('--manifest='.length))
    else if (argument === '--mysql-bin') options.mysqlBin = argv[++index] || ''
    else if (argument.startsWith('--mysql-bin=')) options.mysqlBin = argument.slice('--mysql-bin='.length)
    else if (argument === '--journal') options.journalPath = resolve(process.cwd(), argv[++index] || '')
    else if (argument.startsWith('--journal=')) options.journalPath = resolve(process.cwd(), argument.slice('--journal='.length))
    else if (argument === '--help' || argument === '-h') options.help = true
    else if (argument !== '--') fail(`unknown argument: ${argument}`)
  }
  return options
}

function printHelp() {
  console.info(`Usage:
  node scripts/run-p3-p4-demo-data.mjs --action <seed|verify|cleanup> [--apply]

Default behavior is plan-only and does not connect to any database. Use --apply
to execute each module SQL with that module's own MySQL connection. Seed failures
automatically run cleanup for modules already completed unless --keep-partial is set.

Per-module connection variables use HZY_DEMO_<APP>_MYSQL_*:
  LOGIN_PATH, HOST, PORT, USER, PASSWORD, DATABASE, SOCKET

LOGIN_PATH is preferred. PASSWORD is passed only through MYSQL_PWD and is never
written to the journal or command output.`)
}

function loadManifest(path) {
  if (!existsSync(path)) fail(`manifest does not exist: ${path}`)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(`invalid manifest JSON ${path}: ${error.message}`)
  }
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function timestamp() {
  return new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')
}

function envPrefix(appCode) {
  return `HZY_DEMO_${appCode.toUpperCase().replaceAll('-', '_')}_MYSQL_`
}

function connectionFor(appCode, moduleConfig) {
  const prefix = envPrefix(appCode)
  const value = suffix => String(process.env[`${prefix}${suffix}`] || '').trim()
  const database = String(process.env[moduleConfig.databaseEnv] || value('DATABASE')).trim()
  if (!database) throw new Error(`missing ${moduleConfig.databaseEnv || `${prefix}DATABASE`}`)

  const loginPath = value('LOGIN_PATH')
  const args = [
    '--binary-mode',
    '--default-character-set=utf8mb4',
    '--show-warnings',
    '--batch',
    '--raw',
    '--column-names',
    `--database=${database}`
  ]
  if (loginPath) {
    args.unshift(`--login-path=${loginPath}`)
  } else {
    const socket = value('SOCKET')
    const user = value('USER')
    if (!user) throw new Error(`missing ${prefix}USER or ${prefix}LOGIN_PATH`)
    args.unshift(`--user=${user}`)
    if (socket) args.unshift(`--socket=${socket}`)
    else {
      args.unshift(`--port=${value('PORT') || '3306'}`)
      args.unshift(`--host=${value('HOST') || '127.0.0.1'}`)
      args.unshift('--protocol=TCP')
    }
  }

  const childEnv = { ...process.env }
  const password = value('PASSWORD')
  if (password) childEnv.MYSQL_PWD = password
  else delete childEnv.MYSQL_PWD
  return { args, childEnv, database }
}

function runSql({ appCode, action, sqlPath, moduleConfig, mysqlBin }) {
  const content = readFileSync(sqlPath, 'utf8')
  const connection = connectionFor(appCode, moduleConfig)
  const startedAt = new Date().toISOString()
  const started = Date.now()
  const result = spawnSync(mysqlBin, connection.args, {
    cwd: ROOT,
    env: connection.childEnv,
    encoding: 'utf8',
    input: content,
    maxBuffer: 10 * 1024 * 1024
  })
  const entry = {
    appCode,
    action,
    database: connection.database,
    sqlPath: sqlPath.slice(ROOT.length + 1),
    sqlSha256: digest(content),
    startedAt,
    durationMs: Date.now() - started,
    exitCode: result.status ?? null,
    stdoutSha256: digest(result.stdout || ''),
    stderrSha256: digest(result.stderr || '')
  }
  if (action === 'verify') entry.evidence = result.stdout || ''
  return { entry, result }
}

function parseVerifyOutput(appCode, stdout, expectedCheckCodes) {
  const lines = String(stdout || '').replaceAll('\r\n', '\n').split('\n')
  while (lines.at(-1) === '') lines.pop()
  if (lines.length === 0) throw new Error(`${appCode} verifier returned no header or result rows`)

  const headers = lines[0].split('\t')
  const checkCodeColumns = headers.flatMap((header, index) => header === 'check_code' ? [index] : [])
  const statusColumns = headers.flatMap((header, index) => header === 'status' ? [index] : [])
  if (checkCodeColumns.length !== 1 || statusColumns.length !== 1) {
    throw new Error(`${appCode} verifier must return exactly one check_code column and one status column; received: ${headers.join(', ')}`)
  }
  if (lines.length === 1) throw new Error(`${appCode} verifier returned no result rows`)

  const checkCodeIndex = checkCodeColumns[0]
  const statusIndex = statusColumns[0]
  const seen = new Map()
  const failures = []
  for (const [offset, line] of lines.slice(1).entries()) {
    if (!line) throw new Error(`${appCode} verifier returned an empty result row at line ${offset + 2}`)
    const columns = line.split('\t')
    if (columns.length !== headers.length) {
      throw new Error(`${appCode} verifier row ${offset + 1} has ${columns.length} column(s); expected ${headers.length}`)
    }
    const checkCode = columns[checkCodeIndex].trim()
    const status = columns[statusIndex].trim().toUpperCase()
    if (!checkCode) throw new Error(`${appCode} verifier row ${offset + 1} has an empty check_code`)
    if (seen.has(checkCode)) throw new Error(`${appCode} verifier returned duplicate check_code: ${checkCode}`)
    seen.set(checkCode, status)
    if (status === 'FAIL') failures.push(checkCode)
    else if (status !== 'PASS') throw new Error(`${appCode} verifier returned invalid status ${JSON.stringify(status)} for ${checkCode}`)
  }

  const missing = expectedCheckCodes.filter(checkCode => !seen.has(checkCode))
  const unexpected = [...seen.keys()].filter(checkCode => !expectedCheckCodes.includes(checkCode))
  const problems = []
  if (failures.length > 0) problems.push(`FAIL check(s): ${failures.join(', ')}`)
  if (missing.length > 0) problems.push(`missing expected check_code(s): ${missing.join(', ')}`)
  if (unexpected.length > 0) problems.push(`unexpected check_code(s): ${unexpected.join(', ')}`)
  if (problems.length > 0) throw new Error(`${appCode} verification failed: ${problems.join('; ')}`)

  return { checkCodes: [...seen.keys()], passedCount: seen.size }
}

function writeJournal(path, journal) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 })
}

const options = parseArgs(process.argv.slice(2))
if (options.help) {
  printHelp()
  process.exit(0)
}
if (!['seed', 'verify', 'cleanup'].includes(options.action)) {
  fail('--action must be seed, verify, or cleanup')
}

const manifest = loadManifest(options.manifestPath)
if (manifest.schemaVersion !== 1) fail(`unsupported manifest schemaVersion: ${manifest.schemaVersion}`)
const order = manifest[`${options.action}Order`]
if (!Array.isArray(order) || order.length === 0) fail(`manifest ${options.action}Order must be a non-empty array`)

const manifestDir = dirname(options.manifestPath)
const plan = order.map(appCode => {
  const moduleConfig = manifest.modules?.[appCode]
  if (!moduleConfig) fail(`manifest is missing modules.${appCode}`)
  if (!Array.isArray(moduleConfig.expectedCheckCodes) || moduleConfig.expectedCheckCodes.length === 0) {
    fail(`manifest modules.${appCode}.expectedCheckCodes must be a non-empty array`)
  }
  if (new Set(moduleConfig.expectedCheckCodes).size !== moduleConfig.expectedCheckCodes.length) {
    fail(`manifest modules.${appCode}.expectedCheckCodes contains duplicates`)
  }
  if (moduleConfig.expectedCheckCodes.some(checkCode => typeof checkCode !== 'string' || !checkCode.trim())) {
    fail(`manifest modules.${appCode}.expectedCheckCodes must contain non-empty strings`)
  }
  const relativeSql = moduleConfig[options.action]
  if (!relativeSql) fail(`manifest is missing modules.${appCode}.${options.action}`)
  const sqlPath = resolve(manifestDir, relativeSql)
  if (!existsSync(sqlPath)) fail(`missing ${appCode} ${options.action} SQL: ${sqlPath}`)
  return { appCode, moduleConfig, sqlPath }
})

console.info(`[p3-p4-demo] package=${manifest.packageId} action=${options.action} mode=${options.apply ? 'apply' : 'plan-only'}`)
for (const [index, item] of plan.entries()) {
  console.info(`[p3-p4-demo] ${index + 1}. app=${item.appCode} sql=${item.sqlPath.slice(ROOT.length + 1)}`)
}
if (!options.apply) {
  console.info('[p3-p4-demo] plan complete; no database connection was opened. Add --apply to execute.')
  process.exit(0)
}

const journalPath = options.journalPath || resolve(DEFAULT_JOURNAL_DIR, `${timestamp()}-${options.action}.json`)
const journal = {
  schemaVersion: 1,
  packageId: manifest.packageId,
  action: options.action,
  startedAt: new Date().toISOString(),
  status: 'running',
  entries: [],
  rollbackEntries: []
}
writeJournal(journalPath, journal)

const completed = []
let failed = false
for (const item of plan) {
  console.info(`[p3-p4-demo] running ${options.action} for ${item.appCode}`)
  let execution
  try {
    execution = runSql({ ...item, action: options.action, mysqlBin: options.mysqlBin })
  } catch (error) {
    journal.entries.push({ appCode: item.appCode, action: options.action, error: error.message })
    failed = true
    break
  }
  journal.entries.push(execution.entry)
  if (options.action === 'verify' && execution.result.stdout) process.stdout.write(execution.result.stdout)
  if (execution.result.status !== 0 || execution.result.error) {
    console.error(execution.result.stderr || execution.result.error?.message || `${item.appCode} failed`)
    failed = true
    break
  }
  if (options.action === 'verify') {
    try {
      execution.entry.verification = parseVerifyOutput(
        item.appCode,
        execution.result.stdout,
        item.moduleConfig.expectedCheckCodes
      )
    } catch (error) {
      execution.entry.verificationError = error.message
      console.error(`[p3-p4-demo] ${error.message}`)
      failed = true
      break
    }
  }
  completed.push(item.appCode)
  writeJournal(journalPath, journal)
}

if (failed && options.action === 'seed' && !options.keepPartial && completed.length > 0) {
  console.warn(`[p3-p4-demo] seed failed; cleaning completed modules in reverse order: ${completed.toReversed().join(', ')}`)
  for (const appCode of completed.toReversed()) {
    const moduleConfig = manifest.modules[appCode]
    const sqlPath = resolve(manifestDir, moduleConfig.cleanup)
    try {
      const execution = runSql({ appCode, action: 'cleanup', sqlPath, moduleConfig, mysqlBin: options.mysqlBin })
      journal.rollbackEntries.push(execution.entry)
      if (execution.result.status !== 0 || execution.result.error) {
        console.error(execution.result.stderr || execution.result.error?.message || `${appCode} cleanup failed`)
      }
    } catch (error) {
      journal.rollbackEntries.push({ appCode, action: 'cleanup', error: error.message })
    }
  }
}

journal.finishedAt = new Date().toISOString()
journal.status = failed ? 'failed' : 'passed'
writeJournal(journalPath, journal)
console.info(`[p3-p4-demo] journal=${journalPath}`)
if (failed) process.exit(1)
console.info(`[p3-p4-demo] ${options.action} passed for ${completed.length} module(s)`)
