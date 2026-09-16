function requiredString(value, label) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`${label} is missing`)
  return normalized
}

function requiredNumber(value, label) {
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) throw new Error(`${label} is invalid`)
  return normalized
}

export const REQUIRED_CUTOVER_CHECK_CODES = Object.freeze([
  'runtime_database_identity',
  'runtime_database_global_privileges',
  'runtime_database_schema_privileges',
  'tenant_profile_binding',
  'runtime_data_binding',
  'vault_current_version_integrity',
  'integration_credential_integrity',
  'service_client_credential_integrity',
  'oidc_current_signing_key',
  'stale_mutation_receipts',
  'stale_service_command_receipts',
  'stuck_integration_operations',
  'stale_lifecycle_actionables',
  'directory_primary_department_integrity',
  'directory_subject_export_completeness'
])

export const REQUIRED_ZERO_CUTOVER_METRICS = Object.freeze([
  { code: 'unfinished_integration_operations', reviewRequired: true },
  { code: 'failed_integration_operations', reviewRequired: true },
  { code: 'pending_notification_deliveries', reviewRequired: true },
  { code: 'failed_notification_deliveries', reviewRequired: true },
  { code: 'incomplete_directory_sync_jobs', reviewRequired: true },
  { code: 'pending_user_actionables', reviewRequired: false }
])

function exactlyOneByCode(items, code, label) {
  const matches = items.filter(item => item?.code === code)
  if (matches.length !== 1) {
    throw new Error(`${label} must contain exactly one ${code}`)
  }
  return matches[0]
}

function isZeroInteger(value) {
  return Number.isSafeInteger(value) && value === 0
}

export function verifyCutoverGateObservation(payload) {
  if (payload?.status !== 'ready') throw new Error('Runtime cutover status is not ready')
  if (!Array.isArray(payload?.blockers) || payload.blockers.length !== 0) {
    throw new Error('Runtime cutover blockers are not empty')
  }

  const checks = Array.isArray(payload?.checks) ? payload.checks : []
  for (const code of REQUIRED_CUTOVER_CHECK_CODES) {
    const check = exactlyOneByCode(checks, code, 'Runtime cutover checks')
    if (check?.status !== 'pass' || !isZeroInteger(check?.violations)) {
      throw new Error(`required Runtime cutover check is not clear: ${code}`)
    }
  }
  if (checks.some(item => item?.status !== 'pass' || !isZeroInteger(item?.violations))) {
    throw new Error('Runtime cutover checks are not all passing')
  }

  const metrics = Array.isArray(payload?.metrics) ? payload.metrics : []
  for (const expectedMetric of REQUIRED_ZERO_CUTOVER_METRICS) {
    const metric = exactlyOneByCode(metrics, expectedMetric.code, 'Runtime cutover metrics')
    if (metric?.reviewRequired !== expectedMetric.reviewRequired ||
        !isZeroInteger(metric?.count)) {
      throw new Error(`required Runtime cutover metric is not clear: ${expectedMetric.code}`)
    }
  }
  if (metrics.some(item => item?.reviewRequired === true && !isZeroInteger(item?.count))) {
    throw new Error('review-required Runtime metrics are not clear')
  }
  return payload
}

export function verifyCurrentWorkerDeployment(payload, expectedVersionId) {
  const versions = Array.isArray(payload?.versions) ? payload.versions : []
  if (versions.length !== 1) {
    throw new Error(`Worker deployment must contain exactly one version, got ${versions.length}`)
  }
  const current = versions[0]
  const versionId = requiredString(current?.version_id, 'Worker deployed version')
  const percentage = requiredNumber(current?.percentage, 'Worker traffic percentage')
  if (versionId !== expectedVersionId) {
    throw new Error(`Worker is not currently deployed: expected ${expectedVersionId}, got ${versionId}`)
  }
  if (percentage !== 100) {
    throw new Error(`Worker version must receive 100% traffic, got ${percentage}`)
  }
  return {
    deploymentId: requiredString(payload?.id, 'Worker deployment ID'),
    deploymentCreatedOn: requiredString(payload?.created_on, 'Worker deployment timestamp'),
    trafficPercentage: percentage
  }
}

