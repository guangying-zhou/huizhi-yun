import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  buildTemporaryMySqlPlan,
  withTemporaryMySql
} from './support/temporary-mysql-harness.mjs'

const ROOT = resolve(import.meta.dirname, '../..')

function fakeBinaries(directory, scenario) {
  const trace = join(directory, 'trace.jsonl')
  const mysqld = join(directory, 'mysqld')
  const mysql = join(directory, 'mysql')
  const appendSource = `const append = value => fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify(value) + '\\n')`
  writeFileSync(mysqld, `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
${appendSource}
if (args.includes('--version')) { console.log('mysqld  Ver 9.5.0 for test'); process.exit(0) }
const value = prefix => (args.find(item => item.startsWith(prefix)) || '').slice(prefix.length)
const datadir = value('--datadir=')
const pidFile = value('--pid-file=')
if (args.includes('--initialize-insecure')) {
  append({ kind: 'initialize', datadir, pid: process.pid })
  if (${JSON.stringify(scenario)} === 'initialize-fail') process.exit(21)
  fs.mkdirSync(datadir, { recursive: true })
  fs.writeFileSync(datadir + '/initialized', 'yes')
  process.exit(0)
}
append({ kind: 'start', datadir, pidFile, pid: process.pid, args })
if (pidFile) fs.writeFileSync(pidFile, String(process.pid))
if (${JSON.stringify(scenario)} === 'startup-fail') process.exit(22)
const stop = signal => { append({ kind: 'stop', signal, pid: process.pid }); process.exit(0) }
process.on('SIGTERM', () => stop('SIGTERM'))
process.on('SIGINT', () => stop('SIGINT'))
setInterval(() => {}, 1000)
`)
  writeFileSync(mysql, `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
${appendSource}
if (args.includes('--version')) { console.log('mysql  Ver 8.4.9 for test'); process.exit(0) }
const input = fs.readFileSync(0, 'utf8')
append({
  kind: 'mysql',
  args,
  input,
  mysqlPwd: process.env.MYSQL_PWD || '',
  leakedProductionEnvironment: Boolean(process.env.DB_PASSWORD || process.env.DATABASE_URL || process.env.HZY_CONSOLE_DB_PASSWORD)
})
if (["readiness-fail", "startup-fail"].includes(${JSON.stringify(scenario)}) && args.some(item => item.includes('SELECT 1'))) process.exit(23)
if (${JSON.stringify(scenario)} === 'sql-fail' && args.includes('--binary-mode')) process.exit(24)
process.exit(0)
`)
  chmodSync(mysqld, 0o755)
  chmodSync(mysql, 0o755)
  return { mysqld, mysql, trace }
}

function fixture(t, scenario = 'success') {
  const directory = mkdtempSync(join(tmpdir(), 'hzy-mysql-harness-test-'))
  const temporaryParent = join(directory, 'instances')
  writeFileSync(join(directory, 'keep'), 'fixture')
  const binaries = fakeBinaries(directory, scenario)
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return { directory, temporaryParent, ...binaries }
}

