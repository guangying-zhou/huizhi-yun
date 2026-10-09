import {
  verifyCutoverGateObservation,
  verifyProductionConnectorObservation,
  verifyRuntimeHostObservation
} from './console-zero-db-observation.mjs'

export {
  REQUIRED_CUTOVER_CHECK_CODES,
  REQUIRED_ZERO_CUTOVER_METRICS
} from './console-zero-db-observation.mjs'

function requiredString(value, label) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`${label} is missing`)
  return normalized
}

function requiredISO(value, label) {
  const normalized = requiredString(value, label)
  const timestamp = Date.parse(normalized)
  if (!Number.isFinite(timestamp)) throw new Error(`${label} is not a valid ISO-8601 timestamp`)
  return { normalized, timestamp }
}

function assertZero(value, label) {
  if (Number(value) !== 0) throw new Error(`${label} must be zero, got ${String(value)}`)
}

function humanTask(payload, taskId) {
  const matches = (Array.isArray(payload?.humanTasks) ? payload.humanTasks : [])
    .filter(item => item?.taskId === taskId)
  if (matches.length !== 1) throw new Error(`acceptance must contain exactly one ${taskId}`)
  return matches[0]
}

function verifyObservationIdentity(payload, expected, label) {
  if (payload?.evidenceType !== 'console-zero-db-observation' || payload?.schemaVersion !== 1) {
    throw new Error(`${label} evidence type or schema is invalid`)
  }
  if (payload?.secretsIncluded !== false) throw new Error(`${label} must not include secrets`)
  const observedAt = requiredISO(payload?.observedAt, `${label} observedAt`)
  const startedAt = requiredISO(payload?.observationWindow?.startedAt, `${label} startedAt`)
  const notBeforeCloseAt = requiredISO(
    payload?.observationWindow?.notBeforeCloseAt,
    `${label} notBeforeCloseAt`
  )
  if (startedAt.normalized !== expected.observationStart) {
    throw new Error(`${label} observation start mismatch`)
  }
  if (notBeforeCloseAt.normalized !== expected.notBeforeClose) {
    throw new Error(`${label} observation close boundary mismatch`)
  }
  if (payload?.runtime?.health?.version !== expected.runtimeVersion ||
      payload?.runtime?.cutover?.schemaRevision !== expected.schemaRevision ||
      payload?.worker?.versionId !== expected.workerVersionId ||
      Number(payload?.worker?.versionNumber) !== expected.workerVersionNumber ||
      Number(payload?.worker?.bindingCount) !== expected.workerBindingCount) {
    throw new Error(`${label} Runtime, schema, or Worker anchor is invalid`)
  }
  return { observedAt, startedAt, notBeforeCloseAt }
}

function matchingEvidenceReference(references, file, sha256, label) {
  const matches = references.filter(reference => reference?.file === file)
  if (matches.length !== 1) {
    throw new Error(`operational summary must contain exactly one ${label} reference`)
  }
  if (matches[0]?.sha256 !== sha256) {
    throw new Error(`operational summary ${label} SHA-256 mismatch`)
  }
}

function verifyTechnicalObservation(payload, expected, observationStartMs) {
  verifyCutoverGateObservation(payload?.runtime?.cutover)

  const worker = payload?.worker
  if (worker?.versionId !== expected.workerVersionId ||
      Number(worker?.versionNumber) !== expected.workerVersionNumber ||
      Number(worker?.bindingCount) !== expected.workerBindingCount ||
      Number(worker?.trafficPercentage) !== 100 ||
      !requiredString(worker?.deploymentId, 'Worker deployment ID') ||
      !Array.isArray(worker?.forbiddenBindings) ||
      worker.forbiddenBindings.length !== 0) {
    throw new Error('Worker deployment evidence is invalid')
  }

  verifyRuntimeHostObservation(payload?.host || {}, {
    observationStartMs,
    expectedRuntimeVersion: expected.runtimeVersion,
    expectedConnectorId: expected.connectorId,
    expectedConnectorVersion: expected.connectorVersion,
    maxConnectorHeartbeatAgeSeconds: expected.maxConnectorHeartbeatAgeSeconds
  })
  verifyProductionConnectorObservation(payload?.connector || {}, {
    observationStartMs,
    expectedVersion: expected.connectorVersion
  })
}

