import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, test } from 'node:test'
import {
  REQUIRED_CUTOVER_CHECK_CODES,
  REQUIRED_ZERO_CUTOVER_METRICS,
  verifyAcceptanceSnapshot,
  verifyBackupRetention,
  verifyBaselineObservation,
  verifyFinalObservation,
  verifyOperationalSummary
} from './lib/console-zero-db-finalization.mjs'

const start = '2026-07-19T23:15:50.641Z'
const close = '2026-07-22T23:15:50.641Z'
const expected = {
  tenantCode: 'C000001',
  environment: 'prod',
  observationStart: start,
  notBeforeClose: close,
  runtimeVersion: '0.3.133',
  schemaRevision: 'sha256:3f65861f15afa34691b4f9751751f984afd2f82716dc876203f19133843fbcc3',
  workerVersionId: 'worker-236',
  workerVersionNumber: 236,
  workerBindingCount: 44,
  connectorId: 'connector-runtime.C000001-console',
  connectorVersion: '0.4.22',
  maxConnectorHeartbeatAgeSeconds: 120,
  baselineObservationFile: 'baseline.json',
  baselineObservationSha256: 'a'.repeat(64),
  finalObservationFile: 'final.json',
  finalObservationSha256: 'b'.repeat(64),
  finalObservationObservedAt: '2026-07-22T23:16:00.000Z'
}

function sha256(raw) {
  return createHash('sha256').update(raw).digest('hex')
}

function writeProtectedJSON(path, payload) {
  const raw = `${JSON.stringify(payload, null, 2)}\n`
  writeFileSync(path, raw, { encoding: 'utf8', mode: 0o600 })
  chmodSync(path, 0o600)
  return { path, raw, sha256: sha256(raw) }
}

function approvedException(scope) {
  return {
    identity: 'test-change-authority',
    role: 'change_authority',
    decision: 'exception_approved',
    signedAt: '2020-01-01T00:00:00.000Z',
    approvalReference: 'test:console-zero-db-finalization',
    reason: 'Hermetic test fixture records an explicit approved process exception.',
    scope: `${scope} test ceremony only; all technical gates remain mandatory.`,
    riskAcceptance: 'The test change authority accepts only the reduced ceremony in this fixture.',
    statement: 'This test fixture explicitly approves the process exception without impersonation.'
  }
}

function completeAcceptance() {
  const digest = `sha256:${'d'.repeat(64)}`
  return {
    schemaVersion: 2,
    evidenceType: 'console-cutover-human-acceptance',
    tenantCode: 'C000001',
    environment: 'prod',
    generatedAt: '2020-01-01T00:00:00.000Z',
    secretsIncluded: false,
    supersedes: { file: 'acceptance-v1.json', sha256: digest },
    technicalBaseline: {
      t0RuntimeVersion: '0.3.129',
      t0WorkerVersionId: 'worker-216',
      t0WorkerVersionNumber: 216,
      currentRuntimeVersion: '0.3.133',
      currentWorkerVersionId: 'worker-236',
      currentWorkerVersionNumber: 236,
      runtimeSchemaRevision: expected.schemaRevision,
      ctr812EvidenceSha256: digest,
      latestObservationSha256: digest
    },
    completedTechnicalItems: ['CTR-812', 'CTR-823'].map(taskId => ({
      taskId,
      status: 'passed',
      evidenceSha256: digest
    })),
    humanTasks: [
      {
        taskId: 'CTR-801',
        status: 'exception_approved',
        freezeRecord: { schemaRevision: expected.schemaRevision },
        witness: { role: 'change_owner' },
        approvedException: approvedException('CTR-801')
      },
      {
        taskId: 'CTR-816',
        status: 'exception_approved',
        signoffs: [
          'runtime_owner',
          'console_owner',
          'dba_security',
          'business_acceptance'
        ].map(role => ({ role })),
        approvedException: approvedException('CTR-816')
      }
    ],
    allHumanAcceptanceComplete: true
  }
}

