import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const script = resolve(root, 'scripts/validate-console-cutover-human-acceptance.mjs')
const digest = `sha256:${'a'.repeat(64)}`

function fixture() {
  return {
    schemaVersion: 2,
    evidenceType: 'console-cutover-human-acceptance',
    tenantCode: 'C000001',
    environment: 'prod',
    generatedAt: '2026-07-18T17:55:10.221Z',
    supersedes: { file: 'pending.json', sha256: digest },
    technicalBaseline: {
      t0RuntimeVersion: '0.3.129',
      t0WorkerVersionId: 'worker-t0',
      t0WorkerVersionNumber: 216,
      currentRuntimeVersion: '0.3.131',
      currentWorkerVersionId: 'worker-current',
      currentWorkerVersionNumber: 222,
      runtimeSchemaRevision: digest,
      ctr812EvidenceSha256: digest,
      latestObservationSha256: digest
    },
    completedTechnicalItems: [
      { taskId: 'CTR-812', status: 'passed', evidenceSha256: digest },
      { taskId: 'CTR-823', status: 'passed', evidenceSha256: digest }
    ],
    humanTasks: [
      {
        taskId: 'CTR-801',
        status: 'pending',
        freezeRecord: {
          startedAt: null,
          endedAt: null,
          releaseIdentifier: null,
          schemaRevision: digest,
          bundleHash: null,
          responsibleOwner: null
        },
        witness: {
          identity: null,
          role: 'change_owner',
          decision: null,
          signedAt: null,
          approvalReference: null,
          statement: null
        }
      },
      {
        taskId: 'CTR-816',
        status: 'pending',
        signoffs: ['runtime_owner', 'console_owner', 'dba_security', 'business_acceptance']
          .map(role => ({
            identity: null,
            role,
            decision: null,
            signedAt: null,
            approvalReference: null,
            noUnacceptedBlockers: null,
            statement: null
          }))
      }
    ],
    allHumanAcceptanceComplete: false,
    secretsIncluded: false
  }
}

function run(payload, ...extra) {
  const directory = mkdtempSync(resolve(tmpdir(), 'hzy-human-acceptance-test-'))
  const file = resolve(directory, 'acceptance.json')
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  return spawnSync(process.execPath, [script, '--file', file, ...extra], {
    cwd: root,
    encoding: 'utf8'
  })
}

test('accepts a structurally valid pending checklist only with --allow-pending', () => {
  const pending = fixture()
  const allowed = run(pending, '--allow-pending')
  assert.equal(allowed.status, 0, allowed.stderr)
  assert.deepEqual(JSON.parse(allowed.stdout).pending, ['CTR-801', 'CTR-816'])

  const strict = run(pending)
  assert.equal(strict.status, 1)
  assert.match(strict.stderr, /CTR-801 is not approved/)
})

test('accepts a complete four-party approval record', () => {
  const complete = fixture()
  const approval = role => ({
    identity: `${role}@example.test`,
    role,
    decision: 'approved',
    signedAt: '2026-07-18T18:00:00.000Z',
    approvalReference: `CHG-2026-${role}`,
    noUnacceptedBlockers: true,
    statement: `I approve the Console cutover as ${role} with no unaccepted blockers.`
  })
  complete.humanTasks[0] = {
    taskId: 'CTR-801',
    status: 'approved',
    freezeRecord: {
      startedAt: '2026-07-18T12:50:00.000Z',
      endedAt: '2026-07-18T13:10:00.000Z',
      releaseIdentifier: 'runtime-0.3.129/worker-216',
      schemaRevision: digest,
      bundleHash: digest,
      responsibleOwner: 'change-owner@example.test'
    },
    witness: approval('change_owner')
  }
  complete.humanTasks[1].status = 'approved'
  complete.humanTasks[1].signoffs = complete.humanTasks[1].signoffs.map(item => approval(item.role))
  complete.allHumanAcceptanceComplete = true

  const result = run(complete)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).complete, true)
})

test('accepts an explicit trial-operation exception from the change authority', () => {
  const complete = fixture()
  const exception = taskId => ({
    identity: 'thread-owner',
    role: 'change_authority',
    decision: 'exception_approved',
    signedAt: '2026-07-18T19:41:43.422Z',
    approvalReference: 'codex-thread:example',
    reason: 'The system is operating in an explicitly authorized trial period.',
    scope: `${taskId} human gate for the Console zero-direct-DB migration`,
    riskAcceptance: 'The change authority accepts the reduced human-approval ceremony while retaining technical gates.',
    statement: `I authorize the migration to proceed and approve the ${taskId} trial-operation exception.`
  })
  for (const task of complete.humanTasks) {
    task.status = 'exception_approved'
    task.approvedException = exception(task.taskId)
  }
  complete.allHumanAcceptanceComplete = true

  const result = run(complete)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).complete, true)
})

test('rejects incomplete role approval and embedded secret material', () => {
  const missingRole = fixture()
  missingRole.humanTasks[1].signoffs.pop()
  const pending = run(missingRole, '--allow-pending')
  assert.equal(pending.status, 1)
  assert.match(pending.stderr, /business_acceptance/)

  const withSecret = fixture()
  withSecret.note = `Bearer ${'x'.repeat(24)}`
  const rejected = run(withSecret, '--allow-pending')
  assert.equal(rejected.status, 1)
  assert.match(rejected.stderr, /forbidden secret material/)
})