export function verifyRuntimeHostObservation(payload, input) {
  if (payload.serviceEnabled !== 'enabled' || payload.serviceState !== 'active') {
    throw new Error(`Runtime service is not enabled/active: ${payload.serviceEnabled}/${payload.serviceState}`)
  }
  if (payload.restartCount !== 0) {
    throw new Error(`Runtime restarted during observation: ${String(payload.restartCount)}`)
  }
  const activeSinceMs = Date.parse(requiredString(payload.activeSince, 'Runtime active timestamp'))
  if (!Number.isFinite(activeSinceMs) || activeSinceMs > input.observationStartMs) {
    throw new Error(`Runtime became active after observation start: ${String(payload.activeSince)}`)
  }
  if (payload.warningsSinceObservationStart !== 0) {
    throw new Error(`Runtime warning log count is non-zero: ${String(payload.warningsSinceObservationStart)}`)
  }
  if (payload.updateTimerEnabled !== 'enabled' || payload.updateTimerState !== 'active') {
    throw new Error(`Runtime update timer is not enabled/active: ${payload.updateTimerEnabled}/${payload.updateTimerState}`)
  }
  if (payload.updateRequestPathEnabled !== 'enabled' || payload.updateRequestPathState !== 'active') {
    throw new Error(`Runtime update request path is not enabled/active: ${payload.updateRequestPathEnabled}/${payload.updateRequestPathState}`)
  }
  if (payload.updateServiceFailed === 'failed' || payload.updateRequestServiceFailed === 'failed') {
    throw new Error('Runtime updater has a failed systemd unit')
  }
  if (payload.updaterTargetVersion !== input.expectedRuntimeVersion) {
    throw new Error(`Runtime updater target mismatch: expected ${input.expectedRuntimeVersion}, got ${String(payload.updaterTargetVersion)}`)
  }
  if (payload.legacyConsolePrivilegeCount !== 0 || payload.platformConsolePrivilegeCount !== 0) {
    throw new Error('legacy Console or Platform identity regained hzy_console privileges')
  }
  if (payload.runtimeConsolePrivilegeCount !== 5) {
    throw new Error(`Runtime Console privilege count must remain 5, got ${String(payload.runtimeConsolePrivilegeCount)}`)
  }
  if (payload.duplicateConnectorEnabled !== 'disabled' || payload.duplicateConnectorState !== 'inactive') {
    throw new Error(`duplicate Connector Runtime must remain disabled/inactive: ${payload.duplicateConnectorEnabled}/${payload.duplicateConnectorState}`)
  }
  if (payload.connectorId !== input.expectedConnectorId) {
    throw new Error(`Connector control-plane identity mismatch: expected ${input.expectedConnectorId}, got ${String(payload.connectorId)}`)
  }
  if (payload.connectorStatus !== 'active') {
    throw new Error(`Connector control-plane status is not active: ${String(payload.connectorStatus)}`)
  }
  if (payload.connectorVersion !== input.expectedConnectorVersion) {
    throw new Error(`Connector control-plane version mismatch: expected ${input.expectedConnectorVersion}, got ${String(payload.connectorVersion)}`)
  }
  const heartbeatAge = requiredNumber(payload.connectorHeartbeatAgeSeconds, 'Connector heartbeat age')
  if (heartbeatAge < 0 || heartbeatAge > input.maxConnectorHeartbeatAgeSeconds) {
    throw new Error(`Connector heartbeat is stale: ${heartbeatAge}s`)
  }
  return payload
}

export function verifyProductionConnectorObservation(payload, input) {
  if (payload.serviceEnabled !== 'enabled' || payload.serviceState !== 'active') {
    throw new Error(`production Connector Runtime is not enabled/active: ${payload.serviceEnabled}/${payload.serviceState}`)
  }
  if (payload.restartCount !== 0) {
    throw new Error(`production Connector Runtime restarted unexpectedly: ${String(payload.restartCount)}`)
  }
  const activeSinceMs = Date.parse(requiredString(payload.activeSince, 'Connector active timestamp'))
  if (!Number.isFinite(activeSinceMs) || activeSinceMs > input.observationStartMs) {
    throw new Error(`production Connector Runtime became active after observation start: ${String(payload.activeSince)}`)
  }
  if (payload.version !== input.expectedVersion) {
    throw new Error(`production Connector Runtime version mismatch: expected ${input.expectedVersion}, got ${String(payload.version)}`)
  }
  return payload
}