function finalObservation(overrides = {}) {
  return {
    schemaVersion: 1,
    evidenceType: 'console-zero-db-observation',
    observedAt: '2026-07-22T23:16:00.000Z',
    observationWindow: {
      startedAt: start,
      notBeforeCloseAt: close,
      requiredHours: 72,
      status: 'eligible_for_close_review'
    },
    verdict: { checksPassed: true, eligibleToClose: true },
    runtime: {
      health: { version: '0.3.133' },
      cutover: {
        status: 'ready',
        schemaRevision: expected.schemaRevision,
        blockers: [],
        checks: REQUIRED_CUTOVER_CHECK_CODES.map(code => ({
          code,
          status: 'pass',
          violations: 0
        })),
        metrics: REQUIRED_ZERO_CUTOVER_METRICS.map(metric => ({
          ...metric,
          count: 0
        }))
      }
    },
    worker: {
      versionId: 'worker-236',
      versionNumber: 236,
      bindingCount: 44,
      forbiddenBindings: [],
      deploymentId: 'deployment-1',
      trafficPercentage: 100
    },
    host: {
      serviceEnabled: 'enabled',
      serviceState: 'active',
      activeSince: '2026-07-19T23:08:58.000Z',
      restartCount: 0,
      warningsSinceObservationStart: 0,
      updateTimerEnabled: 'enabled',
      updateTimerState: 'active',
      updateRequestPathEnabled: 'enabled',
      updateRequestPathState: 'active',
      updateServiceFailed: 'inactive',
      updateRequestServiceFailed: 'inactive',
      updaterTargetVersion: '0.3.133',
      legacyConsolePrivilegeCount: 0,
      runtimeConsolePrivilegeCount: 5,
      platformConsolePrivilegeCount: 0,
      duplicateConnectorEnabled: 'disabled',
      duplicateConnectorState: 'inactive',
      connectorId: 'connector-runtime.C000001-console',
      connectorStatus: 'active',
      connectorVersion: '0.4.22',
      connectorHeartbeatAgeSeconds: 30
    },
    connector: {
      serviceEnabled: 'enabled',
      serviceState: 'active',
      activeSince: '2026-07-19T23:15:46.000Z',
      restartCount: 0,
      version: '0.4.22'
    },
    secretsIncluded: false,
    ...overrides
  }
}

function operationalSummary(overrides = {}) {
  return {
    schemaVersion: 1,
    evidenceType: 'console-zero-db-operational-summary',
    generatedAt: '2026-07-22T23:17:00.000Z',
    tenantCode: 'C000001',
    environment: 'prod',
    window: { startedAt: start, endedAt: '2026-07-22T23:16:00.000Z' },
    disposition: {
      blockerEvents: 0,
      crossTenantAlerts: 0,
      secretAlerts: 0,
      rollbackEvents: 0,
      errorBudgetBreaches: 0,
      connectorHeartbeatIncidents: 0,
      conclusion: 'pass'
    },
    observationEvidence: [
      { file: 'baseline.json', sha256: 'a'.repeat(64) },
      { file: 'checkpoint.json', sha256: 'c'.repeat(64) },
      { file: 'final.json', sha256: 'b'.repeat(64) }
    ],
    secretsIncluded: false,
    ...overrides
  }
}

