#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  verifyAcceptanceSnapshot,
  verifyBackupRetention,
  verifyBaselineObservation,
  verifyFinalObservation,
  verifyOperationalSummary
} from './lib/console-zero-db-finalization.mjs'

const argv = process.argv.slice(2)

function option(name, { required = false, fallback = '' } = {}) {
  const index = argv.findIndex(item => item === name || item.startsWith(`${name}=`))
  const item = index >= 0 ? argv[index] : ''
  const value = String(
    item
      ? (item.includes('=') ? item.slice(item.indexOf('=') + 1) : argv[index + 1] || '')
      : fallback
  ).trim()
  if (required && !value) throw new Error(`missing required option ${name}`)
  return value
}

function positiveInteger(name, fallback = '') {
  const value = Number(option(name, { required: !fallback, fallback }))
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

function sha256(raw) {
  return createHash('sha256').update(raw).digest('hex')
}

function protectedJSON(path, label) {
  const absolutePath = resolve(process.cwd(), path)
  const stat = statSync(absolutePath)
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a regular 0600-style protected file`)
  }
  const raw = readFileSync(absolutePath, 'utf8')
  if (/bearer\s+[a-z0-9._~-]{12,}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:mysql|postgres(?:ql)?):\/\//i.test(raw)) {
    throw new Error(`${label} contains forbidden secret material`)
  }
  return {
    path: absolutePath,
    file: basename(absolutePath),
    raw,
    sha256: sha256(raw),
    payload: JSON.parse(raw)
  }
}

function expectedSha(name) {
  const value = option(name, { required: true }).replace(/^sha256:/, '')
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${name} must be a lowercase SHA-256`)
  return value
}

function requireHash(file, expected, label) {
  if (file.sha256 !== expected) {
    throw new Error(`${label} SHA-256 mismatch: expected ${expected}, got ${file.sha256}`)
  }
}

function runStrictAcceptance(path) {
  const result = spawnSync(
    process.execPath,
    [resolve(import.meta.dirname, 'validate-console-cutover-human-acceptance.mjs'), '--file', path],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 }
  )
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || 'strict acceptance validation failed').trim())
  }
  const payload = JSON.parse(String(result.stdout || '').trim())
  if (payload.valid !== true || payload.complete !== true || payload.pending?.length !== 0) {
    throw new Error('strict acceptance validation is not complete')
  }
  return payload
}

function writeClosure(path, payload) {
  const output = resolve(process.cwd(), path)
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600
  })
  chmodSync(output, 0o600)
  return output
}

function verifyReferencedObservationFiles({
  operationalSummary,
  baselineObservation,
  baselineResult,
  finalObservation,
  finalResult,
  expected
}) {
  const evidenceDirectory = dirname(operationalSummary.path)
  if (dirname(baselineObservation.path) !== evidenceDirectory ||
      dirname(finalObservation.path) !== evidenceDirectory) {
    throw new Error('baseline, final, and operational summary evidence must be co-located')
  }
  const known = new Map([
    [baselineObservation.file, { evidence: baselineObservation, result: baselineResult, role: 'baseline' }],
    [finalObservation.file, { evidence: finalObservation, result: finalResult, role: 'final' }]
  ])
  return operationalSummary.payload.observationEvidence.map((reference, index) => {
    const file = String(reference?.file || '')
    if (!file || basename(file) !== file) {
      throw new Error(`operational summary evidence[${index}].file must be a basename`)
    }
    const knownEvidence = known.get(file)
    if (knownEvidence) {
      requireHash(knownEvidence.evidence, reference.sha256, `${knownEvidence.role} observation reference`)
      return {
        role: knownEvidence.role,
        file,
        sha256: knownEvidence.evidence.sha256,
        observedAt: knownEvidence.result.observedAt
      }
    }
    const checkpoint = protectedJSON(
      resolve(evidenceDirectory, file),
      `intermediate observation ${file}`
    )
    requireHash(checkpoint, reference.sha256, `intermediate observation ${file}`)
    const checkpointResult = verifyBaselineObservation(checkpoint.payload, expected)
    return {
      role: 'intermediate',
      file,
      sha256: checkpoint.sha256,
      observedAt: checkpointResult.observedAt
    }
  })
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.info(`
Usage:
  pnpm run finalize:console-zero-db-cutover -- \\
    --baseline-observation-file /secure/baseline-observation.json \\
    --baseline-observation-sha256 <digest> \\
    --observation-file /secure/final-observation.json \\
    --observation-sha256 <digest> \\
    --operational-summary-file /secure/operational-summary.json \\
    --operational-summary-sha256 <digest> \\
    --acceptance-file /secure/pending-change-acceptance-checklist-v2.json \\
    --acceptance-sha256 <digest> \\
    --backup-retention-file /secure/backup-retention-manifest.json \\
    --backup-retention-sha256 <digest> \\
    --expected-observation-start 2026-07-19T23:15:50.641Z \\
    --expected-not-before-close 2026-07-22T23:15:50.641Z \\
    --expected-runtime-version 0.3.133 \\
    --expected-schema-revision sha256:<digest> \\
    --expected-worker-version-id <version-id> \\
    --expected-worker-version-number 236 \\
    --expected-worker-binding-count 44 \\
    --expected-connector-id connector-runtime.C000001-console \\
    --expected-connector-version 0.4.22 \\
    --output-file /secure/closure-report.json
`.trim())
  process.exit(0)
}