export function verifyBaselineObservation(payload, expected) {
  const identity = verifyObservationIdentity(payload, expected, 'baseline observation')
  if (identity.observedAt.timestamp < identity.startedAt.timestamp ||
      identity.observedAt.timestamp >= identity.notBeforeCloseAt.timestamp) {
    throw new Error('baseline observation must be captured during the observation window')
  }
  if (payload?.observationWindow?.status !== 'in_progress' ||
      payload?.verdict?.checksPassed !== true ||
      payload?.verdict?.eligibleToClose !== false) {
    throw new Error('baseline observation must be a passing in-progress observation')
  }
  verifyTechnicalObservation(payload, expected, identity.startedAt.timestamp)
  return {
    observedAt: identity.observedAt.normalized,
    startedAt: identity.startedAt.normalized,
    notBeforeCloseAt: identity.notBeforeCloseAt.normalized
  }
}

export function verifyFinalObservation(payload, expected, nowMs = Date.now()) {
  const identity = verifyObservationIdentity(payload, expected, 'final observation')
  const { observedAt, startedAt, notBeforeCloseAt } = identity
  if (notBeforeCloseAt.timestamp - startedAt.timestamp < 72 * 60 * 60 * 1000) {
    throw new Error('observation window is shorter than 72 hours')
  }
  if (nowMs < notBeforeCloseAt.timestamp || observedAt.timestamp < notBeforeCloseAt.timestamp) {
    throw new Error('72-hour observation window has not completed')
  }
  if (payload?.observationWindow?.status !== 'eligible_for_close_review' ||
      payload?.verdict?.checksPassed !== true ||
      payload?.verdict?.eligibleToClose !== true) {
    throw new Error('final observation is not eligible for close review')
  }
  verifyTechnicalObservation(payload, expected, startedAt.timestamp)
  return {
    observedAt: observedAt.normalized,
    startedAt: startedAt.normalized,
    notBeforeCloseAt: notBeforeCloseAt.normalized,
    elapsedHours: (observedAt.timestamp - startedAt.timestamp) / 3_600_000
  }
}

export function verifyOperationalSummary(payload, expected) {
  if (payload?.schemaVersion !== 1 || payload?.evidenceType !== 'console-zero-db-operational-summary') {
    throw new Error('operational summary evidence type or schema is invalid')
  }
  if (payload?.tenantCode !== expected.tenantCode || payload?.environment !== expected.environment) {
    throw new Error('operational summary tenant/environment binding is invalid')
  }
  if (payload?.secretsIncluded !== false) throw new Error('operational summary must not include secrets')
  const generatedAt = requiredISO(payload?.generatedAt, 'operational summary generatedAt')
  const startedAt = requiredISO(payload?.window?.startedAt, 'operational summary startedAt')
  const endedAt = requiredISO(payload?.window?.endedAt, 'operational summary endedAt')
  const finalObservedAt = requiredISO(
    expected.finalObservationObservedAt,
    'expected final observation observedAt'
  )
  if (startedAt.normalized !== expected.observationStart ||
      endedAt.timestamp < Date.parse(expected.notBeforeClose) ||
      endedAt.timestamp < finalObservedAt.timestamp ||
      generatedAt.timestamp < endedAt.timestamp) {
    throw new Error('operational summary does not cover the complete observation window')
  }
  const disposition = payload?.disposition || {}
  for (const field of [
    'blockerEvents',
    'crossTenantAlerts',
    'secretAlerts',
    'rollbackEvents',
    'errorBudgetBreaches',
    'connectorHeartbeatIncidents'
  ]) {
    assertZero(disposition[field], `operational summary ${field}`)
  }
  if (disposition.conclusion !== 'pass') throw new Error('operational summary conclusion must be pass')
  const references = Array.isArray(payload?.observationEvidence) ? payload.observationEvidence : []
  if (references.length < 3) {
    throw new Error('operational summary must reference baseline, intermediate, and final observations')
  }
  const referenceFiles = new Set()
  for (const [index, reference] of references.entries()) {
    const file = requiredString(reference?.file, `operational summary evidence[${index}].file`)
    if (referenceFiles.has(file)) {
      throw new Error(`operational summary contains duplicate evidence file: ${file}`)
    }
    referenceFiles.add(file)
    if (!/^[0-9a-f]{64}$/.test(String(reference?.sha256 || ''))) {
      throw new Error(`operational summary evidence[${index}].sha256 is invalid`)
    }
  }
  matchingEvidenceReference(
    references,
    expected.baselineObservationFile,
    expected.baselineObservationSha256,
    'baseline observation'
  )
  matchingEvidenceReference(
    references,
    expected.finalObservationFile,
    expected.finalObservationSha256,
    'final observation'
  )
  return {
    generatedAt: generatedAt.normalized,
    endedAt: endedAt.normalized,
    evidenceCount: references.length
  }
}

