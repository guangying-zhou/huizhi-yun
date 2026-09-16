import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  REQUIRED_CUTOVER_CHECK_CODES,
  REQUIRED_ZERO_CUTOVER_METRICS,
  verifyCutoverGateObservation,
  verifyCurrentWorkerDeployment,
  verifyProductionConnectorObservation,
  verifyRuntimeHostObservation
} from './lib/console-zero-db-observation.mjs'

const observationStart = Date.parse('2026-07-19T23:15:50.641Z')

function runtimeHost(overrides = {}) {
  return {
    serviceEnabled: 'enabled',
    serviceState: 'active',
    activeSince: '2026-07-19T23:08:59.000Z',
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
    connectorLastHeartbeatAt: '2026-07-19T23:16:40.000Z',
    connectorHeartbeatAgeSeconds: 20,
    ...overrides
  }
}

const runtimeInput = {
  observationStartMs: observationStart,
  expectedRuntimeVersion: '0.3.133',
  expectedConnectorId: 'connector-runtime.C000001-console',
  expectedConnectorVersion: '0.4.22',
  maxConnectorHeartbeatAgeSeconds: 120
}

function cutoverGate() {
  return {
    status: 'ready',
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
}

describe('Console zero-DB observation gates', () => {
  test('fails evidence generation when required cutover checks or metrics are incomplete', () => {
    assert.equal(verifyCutoverGateObservation(cutoverGate()).status, 'ready')
    const missingCheck = cutoverGate()
    missingCheck.checks = missingCheck.checks.slice(1)
    assert.throws(
      () => verifyCutoverGateObservation(missingCheck),
      /must contain exactly one runtime_database_identity/
    )
    const downgradedMetric = cutoverGate()
    const pendingActionables = downgradedMetric.metrics
      .find(item => item.code === 'pending_user_actionables')
    pendingActionables.count = 1
    assert.throws(
      () => verifyCutoverGateObservation(downgradedMetric),
      /pending_user_actionables/
    )
  })

  test('requires the expected Worker to be the sole 100% deployment', () => {
    assert.deepEqual(
      verifyCurrentWorkerDeployment({
        id: 'deployment-1',
        created_on: '2026-07-19T23:07:44.684316Z',
        versions: [{ version_id: 'worker-236', percentage: 100 }]
      }, 'worker-236'),
      {
        deploymentId: 'deployment-1',
        deploymentCreatedOn: '2026-07-19T23:07:44.684316Z',
        trafficPercentage: 100
      }
    )
    assert.throws(
      () => verifyCurrentWorkerDeployment({
        id: 'deployment-1',
        created_on: '2026-07-19T23:07:44.684316Z',
        versions: [{ version_id: 'worker-228', percentage: 100 }]
      }, 'worker-236'),
      /not currently deployed/
    )
    assert.throws(
      () => verifyCurrentWorkerDeployment({
        id: 'deployment-1',
        created_on: '2026-07-19T23:07:44.684316Z',
        versions: [
          { version_id: 'worker-236', percentage: 90 },
          { version_id: 'worker-canary', percentage: 10 }
        ]
      }, 'worker-236'),
      /exactly one version/
    )
  })

  test('accepts a stable Runtime host with current updater and Connector heartbeat', () => {
    assert.equal(verifyRuntimeHostObservation(runtimeHost(), runtimeInput).serviceState, 'active')
  })

  test('rejects a Runtime restart hidden behind a zero systemd restart counter', () => {
    assert.throws(
      () => verifyRuntimeHostObservation(
        runtimeHost({ activeSince: '2026-07-19T23:15:51.000Z' }),
        runtimeInput
      ),
      /became active after observation start/
    )
  })

  test('rejects updater drift, failed updater units, stale heartbeat, and duplicate Connector', () => {
    assert.throws(
      () => verifyRuntimeHostObservation(runtimeHost({ updaterTargetVersion: '0.3.132' }), runtimeInput),
      /updater target mismatch/
    )
    assert.throws(
      () => verifyRuntimeHostObservation(runtimeHost({ updateServiceFailed: 'failed' }), runtimeInput),
      /failed systemd unit/
    )
    assert.throws(
      () => verifyRuntimeHostObservation(runtimeHost({ connectorHeartbeatAgeSeconds: 121 }), runtimeInput),
      /heartbeat is stale/
    )
    assert.throws(
      () => verifyRuntimeHostObservation(runtimeHost({
        duplicateConnectorEnabled: 'enabled',
        duplicateConnectorState: 'active'
      }), runtimeInput),
      /must remain disabled/
    )
  })

  test('requires the unique production Connector to predate the observation window', () => {
    const payload = {
      serviceEnabled: 'enabled',
      serviceState: 'active',
      activeSince: '2026-07-19T23:15:47.839Z',
      restartCount: 0,
      version: '0.4.22'
    }
    assert.equal(
      verifyProductionConnectorObservation(payload, {
        observationStartMs: observationStart,
        expectedVersion: '0.4.22'
      }).version,
      '0.4.22'
    )
    assert.throws(
      () => verifyProductionConnectorObservation(
        { ...payload, activeSince: '2026-07-19T23:15:51.000Z' },
        { observationStartMs: observationStart, expectedVersion: '0.4.22' }
      ),
      /became active after observation start/
    )
    assert.throws(
      () => verifyProductionConnectorObservation(
        { ...payload, serviceState: 'failed' },
        { observationStartMs: observationStart, expectedVersion: '0.4.22' }
      ),
      /not enabled\/active/
    )
  })
})