try {
  const tenantCode = option('--tenant-code', { fallback: 'C000001' })
  const environment = option('--environment', { fallback: 'prod' })
  const observation = protectedJSON(option('--observation-file', { required: true }), 'final observation')
  const expected = {
    tenantCode,
    environment,
    observationStart: option('--expected-observation-start', { required: true }),
    notBeforeClose: option('--expected-not-before-close', { required: true }),
    runtimeVersion: option('--expected-runtime-version', { required: true }),
    schemaRevision: option('--expected-schema-revision', { required: true }),
    workerVersionId: option('--expected-worker-version-id', { required: true }),
    workerVersionNumber: positiveInteger('--expected-worker-version-number'),
    workerBindingCount: positiveInteger('--expected-worker-binding-count'),
    connectorId: option('--expected-connector-id', { required: true }),
    connectorVersion: option('--expected-connector-version', { required: true }),
    maxConnectorHeartbeatAgeSeconds: positiveInteger('--max-connector-heartbeat-age-seconds', '120')
  }

  const baselineObservation = protectedJSON(
    option('--baseline-observation-file', { required: true }),
    'baseline observation'
  )
  requireHash(
    baselineObservation,
    expectedSha('--baseline-observation-sha256'),
    'baseline observation'
  )
  const baselineResult = verifyBaselineObservation(baselineObservation.payload, expected)

  requireHash(observation, expectedSha('--observation-sha256'), 'final observation')
  const observationResult = verifyFinalObservation(observation.payload, expected)

  expected.baselineObservationFile = baselineObservation.file
  expected.baselineObservationSha256 = baselineObservation.sha256
  expected.finalObservationFile = observation.file
  expected.finalObservationSha256 = observation.sha256
  expected.finalObservationObservedAt = observationResult.observedAt

  const operationalSummary = protectedJSON(
    option('--operational-summary-file', { required: true }),
    'operational summary'
  )
  requireHash(
    operationalSummary,
    expectedSha('--operational-summary-sha256'),
    'operational summary'
  )
  const operationalResult = verifyOperationalSummary(operationalSummary.payload, expected)
  const referencedObservations = verifyReferencedObservationFiles({
    operationalSummary,
    baselineObservation,
    baselineResult,
    finalObservation: observation,
    finalResult: observationResult,
    expected
  })

  const acceptance = protectedJSON(option('--acceptance-file', { required: true }), 'acceptance')
  requireHash(acceptance, expectedSha('--acceptance-sha256'), 'acceptance')
  const strictAcceptance = runStrictAcceptance(acceptance.path)
  const acceptanceResult = verifyAcceptanceSnapshot(acceptance.payload, expected)

  const backupManifest = protectedJSON(
    option('--backup-retention-file', { required: true }),
    'backup retention manifest'
  )
  requireHash(backupManifest, expectedSha('--backup-retention-sha256'), 'backup retention manifest')
  const backupPath = resolve(dirname(backupManifest.path), String(backupManifest.payload?.backup?.file || ''))
  const backupFileStat = statSync(backupPath)
  if (!backupFileStat.isFile() || (backupFileStat.mode & 0o077) !== 0) {
    throw new Error('encrypted backup must be a protected regular file')
  }
  const backupRaw = readFileSync(backupPath)
  const backupResult = verifyBackupRetention(
    backupManifest.payload,
    { tenantCode, finalizedAtMs: Date.now() },
    { sizeBytes: backupFileStat.size, sha256: sha256(backupRaw) }
  )

  const finalizedAt = new Date()
  const output = writeClosure(option('--output-file', { required: true }), {
    schemaVersion: 1,
    evidenceType: 'console-zero-db-cutover-closure',
    finalizedAt: finalizedAt.toISOString(),
    tenantCode,
    environment,
    completedTasks: ['CTR-834', 'CTR-835'],
    verdict: {
      technicalChecksPassed: true,
      operationalReviewPassed: true,
      eligibleToClose: true
    },
    baselineObservation: {
      file: baselineObservation.file,
      sha256: baselineObservation.sha256,
      ...baselineResult
    },
    observation: {
      file: observation.file,
      sha256: observation.sha256,
      ...observationResult
    },
    operationalSummary: {
      file: operationalSummary.file,
      sha256: operationalSummary.sha256,
      ...operationalResult,
      observationEvidence: referencedObservations
    },
    acceptance: {
      file: acceptance.file,
      sha256: acceptance.sha256,
      strictValidation: strictAcceptance,
      ...acceptanceResult
    },
    backupRetention: {
      file: backupManifest.file,
      sha256: backupManifest.sha256,
      ...backupResult
    },
    anchors: {
      runtimeVersion: expected.runtimeVersion,
      schemaRevision: expected.schemaRevision,
      workerVersionId: expected.workerVersionId,
      workerVersionNumber: expected.workerVersionNumber,
      workerBindingCount: expected.workerBindingCount,
      connectorId: expected.connectorId,
      connectorVersion: expected.connectorVersion
    },
    secretsIncluded: false
  })
  console.info(`[console-zero-db-finalization] passed closure=${output}`)
} catch (error) {
  console.error(`[console-zero-db-finalization] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