describe('Console zero-DB finalization gates', () => {
  test('accepts only a passing in-window baseline on the final anchors', () => {
    const result = verifyBaselineObservation(
      finalObservation({
        observedAt: '2026-07-19T23:24:30.000Z',
        observationWindow: {
          startedAt: start,
          notBeforeCloseAt: close,
          requiredHours: 72,
          status: 'in_progress'
        },
        verdict: { checksPassed: true, eligibleToClose: false }
      }),
      expected
    )
    assert.equal(result.observedAt, '2026-07-19T23:24:30.000Z')
    assert.throws(
      () => verifyBaselineObservation(
        finalObservation({
          observedAt: '2026-07-19T23:24:30.000Z',
          observationWindow: {
            startedAt: start,
            notBeforeCloseAt: close,
            requiredHours: 72,
            status: 'in_progress'
          },
          verdict: { checksPassed: true, eligibleToClose: false },
          worker: { ...finalObservation().worker, versionId: 'worker-228' }
        }),
        expected
      ),
      /anchor is invalid/
    )
  })

  test('accepts a complete post-window final observation', () => {
    const result = verifyFinalObservation(
      finalObservation(),
      expected,
      Date.parse('2026-07-22T23:17:00.000Z')
    )
    assert.equal(result.elapsedHours > 72, true)
  })

  test('rejects early or ineligible observations and non-current Worker evidence', () => {
    assert.throws(
      () => verifyFinalObservation(
        finalObservation({
          observedAt: '2026-07-19T23:24:43.387Z',
          observationWindow: {
            startedAt: start,
            notBeforeCloseAt: close,
            requiredHours: 72,
            status: 'in_progress'
          },
          verdict: { checksPassed: true, eligibleToClose: false }
        }),
        expected,
        Date.parse('2026-07-19T23:24:43.387Z')
      ),
      /has not completed/
    )
    assert.throws(
      () => verifyFinalObservation(
        finalObservation({
          worker: { ...finalObservation().worker, versionId: 'worker-228' }
        }),
        expected,
        Date.parse('2026-07-22T23:17:00.000Z')
      ),
      /anchor is invalid/
    )
  })

  test('rejects missing, duplicated, or downgraded cutover evidence', () => {
    const missingCheck = finalObservation()
    missingCheck.runtime.cutover.checks = missingCheck.runtime.cutover.checks.slice(1)
    assert.throws(
      () => verifyFinalObservation(
        missingCheck,
        expected,
        Date.parse('2026-07-22T23:17:00.000Z')
      ),
      /must contain exactly one runtime_database_identity/
    )

    const duplicateMetric = finalObservation()
    duplicateMetric.runtime.cutover.metrics.push({
      ...duplicateMetric.runtime.cutover.metrics[0]
    })
    assert.throws(
      () => verifyFinalObservation(
        duplicateMetric,
        expected,
        Date.parse('2026-07-22T23:17:00.000Z')
      ),
      /must contain exactly one unfinished_integration_operations/
    )

    const downgradedActionable = finalObservation()
    const actionable = downgradedActionable.runtime.cutover.metrics
      .find(item => item.code === 'pending_user_actionables')
    actionable.count = 1
    assert.throws(
      () => verifyFinalObservation(
        downgradedActionable,
        expected,
        Date.parse('2026-07-22T23:17:00.000Z')
      ),
      /required Runtime cutover metric is not clear: pending_user_actionables/
    )
  })

  test('requires a complete zero-incident operational summary', () => {
    assert.equal(verifyOperationalSummary(operationalSummary(), expected).evidenceCount, 3)
    assert.throws(
      () => verifyOperationalSummary(
        operationalSummary({
          disposition: {
            ...operationalSummary().disposition,
            errorBudgetBreaches: 1
          }
        }),
        expected
      ),
      /errorBudgetBreaches must be zero/
    )
    assert.throws(
      () => verifyOperationalSummary(
        operationalSummary({
          observationEvidence: [
            { file: 'baseline.json', sha256: 'a'.repeat(64) },
            { file: 'checkpoint.json', sha256: 'c'.repeat(64) },
            { file: 'final.json', sha256: 'd'.repeat(64) }
          ]
        }),
        expected
      ),
      /final observation SHA-256 mismatch/
    )
    assert.throws(
      () => verifyOperationalSummary(
        operationalSummary({
          window: {
            startedAt: start,
            endedAt: '2026-07-22T23:15:55.000Z'
          }
        }),
        expected
      ),
      /does not cover the complete observation window/
    )
    assert.throws(
      () => verifyOperationalSummary(
        operationalSummary({
          observationEvidence: [
            { file: 'baseline.json', sha256: 'a'.repeat(64) },
            { file: 'baseline.json', sha256: 'a'.repeat(64) },
            { file: 'final.json', sha256: 'b'.repeat(64) }
          ]
        }),
        expected
      ),
      /duplicate evidence file/
    )
  })

  test('requires 90-day encrypted backup retention with destruction guardrails', () => {
    const payload = {
      schemaVersion: 1,
      evidenceType: 'console-cutover-backup-retention',
      registeredAt: '2026-07-18T13:32:00Z',
      tenantCode: 'C000001',
      backup: {
        encrypted: true,
        plaintextStored: false,
        storageMode: '0600',
        sizeBytes: 12,
        ciphertextSha256: 'c'.repeat(64)
      },
      retention: {
        minimumRetentionDays: 90,
        retainUntil: '2026-10-16T20:40:20.525Z',
        automaticDeletionAllowed: false,
        destructionRequiresExplicitOwnerApproval: true,
        destructionRequiresObservationClosed: true,
        destructionRequiresNoOpenIncidentOrRollbackHold: true
      },
      secretsIncluded: false
    }
    assert.equal(
      verifyBackupRetention(
        payload,
        { tenantCode: 'C000001', finalizedAtMs: Date.parse('2026-07-22T23:17:00Z') },
        { sizeBytes: 12, sha256: 'c'.repeat(64) }
      ).minimumRetentionDays,
      90
    )
    assert.throws(
      () => verifyBackupRetention(
        {
          ...payload,
          retention: { ...payload.retention, automaticDeletionAllowed: true }
        },
        { tenantCode: 'C000001', finalizedAtMs: Date.parse('2026-07-22T23:17:00Z') },
        { sizeBytes: 12, sha256: 'c'.repeat(64) }
      ),
      /guardrails are incomplete/
    )
  })

  test('requires the recorded CTR-801/816 approved exceptions', () => {
    const payload = {
      schemaVersion: 2,
      evidenceType: 'console-cutover-human-acceptance',
      tenantCode: 'C000001',
      environment: 'prod',
      secretsIncluded: false,
      allHumanAcceptanceComplete: true,
      humanTasks: ['CTR-801', 'CTR-816'].map(taskId => ({
        taskId,
        status: 'exception_approved',
        approvedException: { decision: 'exception_approved', role: 'change_authority' }
      }))
    }
    assert.equal(verifyAcceptanceSnapshot(payload, expected).ctr816, 'exception_approved')
    assert.throws(
      () => verifyAcceptanceSnapshot({
        ...payload,
        humanTasks: [
          payload.humanTasks[0],
          { ...payload.humanTasks[1], status: 'approved' }
        ]
      }, expected),
      /CTR-816 approved exception is missing/
    )
  })

  test('creates one protected closure report through the complete CLI evidence chain', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hzy-console-finalization-'))
    try {
      const integrationStart = '2020-01-01T00:00:00.000Z'
      const integrationClose = '2020-01-04T00:00:00.000Z'
      const baselinePayload = finalObservation({
        observedAt: '2020-01-01T00:10:00.000Z',
        observationWindow: {
          startedAt: integrationStart,
          notBeforeCloseAt: integrationClose,
          requiredHours: 72,
          status: 'in_progress'
        },
        verdict: { checksPassed: true, eligibleToClose: false }
      })
      baselinePayload.host.activeSince = '2019-12-31T23:00:00.000Z'
      baselinePayload.connector.activeSince = '2019-12-31T23:30:00.000Z'
      const checkpointPayload = finalObservation({
        observedAt: '2020-01-02T12:00:00.000Z',
        observationWindow: {
          startedAt: integrationStart,
          notBeforeCloseAt: integrationClose,
          requiredHours: 72,
          status: 'in_progress'
        },
        verdict: { checksPassed: true, eligibleToClose: false }
      })
      checkpointPayload.host.activeSince = '2019-12-31T23:00:00.000Z'
      checkpointPayload.connector.activeSince = '2019-12-31T23:30:00.000Z'
      const finalPayload = finalObservation({
        observedAt: '2020-01-04T00:01:00.000Z',
        observationWindow: {
          startedAt: integrationStart,
          notBeforeCloseAt: integrationClose,
          requiredHours: 72,
          status: 'eligible_for_close_review'
        }
      })
      finalPayload.host.activeSince = '2019-12-31T23:00:00.000Z'
      finalPayload.connector.activeSince = '2019-12-31T23:30:00.000Z'

      const baseline = writeProtectedJSON(join(directory, 'baseline.json'), baselinePayload)
      const checkpoint = writeProtectedJSON(
        join(directory, 'checkpoint.json'),
        checkpointPayload
      )
      const final = writeProtectedJSON(join(directory, 'final.json'), finalPayload)
      const summary = writeProtectedJSON(join(directory, 'operational-summary.json'), {
        schemaVersion: 1,
        evidenceType: 'console-zero-db-operational-summary',
        generatedAt: '2020-01-04T00:02:00.000Z',
        tenantCode: 'C000001',
        environment: 'prod',
        window: {
          startedAt: integrationStart,
          endedAt: '2020-01-04T00:01:00.000Z'
        },
        disposition: {
          blockerEvents: 0,
          crossTenantAlerts: 0,
          secretAlerts: 0,
          rollbackEvents: 0,
          errorBudgetBreaches: 0,
          connectorHeartbeatIncidents: 0,
          conclusion: 'pass'
        },
        observationEvidence: [
          { file: 'baseline.json', sha256: baseline.sha256 },
          { file: 'checkpoint.json', sha256: checkpoint.sha256 },
          { file: 'final.json', sha256: final.sha256 }
        ],
        secretsIncluded: false
      })
      const acceptance = writeProtectedJSON(
        join(directory, 'acceptance.json'),
        completeAcceptance()
      )
      const backupPath = join(directory, 'backup.enc')
      const backupRaw = Buffer.from('encrypted-test-backup-fixture')
      writeFileSync(backupPath, backupRaw, { mode: 0o600 })
      chmodSync(backupPath, 0o600)
      const backup = writeProtectedJSON(join(directory, 'backup-retention.json'), {
        schemaVersion: 1,
        evidenceType: 'console-cutover-backup-retention',
        registeredAt: '2020-01-01T00:00:00.000Z',
        tenantCode: 'C000001',
        backup: {
          file: 'backup.enc',
          encrypted: true,
          plaintextStored: false,
          storageMode: '0600',
          sizeBytes: backupRaw.length,
          ciphertextSha256: sha256(backupRaw)
        },
        retention: {
          minimumRetentionDays: 90,
          retainUntil: '2099-01-01T00:00:00.000Z',
          automaticDeletionAllowed: false,
          destructionRequiresExplicitOwnerApproval: true,
          destructionRequiresObservationClosed: true,
          destructionRequiresNoOpenIncidentOrRollbackHold: true
        },
        secretsIncluded: false
      })
      const outputPath = join(directory, 'closure.json')
      const finalizerArgs = [
        resolve(import.meta.dirname, 'finalize-console-zero-db-cutover.mjs'),
        '--baseline-observation-file', baseline.path,
        '--baseline-observation-sha256', baseline.sha256,
        '--observation-file', final.path,
        '--observation-sha256', final.sha256,
        '--operational-summary-file', summary.path,
        '--operational-summary-sha256', summary.sha256,
        '--acceptance-file', acceptance.path,
        '--acceptance-sha256', acceptance.sha256,
        '--backup-retention-file', backup.path,
        '--backup-retention-sha256', backup.sha256,
        '--expected-observation-start', integrationStart,
        '--expected-not-before-close', integrationClose,
        '--expected-runtime-version', '0.3.133',
        '--expected-schema-revision', expected.schemaRevision,
        '--expected-worker-version-id', 'worker-236',
        '--expected-worker-version-number', '236',
        '--expected-worker-binding-count', '44',
        '--expected-connector-id', 'connector-runtime.C000001-console',
        '--expected-connector-version', '0.4.22',
        '--output-file', outputPath
      ]
      const result = spawnSync(
        process.execPath,
        finalizerArgs,
        { encoding: 'utf8' }
      )
      assert.equal(result.status, 0, result.stderr || result.stdout)
      assert.equal(statSync(outputPath).mode & 0o077, 0)
      const closure = JSON.parse(readFileSync(outputPath, 'utf8'))
      assert.deepEqual(closure.completedTasks, ['CTR-834', 'CTR-835'])
      assert.equal(closure.baselineObservation.sha256, baseline.sha256)
      assert.equal(closure.observation.sha256, final.sha256)
      assert.equal(closure.operationalSummary.sha256, summary.sha256)
      assert.equal(closure.operationalSummary.observationEvidence.length, 3)
      assert.equal(
        closure.operationalSummary.observationEvidence[1].role,
        'intermediate'
      )
      assert.equal(closure.verdict.eligibleToClose, true)

      writeProtectedJSON(checkpoint.path, {
        ...checkpointPayload,
        worker: { ...checkpointPayload.worker, deploymentId: 'tampered-deployment' }
      })
      const rejectedOutputPath = join(directory, 'rejected-closure.json')
      const rejectedArgs = [...finalizerArgs]
      rejectedArgs[rejectedArgs.length - 1] = rejectedOutputPath
      const rejected = spawnSync(process.execPath, rejectedArgs, { encoding: 'utf8' })
      assert.notEqual(rejected.status, 0)
      assert.match(rejected.stderr, /intermediate observation checkpoint\.json SHA-256 mismatch/)
      assert.equal(existsSync(rejectedOutputPath), false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
