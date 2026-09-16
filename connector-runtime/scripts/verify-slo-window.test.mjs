import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VERIFY = join(ROOT, 'deploy/verify-slo-window.sh')
let fixture
let input

function snapshot({
  at,
  version = '0.4.8',
  runtimeId = 'connector-runtime.C000001-console',
  available = true,
  deliveries = { failed: 1, succeeded: 7 },
  peopleJobs,
  extra = {}
}) {
  return {
    event: 'connector_runtime_slo_snapshot',
    product: 'hzy-connector-runtime',
    version,
    runtimeId,
    tenant: 'C000001',
    deployment: 'C000001-console',
    collectedAt: at,
    available,
    databaseBytes: 65536,
    deliveries,
    ...(peopleJobs ? { peopleJobs } : {}),
    ...extra
  }
}

function writeSnapshots(items) {
  writeFileSync(input, items.map(item => (
    `2026-07-15 host runtime[1]: [connector-runtime] slo_snapshot ${JSON.stringify(item)}`
  )).join('\n') + '\n')
}

function run(extra = {}) {
  return spawnSync('bash', [VERIFY], {
    cwd: ROOT,
    env: {
      ...process.env,
      HZY_CONNECTOR_RUNTIME_SLO_INPUT_FILE: input,
      HZY_CONNECTOR_RUNTIME_SLO_RESTARTS: '0',
      HZY_CONNECTOR_RUNTIME_SLO_MIN_SNAPSHOTS: '4',
      HZY_CONNECTOR_RUNTIME_SLO_MIN_WINDOW_SECONDS: '900',
      ...extra
    },
    encoding: 'utf8'
  })
}

function output(result) {
  return `${result.stdout || ''}${result.stderr || ''}`
}

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'hzy-connector-runtime-slo-'))
  input = join(fixture, 'journal.log')
  chmodSync(VERIFY, 0o755)
})

after(() => rmSync(fixture, { recursive: true, force: true }))

test('verifies a redacted monotonic observation window', () => {
  writeSnapshots([
    snapshot({ at: '2026-07-15T04:00:00.123456789Z' }),
    snapshot({ at: '2026-07-15T04:05:00Z' }),
    snapshot({ at: '2026-07-15T04:10:00Z' }),
    snapshot({ at: '2026-07-15T04:15:00.123456789Z', version: '0.4.10', deliveries: { failed: 1, succeeded: 8 } })
  ])
  const result = run()
  assert.equal(result.status, 0, output(result))
  assert.match(result.stdout, /connector_runtime_slo_window_verified/)
  assert.match(result.stdout, /"snapshotCount":4/)
  assert.match(result.stdout, /"windowSeconds":900/)
  assert.match(result.stdout, /"version":\{"first":"0\.4\.8","last":"0\.4\.10"\}/)
  assert.match(result.stdout, /"deliveryTotal":\{"first":8,"last":9\}/)
  assert.doesNotMatch(result.stdout, /recipient|touser|secret|token|message/i)
})

test('rejects an unavailable snapshot or binding drift', () => {
  const base = [
    snapshot({ at: '2026-07-15T04:00:00Z' }),
    snapshot({ at: '2026-07-15T04:05:00Z' }),
    snapshot({ at: '2026-07-15T04:10:00Z' }),
    snapshot({ at: '2026-07-15T04:15:00Z', available: false })
  ]
  writeSnapshots(base)
  let result = run()
  assert.notEqual(result.status, 0)
  assert.match(output(result), /unavailable snapshot/)

  base[3] = snapshot({ at: '2026-07-15T04:15:00Z', runtimeId: 'connector-runtime.other' })
  writeSnapshots(base)
  result = run()
  assert.notEqual(result.status, 0)
  assert.match(output(result), /binding drift/)
})

test('rejects sensitive fields and a decreasing ledger total', () => {
  const base = [
    snapshot({ at: '2026-07-15T04:00:00Z', deliveries: { succeeded: 8 } }),
    snapshot({ at: '2026-07-15T04:05:00Z', deliveries: { succeeded: 8 } }),
    snapshot({ at: '2026-07-15T04:10:00Z', deliveries: { succeeded: 8 } }),
    snapshot({ at: '2026-07-15T04:15:00Z', deliveries: { succeeded: 7 } })
  ]
  writeSnapshots(base)
  let result = run()
  assert.notEqual(result.status, 0)
  assert.match(output(result), /ledger total decreased/)

  base[3] = snapshot({ at: '2026-07-15T04:15:00Z', extra: { recipient: 'must-not-leak' } })
  writeSnapshots(base)
  result = run()
  assert.notEqual(result.status, 0)
  assert.match(output(result), /outside the redacted schema/)
  assert.doesNotMatch(output(result), /must-not-leak/)
})

test('rejects a short window, too few snapshots, or excessive restarts', () => {
  writeSnapshots([
    snapshot({ at: '2026-07-15T04:00:00Z' }),
    snapshot({ at: '2026-07-15T04:01:00Z' }),
    snapshot({ at: '2026-07-15T04:02:00Z' }),
    snapshot({ at: '2026-07-15T04:03:00Z' })
  ])
  let result = run()
  assert.notEqual(result.status, 0)
  assert.match(output(result), /observation window is 180s/)

  result = run({ HZY_CONNECTOR_RUNTIME_SLO_MIN_SNAPSHOTS: '5', HZY_CONNECTOR_RUNTIME_SLO_MIN_WINDOW_SECONDS: '0' })
  assert.notEqual(result.status, 0)
  assert.match(output(result), /only 4 snapshots found/)

  result = run({ HZY_CONNECTOR_RUNTIME_SLO_RESTARTS: '1', HZY_CONNECTOR_RUNTIME_SLO_MAX_RESTARTS: '0' })
  assert.notEqual(result.status, 0)
  assert.match(output(result), /restart count 1 exceeds/)
})
