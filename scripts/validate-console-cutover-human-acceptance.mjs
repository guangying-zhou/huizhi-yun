#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const argv = process.argv.slice(2)
const allowPending = argv.includes('--allow-pending')

function option(name) {
  const index = argv.findIndex(item => item === name || item.startsWith(`${name}=`))
  if (index < 0) return ''
  const item = argv[index]
  return String(item.includes('=') ? item.slice(item.indexOf('=') + 1) : argv[index + 1] || '').trim()
}

function fail(message) {
  throw new Error(message)
}

function stringValue(value, label, minimumLength = 1) {
  const normalized = String(value || '').trim()
  if (normalized.length < minimumLength) fail(`${label} is required`)
  return normalized
}

function isoValue(value, label) {
  const normalized = stringValue(value, label)
  if (!Number.isFinite(Date.parse(normalized))) fail(`${label} must be an ISO-8601 timestamp`)
  return normalized
}

function sha256Value(value, label) {
  const normalized = stringValue(value, label)
  if (!/^sha256[:_][0-9a-f]{64}$/.test(normalized)) {
    fail(`${label} must be sha256:<lowercase hex> or sha256_<lowercase hex>`)
  }
  return normalized
}

function approveWitness(value, expectedRole, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} is required`)
  stringValue(value.identity, `${label}.identity`)
  if (value.role !== expectedRole) fail(`${label}.role must be ${expectedRole}`)
  if (value.decision !== 'approved') fail(`${label}.decision must be approved`)
  isoValue(value.signedAt, `${label}.signedAt`)
  stringValue(value.approvalReference, `${label}.approvalReference`, 3)
  stringValue(value.statement, `${label}.statement`, 20)
}

function approvedException(value, taskId) {
  const label = `${taskId}.approvedException`
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} is required`)
  stringValue(value.identity, `${label}.identity`)
  if (value.role !== 'change_authority') fail(`${label}.role must be change_authority`)
  if (value.decision !== 'exception_approved') {
    fail(`${label}.decision must be exception_approved`)
  }
  isoValue(value.signedAt, `${label}.signedAt`)
  stringValue(value.approvalReference, `${label}.approvalReference`, 3)
  stringValue(value.reason, `${label}.reason`, 10)
  stringValue(value.scope, `${label}.scope`, 10)
  stringValue(value.riskAcceptance, `${label}.riskAcceptance`, 20)
  stringValue(value.statement, `${label}.statement`, 20)
}

function taskById(payload, taskId) {
  const tasks = Array.isArray(payload.humanTasks) ? payload.humanTasks : []
  const matches = tasks.filter(item => item?.taskId === taskId)
  if (matches.length !== 1) fail(`humanTasks must contain exactly one ${taskId}`)
  return matches[0]
}

function scanSecrets(raw) {
  const checks = {
    bearer: /bearer\s+[a-z0-9._~-]{12,}/i.test(raw),
    jwt: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/.test(raw),
    privateKey: /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/.test(raw),
    dsn: /(?:mysql|postgres(?:ql)?):\/\//i.test(raw),
    platformToken: /hzy_(?:pi|rt|st)_[A-Za-z0-9_-]{12,}/.test(raw)
  }
  const failed = Object.entries(checks).filter(([, found]) => found).map(([name]) => name)
  if (failed.length > 0) fail(`acceptance file contains forbidden secret material: ${failed.join(', ')}`)
}

function validatePendingShape(payload) {
  if (payload.schemaVersion !== 2) fail('schemaVersion must be 2')
  if (payload.evidenceType !== 'console-cutover-human-acceptance') {
    fail('evidenceType must be console-cutover-human-acceptance')
  }
  if (payload.tenantCode !== 'C000001' || payload.environment !== 'prod') {
    fail('acceptance file must be bound to C000001/prod')
  }
  isoValue(payload.generatedAt, 'generatedAt')
  if (payload.secretsIncluded !== false) fail('secretsIncluded must be false')

  const supersedes = payload.supersedes
  if (!supersedes || typeof supersedes !== 'object') fail('supersedes is required')
  stringValue(supersedes.file, 'supersedes.file')
  sha256Value(supersedes.sha256, 'supersedes.sha256')

  const baseline = payload.technicalBaseline
  if (!baseline || typeof baseline !== 'object') fail('technicalBaseline is required')
  for (const key of ['t0RuntimeVersion', 't0WorkerVersionId', 'currentRuntimeVersion', 'currentWorkerVersionId']) {
    stringValue(baseline[key], `technicalBaseline.${key}`)
  }
  if (!Number.isSafeInteger(baseline.t0WorkerVersionNumber) || baseline.t0WorkerVersionNumber <= 0) {
    fail('technicalBaseline.t0WorkerVersionNumber must be a positive integer')
  }
  if (!Number.isSafeInteger(baseline.currentWorkerVersionNumber) || baseline.currentWorkerVersionNumber <= 0) {
    fail('technicalBaseline.currentWorkerVersionNumber must be a positive integer')
  }
  sha256Value(baseline.runtimeSchemaRevision, 'technicalBaseline.runtimeSchemaRevision')
  sha256Value(baseline.ctr812EvidenceSha256, 'technicalBaseline.ctr812EvidenceSha256')
  sha256Value(baseline.latestObservationSha256, 'technicalBaseline.latestObservationSha256')

  const completed = new Map(
    (Array.isArray(payload.completedTechnicalItems) ? payload.completedTechnicalItems : [])
      .map(item => [item?.taskId, item])
  )
  for (const taskId of ['CTR-812', 'CTR-823']) {
    const item = completed.get(taskId)
    if (item?.status !== 'passed') fail(`completedTechnicalItems.${taskId} must be passed`)
    sha256Value(item.evidenceSha256, `completedTechnicalItems.${taskId}.evidenceSha256`)
  }

  for (const taskId of ['CTR-801', 'CTR-816']) {
    const task = taskById(payload, taskId)
    if (!['pending', 'approved', 'exception_approved'].includes(task.status)) {
      fail(`${taskId}.status must be pending, approved or exception_approved`)
    }
    if (task.status === 'exception_approved') approvedException(task.approvedException, taskId)
  }

  const freeze = taskById(payload, 'CTR-801')
  if (!freeze.freezeRecord || typeof freeze.freezeRecord !== 'object') {
    fail('CTR-801.freezeRecord is required')
  }
  sha256Value(freeze.freezeRecord.schemaRevision, 'CTR-801.freezeRecord.schemaRevision')
  if (!freeze.witness || freeze.witness.role !== 'change_owner') {
    fail('CTR-801.witness.role must be change_owner')
  }

  const signoff = taskById(payload, 'CTR-816')
  const signoffs = Array.isArray(signoff.signoffs) ? signoff.signoffs : []
  const requiredRoles = ['runtime_owner', 'console_owner', 'dba_security', 'business_acceptance']
  for (const role of requiredRoles) {
    if (signoffs.filter(item => item?.role === role).length !== 1) {
      fail(`CTR-816.signoffs must contain exactly one ${role}`)
    }
  }
  if (signoffs.length !== requiredRoles.length) fail('CTR-816.signoffs contains unexpected roles')
}

