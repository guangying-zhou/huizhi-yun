import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const ROOT = resolve(import.meta.dirname, '../..')
const RUNNER = resolve(ROOT, 'scripts/run-p3-p4-demo-data.mjs')
const FAKE_MYSQL = resolve(ROOT, 'scripts/fixtures/p3-p4-demo-data/fake-mysql.mjs')

chmodSync(FAKE_MYSQL, 0o755)

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'hzy-p3-p4-demo-'))
  const manifestPath = resolve(directory, 'manifest.json')
  const sqlPath = resolve(directory, 'verify.sql')
  const journalPath = resolve(directory, 'journal.json')
  writeFileSync(sqlPath, 'SELECT 1;\n')
  writeFileSync(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    packageId: 'offline-verifier-test',
    verifyOrder: ['fixture'],
    modules: {
      fixture: {
        databaseEnv: 'HZY_DEMO_FIXTURE_MYSQL_DATABASE',
        verify: 'verify.sql',
        expectedCheckCodes: ['fixture.alpha', 'fixture.beta']
      }
    }
  }, null, 2)}\n`)
  return { directory, journalPath, manifestPath }
}

function runFixture(scenario, { apply = true, mysqlBin = FAKE_MYSQL } = {}) {
  const fixture = createFixture()
  const args = [
    RUNNER,
    '--action', 'verify',
    '--manifest', fixture.manifestPath,
    '--mysql-bin', mysqlBin,
    '--journal', fixture.journalPath
  ]
  if (apply) args.push('--apply')
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      HZY_DEMO_FAKE_MYSQL_SCENARIO: scenario,
      HZY_DEMO_FIXTURE_MYSQL_DATABASE: 'offline_fixture',
      HZY_DEMO_FIXTURE_MYSQL_LOGIN_PATH: 'offline_fixture'
    }
  })
  const journal = existsSync(fixture.journalPath)
    ? JSON.parse(readFileSync(fixture.journalPath, 'utf8'))
    : undefined
  rmSync(fixture.directory, { recursive: true, force: true })
  return { ...result, journal, output: `${result.stdout}${result.stderr}` }
}

test('verify parses mysql batch output and records the exact passing checks offline', () => {
  const result = runFixture('pass')

  assert.equal(result.status, 0, result.output)
  assert.equal(result.journal.status, 'passed')
  assert.deepEqual(result.journal.entries[0].verification, {
    checkCodes: ['fixture.alpha', 'fixture.beta'],
    passedCount: 2
  })
})

for (const [scenario, expectedMessage] of [
  ['fail', /FAIL check\(s\): fixture\.beta/],
  ['missing', /missing expected check_code\(s\): fixture\.beta/],
  ['duplicate', /duplicate check_code: fixture\.alpha/],
  ['empty', /returned no result rows/],
  ['vanished', /returned no header or result rows/],
  ['missing-columns', /exactly one check_code column and one status column/],
  ['unexpected', /unexpected check_code\(s\): fixture\.gamma/]
]) {
  test(`verify rejects ${scenario} mysql output`, () => {
    const result = runFixture(scenario)

    assert.notEqual(result.status, 0, result.output)
    assert.match(result.output, expectedMessage)
    assert.equal(result.journal.status, 'failed')
  })
}

test('plan-only mode never starts even a configured mysql executable', () => {
  const result = runFixture('pass', {
    apply: false,
    mysqlBin: '/definitely-not-a-real-mysql-client'
  })

  assert.equal(result.status, 0, result.output)
  assert.match(result.stdout, /no database connection was opened/)
  assert.equal(result.journal, undefined)
})