function traceRecords(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

function assertNoInstances(parent) {
  assert.deepEqual(existsSync(parent) ? readdirSync(parent) : [], [])
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function planFor(binaries, sqlFiles = []) {
  return await buildTemporaryMySqlPlan({
    rootDir: ROOT,
    mysqld: binaries.mysqld,
    mysql: binaries.mysql,
    sqlFiles
  })
}

test('preview creates no directory and resolves no configured binary', async (t) => {
  const files = fixture(t)
  const plan = await buildTemporaryMySqlPlan({
    rootDir: ROOT,
    mysqld: '/definitely/missing/mysqld',
    mysql: '/definitely/missing/mysql'
  })
  let callbackCalled = false
  const result = await withTemporaryMySql(plan, async () => { callbackCalled = true }, {
    execute: false,
    temporaryParent: files.temporaryParent
  })

  assert.equal(result.mode, 'preview')
  assert.equal(callbackCalled, false)
  assertNoInstances(files.temporaryParent)
  assert.deepEqual(traceRecords(files.trace), [])
})

test('SQL paths cannot escape the workspace root', async () => {
  await assert.rejects(() => buildTemporaryMySqlPlan({
    rootDir: ROOT,
    sqlFiles: [{ appCode: 'console', path: '/etc/passwd' }]
  }), /escapes workspace root/)
})

test('release gate runs only the fake-binary harness safety test', () => {
  const releaseCheck = readFileSync(resolve(ROOT, 'scripts/run-release-check.mjs'), 'utf8')
  assert.match(releaseCheck, /Temporary MySQL harness safety behavior/, 'release gate must name the offline harness check')
  assert.match(releaseCheck, /'test:mysql-harness'/)
  assert.doesNotMatch(releaseCheck, /'harness:mysql'/, 'release gate must not start a real local database')
})

test('execute rejects missing binaries before creating a temporary directory', async (t) => {
  const files = fixture(t)
  const plan = await buildTemporaryMySqlPlan({
    rootDir: ROOT,
    mysqld: '/definitely/missing/mysqld',
    mysql: '/definitely/missing/mysql'
  })
  await assert.rejects(() => withTemporaryMySql(plan, async () => undefined, {
    execute: true,
    confirm: plan.confirmationSha256,
    temporaryParent: files.temporaryParent
  }), /mysqld executable not found/)
  assertNoInstances(files.temporaryParent)
})

test('mysqld startup failure removes its datadir and leaves no live process', async (t) => {
  const files = fixture(t, 'startup-fail')
  const plan = await planFor(files)
  await assert.rejects(() => withTemporaryMySql(plan, async () => undefined, {
    execute: true,
    confirm: plan.confirmationSha256,
    temporaryParent: files.temporaryParent,
    startupTimeoutMs: 800
  }), /exited during startup|did not become ready/)

  const start = traceRecords(files.trace).find(item => item.kind === 'start')
  assert.ok(start?.pid)
  assert.equal(isAlive(start.pid), false)
  assert.equal(existsSync(start.datadir), false)
  assertNoInstances(files.temporaryParent)
})

test('readiness timeout force-stops mysqld and removes the complete instance', async (t) => {
  const files = fixture(t, 'readiness-fail')
  const plan = await planFor(files)
  await assert.rejects(() => withTemporaryMySql(plan, async () => undefined, {
    execute: true,
    confirm: plan.confirmationSha256,
    temporaryParent: files.temporaryParent,
    startupTimeoutMs: 500
  }), /did not become ready/)

  const records = traceRecords(files.trace)
  const start = records.find(item => item.kind === 'start')
  assert.ok(start?.pid)
  assert.equal(isAlive(start.pid), false)
  assert.equal(records.some(item => item.kind === 'stop' && item.pid === start.pid), true)
  assert.equal(existsSync(start.datadir), false)
  assertNoInstances(files.temporaryParent)
})

test('success bootstraps application databases, preserves SQL order, isolates env, then cleans up', async (t) => {
  const files = fixture(t)
  const sqlFiles = [
    { appCode: 'console', path: 'console/docs/hzy_console_schema.sql' },
    { appCode: 'aims', path: 'aims/docs/aims_schema.sql' },
    { appCode: 'altoc', path: 'altoc/docs/altoc_schema.sql' }
  ]
  const plan = await planFor(files, sqlFiles)
  assert.deepEqual(plan.sqlFiles.map(item => item.appCode), ['console', 'aims', 'altoc'])
  assert.equal(new Set(plan.sqlFiles.map(item => item.sha256)).size, 3)

  process.env.DB_PASSWORD = 'must-not-reach-test-mysql'
  process.env.DATABASE_URL = 'mysql://production.invalid'
  process.env.HZY_CONSOLE_DB_PASSWORD = 'must-not-reach-test-mysql'
  try {
    await withTemporaryMySql(plan, async (context) => {
      assert.deepEqual(context.databases, {
        console: 'hzy_console',
        aims: 'hzy_aims',
        altoc: 'hzy_altoc',
        people: 'hzy_people'
      })
      assert.deepEqual(context.connection('aims'), {
        host: '127.0.0.1',
        port: context.port,
        user: 'hzy_test',
        password: context.password,
        database: 'hzy_aims'
      })
      assert.deepEqual(context.connectionEnv('altoc', 'ALTOC_DB'), {
        ALTOC_DB_HOST: '127.0.0.1',
        ALTOC_DB_PORT: String(context.port),
        ALTOC_DB_USER: 'hzy_test',
        ALTOC_DB_PASSWORD: context.password,
        ALTOC_DB_NAME: 'hzy_altoc'
      })
      assert.deepEqual(context.sqlFileResults.map(item => [item.appCode, item.path]), [
        ['console', 'console/docs/hzy_console_schema.sql'],
        ['aims', 'aims/docs/aims_schema.sql'],
        ['altoc', 'altoc/docs/altoc_schema.sql']
      ])
      assert.equal(existsSync(context.datadir), true)
    }, {
      execute: true,
      confirm: plan.confirmationSha256,
      temporaryParent: files.temporaryParent,
      startupTimeoutMs: 1_000
    })
  } finally {
    delete process.env.DB_PASSWORD
    delete process.env.DATABASE_URL
    delete process.env.HZY_CONSOLE_DB_PASSWORD
  }

  const records = traceRecords(files.trace)
  const mysqlCalls = records.filter(item => item.kind === 'mysql')
  const bootstrap = mysqlCalls.find(item => item.input.includes('CREATE DATABASE IF NOT EXISTS'))
  assert.match(bootstrap.input, /`hzy_console`/)
  assert.match(bootstrap.input, /`hzy_aims`/)
  assert.match(bootstrap.input, /`hzy_altoc`/)
  assert.match(bootstrap.input, /`hzy_people`/)
  assert.equal(mysqlCalls.every(item => item.leakedProductionEnvironment === false), true)
  assert.equal(mysqlCalls.some(item => item.mysqlPwd === 'must-not-reach-test-mysql'), false)
  const imports = mysqlCalls.filter(item => item.args.includes('--binary-mode'))
  assert.deepEqual(imports.map(item => item.args.find(arg => arg.startsWith('--database='))), [
    '--database=hzy_console',
    '--database=hzy_aims',
    '--database=hzy_altoc'
  ])
  assertNoInstances(files.temporaryParent)
})

test('schema failure still stops mysqld and removes the partial databases', async (t) => {
  const files = fixture(t, 'sql-fail')
  const plan = await planFor(files, [
    { appCode: 'aims', path: 'aims/docs/aims_schema.sql' }
  ])
  await assert.rejects(() => withTemporaryMySql(plan, async () => undefined, {
    execute: true,
    confirm: plan.confirmationSha256,
    temporaryParent: files.temporaryParent,
    startupTimeoutMs: 1_000
  }), /mysql command failed/)

  const start = traceRecords(files.trace).find(item => item.kind === 'start')
  assert.ok(start?.pid)
  assert.equal(isAlive(start.pid), false)
  assert.equal(existsSync(start.datadir), false)
  assertNoInstances(files.temporaryParent)
})