function validateComplete(payload) {
  const freeze = taskById(payload, 'CTR-801')
  if (freeze.status === 'approved') {
    const record = freeze.freezeRecord
    if (!record || typeof record !== 'object') fail('CTR-801.freezeRecord is required')
    const startedAt = Date.parse(isoValue(record.startedAt, 'CTR-801.freezeRecord.startedAt'))
    const endedAt = Date.parse(isoValue(record.endedAt, 'CTR-801.freezeRecord.endedAt'))
    if (endedAt < startedAt) fail('CTR-801 freeze end must not precede start')
    stringValue(record.releaseIdentifier, 'CTR-801.freezeRecord.releaseIdentifier')
    sha256Value(record.schemaRevision, 'CTR-801.freezeRecord.schemaRevision')
    sha256Value(record.bundleHash, 'CTR-801.freezeRecord.bundleHash')
    stringValue(record.responsibleOwner, 'CTR-801.freezeRecord.responsibleOwner')
    approveWitness(freeze.witness, 'change_owner', 'CTR-801.witness')
  } else if (freeze.status === 'exception_approved') {
    approvedException(freeze.approvedException, 'CTR-801')
  } else {
    fail('CTR-801 is not approved')
  }

  const signoff = taskById(payload, 'CTR-816')
  if (signoff.status === 'approved') {
    const signoffs = Array.isArray(signoff.signoffs) ? signoff.signoffs : []
    const requiredRoles = ['runtime_owner', 'console_owner', 'dba_security', 'business_acceptance']
    for (const role of requiredRoles) {
      const matches = signoffs.filter(item => item?.role === role)
      if (matches.length !== 1) fail(`CTR-816.signoffs must contain exactly one ${role}`)
      approveWitness(matches[0], role, `CTR-816.signoffs.${role}`)
      if (matches[0].noUnacceptedBlockers !== true) {
        fail(`CTR-816.signoffs.${role}.noUnacceptedBlockers must be true`)
      }
    }
    if (signoffs.length !== requiredRoles.length) fail('CTR-816.signoffs contains unexpected roles')
  } else if (signoff.status === 'exception_approved') {
    approvedException(signoff.approvedException, 'CTR-816')
  } else {
    fail('CTR-816 is not approved')
  }
  if (payload.allHumanAcceptanceComplete !== true) {
    fail('allHumanAcceptanceComplete must be true after all approvals')
  }
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.info('Usage: pnpm run validate:console-cutover-human-acceptance -- --file <json> [--allow-pending]')
  process.exit(0)
}

try {
  const file = option('--file')
  if (!file) fail('--file is required')
  const path = resolve(process.cwd(), file)
  const stat = statSync(path)
  if (!stat.isFile()) fail('acceptance path must be a regular file')
  if ((stat.mode & 0o077) !== 0) fail('acceptance file must not be accessible by group/other')
  const raw = readFileSync(path, 'utf8')
  scanSecrets(raw)
  const payload = JSON.parse(raw)
  validatePendingShape(payload)

  const approvedStatuses = new Set(['approved', 'exception_approved'])
  const pending = ['CTR-801', 'CTR-816']
    .filter(taskId => !approvedStatuses.has(taskById(payload, taskId).status))
  if (!allowPending) validateComplete(payload)
  if (allowPending && pending.length === 0) validateComplete(payload)

  console.info(JSON.stringify({
    valid: true,
    complete: pending.length === 0,
    pending,
    fileSha256: createHash('sha256').update(raw).digest('hex')
  }))
} catch (error) {
  console.error(`[console-cutover-human-acceptance] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