export function verifyBackupRetention(payload, expected, backupStat) {
  if (payload?.schemaVersion !== 1 || payload?.evidenceType !== 'console-cutover-backup-retention') {
    throw new Error('backup retention evidence type or schema is invalid')
  }
  if (payload?.tenantCode !== expected.tenantCode || payload?.secretsIncluded !== false) {
    throw new Error('backup retention tenant or secret marker is invalid')
  }
  const registeredAt = requiredISO(payload?.registeredAt, 'backup registeredAt')
  const retainUntil = requiredISO(payload?.retention?.retainUntil, 'backup retainUntil')
  if (Number(payload?.retention?.minimumRetentionDays) < 90 ||
      retainUntil.timestamp - registeredAt.timestamp < 90 * 24 * 60 * 60 * 1000) {
    throw new Error('backup retention period is shorter than 90 days')
  }
  if (retainUntil.timestamp <= expected.finalizedAtMs) {
    throw new Error('backup retention expires before finalization')
  }
  if (payload?.retention?.automaticDeletionAllowed !== false ||
      payload?.retention?.destructionRequiresExplicitOwnerApproval !== true ||
      payload?.retention?.destructionRequiresObservationClosed !== true ||
      payload?.retention?.destructionRequiresNoOpenIncidentOrRollbackHold !== true) {
    throw new Error('backup destruction guardrails are incomplete')
  }
  if (payload?.backup?.encrypted !== true ||
      payload?.backup?.plaintextStored !== false ||
      payload?.backup?.storageMode !== '0600' ||
      Number(payload?.backup?.sizeBytes) !== Number(backupStat.sizeBytes) ||
      payload?.backup?.ciphertextSha256 !== backupStat.sha256) {
    throw new Error('encrypted backup file does not match the retention manifest')
  }
  return {
    registeredAt: registeredAt.normalized,
    retainUntil: retainUntil.normalized,
    minimumRetentionDays: Number(payload.retention.minimumRetentionDays),
    encryptedBackupSha256: backupStat.sha256
  }
}

export function verifyAcceptanceSnapshot(payload, expected) {
  if (payload?.schemaVersion !== 2 ||
      payload?.evidenceType !== 'console-cutover-human-acceptance' ||
      payload?.tenantCode !== expected.tenantCode ||
      payload?.environment !== expected.environment ||
      payload?.secretsIncluded !== false ||
      payload?.allHumanAcceptanceComplete !== true) {
    throw new Error('acceptance snapshot is incomplete or incorrectly bound')
  }
  for (const taskId of ['CTR-801', 'CTR-816']) {
    const task = humanTask(payload, taskId)
    if (task.status !== 'exception_approved' ||
        task?.approvedException?.decision !== 'exception_approved' ||
        task?.approvedException?.role !== 'change_authority') {
      throw new Error(`${taskId} approved exception is missing`)
    }
  }
  return {
    ctr801: 'exception_approved',
    ctr816: 'exception_approved'
  }
}
