import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runPlatformDatabaseCutover, platformDatabaseCutoverFailureMessage, sanitizeCutoverFailureReason } from '../platform-dev-db-cutover.mjs'

function fixture(failAt, healthy = true) {
  const events = [], started = []
  const db = { remote: ['before-cutover'], local: [], active: 'remote' }
  const step = name => async () => {
    events.push(name)
    if (name === failAt) throw Error('fixture_failure password=fixture-secret')
  }
  let failure
  const dependencies = {
    stopOriginal: async () => {
      await step('stop')()
      db.active = null
    },
    copyDatabase: async () => {
      await step('copy')()
      db.local = [...db.remote]
    },
    verifyDatabase: step('verify'),
    startCandidate: async () => {
      started.push('candidate.config.json')
      db.active = 'local'
      db.local.push('candidate-write')
      await step('start')()
    },
    waitForHealth: async () => {
      await step('health')()
      return true
    },
    probeCandidate: step('probe'),
    verifyCandidateProcess: step('process'),
    assertOthers: step('others'),
    writeReceipt: step('receipt'),
    reportSuccess: step('report'),
    restoreOriginal: async () => {
      events.push('restore')
      started.push('rollback.config.json')
      db.active = 'remote'
    },
    isCandidateHealthy: async () => {
      events.push('recheck')
      return healthy
    },
    stopCandidate: async () => {
      await step('freeze')()
      db.active = null
    },
    reportFailure: async result => { failure = result }
  }
  return { dependencies, events, started, db, get failure() { return failure } }
}

for (const stage of ['start', 'health', 'probe', 'process', 'others', 'receipt', 'report']) {
  test(`failure at ${stage} after candidate start never restores the remote database`, async () => {
    const f = fixture(stage)
    const result = await runPlatformDatabaseCutover(f.dependencies)
    assert.equal(result.success, false)
    assert.equal(result.stage, stage)
    assert.equal(result.candidateStartAttempted, true)
    const mayKeep = ['others', 'receipt', 'report'].includes(stage)
    assert.equal(result.recovery, mayKeep ? 'local_candidate_kept' : 'local_candidate_stopped')
    assert.equal(f.db.active, mayKeep ? 'local' : null)
    assert.deepEqual(f.db.local, ['before-cutover', 'candidate-write'])
    assert.deepEqual(f.db.remote, ['before-cutover'])
    assert.deepEqual(f.started, ['candidate.config.json'])
    assert.ok(!f.events.includes('restore'))
    assert.equal(f.events.includes('freeze'), !mayKeep)
    assert.equal(f.events.includes('recheck'), mayKeep)
    assert.deepEqual(f.failure, result)
    const message = platformDatabaseCutoverFailureMessage(result)
    assert.match(message, /fence all writers, reverse catch-up/)
    assert.match(message, /local database remains authoritative/)
    assert.match(message, /fixture_failure/)
    assert.ok(!message.includes('fixture-secret'))
    assert.match(message, /startup\/resurrect/)
  })
}

for (const stage of ['stop', 'copy', 'verify']) {
  test(`failure at ${stage} before candidate start can restore the verified original entry`, async () => {
    const f = fixture(stage)
    const result = await runPlatformDatabaseCutover(f.dependencies)
    assert.equal(result.candidateStartAttempted, false)
    assert.equal(result.recovery, 'original_restored')
    assert.deepEqual(f.started, ['rollback.config.json'])
    assert.ok(!f.events.includes('recheck'))
  })
}

test('unhealthy or unknown candidate is frozen without a remote restart', async () => {
  for (const unknown of [false, true]) {
    const f = fixture('receipt', false)
    if (unknown) f.dependencies.isCandidateHealthy = async () => { throw Error('health unavailable') }
    const result = await runPlatformDatabaseCutover(f.dependencies)
    assert.equal(result.recovery, 'local_candidate_stopped')
    assert.ok(f.events.includes('freeze'))
    assert.deepEqual(f.started, ['candidate.config.json'])
  }
})

test('a failed candidate stop is reported and never triggers a remote fallback', async () => {
  const f = fixture('receipt', false)
  f.dependencies.stopCandidate = async () => { throw Error('PM2 unavailable') }
  const result = await runPlatformDatabaseCutover(f.dependencies)
  assert.equal(result.recovery, 'local_candidate_stop_failed')
  assert.deepEqual(f.started, ['candidate.config.json'])
})

test('successful cutover verifies DB and process before writing its receipt', async () => {
  const f = fixture()
  const result = await runPlatformDatabaseCutover(f.dependencies)
  assert.equal(result.success, true)
  assert.deepEqual(f.events, ['stop', 'copy', 'verify', 'start', 'health', 'probe', 'process', 'others', 'receipt', 'report'])
  assert.deepEqual(f.started, ['candidate.config.json'])
})

test('CLI uses the guarded orchestration, exits nonzero on failure, and keeps explicit rollback refused', () => {
  const source = readFileSync('deploy/test-env/platform-dev-db-localize.mjs', 'utf8')
  assert.match(source, /await runPlatformDatabaseCutover\(/)
  assert.match(source, /if \(!result\.success\) process\.exitCode = 1/)
  assert.match(source, /stopCandidate: \(\) => pm\(\['stop', name\]\)/)
  assert.match(source, /throw Error\('Rollback refused:/)
  assert.equal((source.match(/pm\(\['start', path\.join\(attempt, 'rollback\.config\.json'\)/g) || []).length, 1)
  const restore = source.slice(source.indexOf('restoreOriginal: () => {'), source.indexOf('isCandidateHealthy:'))
  assert.match(restore, /rollback\.config\.json/)
})

test('health timeout always freezes the candidate even when a fresh health check would recover', async () => {
  for (const recovered of [false, true]) {
    const f = fixture(undefined, recovered)
    f.dependencies.waitForHealth = async () => false
    const result = await runPlatformDatabaseCutover(f.dependencies)
    assert.equal(result.stage, 'health')
    assert.equal(result.recovery, 'local_candidate_stopped')
    assert.equal(f.db.active, null)
    assert.deepEqual(f.db.local, ['before-cutover', 'candidate-write'])
    assert.deepEqual(f.started, ['candidate.config.json'])
  }
})

test('failure reasons retain diagnostics, redact known credentials before truncating and omit control characters', () => {
  assert.equal(sanitizeCutoverFailureReason(Error('connection refused')), 'connection refused')
  const secret = 'fixture-private-value'
  const reason = sanitizeCutoverFailureReason(Error(`failed ${secret} token=another-secret Bearer bearer-secret https://user:pass@example.test\nend`), [secret])
  for (const value of [secret, 'another-secret', 'bearer-secret', 'user:pass', '\n']) assert.ok(!reason.includes(value))
  assert.equal(sanitizeCutoverFailureReason(Error('x'.repeat(250) + ' end')).length <= 200, true)
})
