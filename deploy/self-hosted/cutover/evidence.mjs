import { createHash, createHmac } from 'node:crypto'

export const INPUT_SCHEMA = 'enterprise-offline-evidence-input.v1'
export const OBSERVATION_SCHEMA = 'enterprise-offline-observation.v1'
export const PACKAGE_SCHEMA = 'enterprise-offline-evidence-package.v1'
export const FIXED_LIMITS = Object.freeze({
  clockSkewMs: 30_000,
  collectionSpanMs: 10 * 60_000,
  currentPEvidenceMs: 30 * 60_000,
  currentQEvidenceMs: 10 * 60_000,
  approvalMs: 15 * 60_000,
  activationCheckMs: 2 * 60_000,
  c2MinIntervalMs: 5 * 60_000
})

const P_KINDS = Object.freeze([
  'c2-source-first', 'c2-source-second', 'dump-link', 'provider-report',
  'p-gateway', 'p-runtime', 'p-source', 'p-nginx'
])
const Q_KINDS = Object.freeze(['c2-source-second', 'q-gateway', 'q-runtime', 'q-source', 'q-nginx'])
const HEX64 = /^[a-f0-9]{64}$/
const ASCII_KEY = /^[A-Za-z][A-Za-z0-9_]*$/
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

function fail(code) { throw new Error(code) }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function exact(value, keys, code) {
  if (!object(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail(code)
}
function nonempty(value, code) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 128) fail(code)
  return value
}
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }

// This is a deliberately narrow wire format: ASCII object keys, NFC strings,
// safe integers, sorted keys, UTF-8 bytes and one trailing LF. It rejects
// duplicate keys because reserializing cannot reproduce their original bytes.
export function canonicalJson(value) {
  const visit = (item) => {
    if (item === null || typeof item === 'boolean') return JSON.stringify(item)
    if (typeof item === 'string') {
      if (item !== item.normalize('NFC')) fail('EVIDENCE_NON_NFC_STRING')
      return JSON.stringify(item)
    }
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item) || Object.is(item, -0)) fail('EVIDENCE_NON_INTEGER_NUMBER')
      return String(item)
    }
    if (Array.isArray(item)) return `[${item.map(visit).join(',')}]`
    if (!object(item)) fail('EVIDENCE_UNSUPPORTED_VALUE')
    const keys = Object.keys(item).sort()
    if (keys.some(key => !ASCII_KEY.test(key))) fail('EVIDENCE_INVALID_KEY')
    return `{${keys.map(key => `${JSON.stringify(key)}:${visit(item[key])}`).join(',')}}`
  }
  return `${visit(value)}\n`
}

export function parseCanonicalJson(bytes) {
  const text = Buffer.from(bytes).toString('utf8')
  if (!Buffer.from(text).equals(Buffer.from(bytes))) fail('EVIDENCE_INVALID_UTF8')
  let parsed
  try { parsed = JSON.parse(text) } catch { fail('EVIDENCE_INVALID_JSON') }
  if (text !== canonicalJson(parsed)) fail('EVIDENCE_NON_CANONICAL_JSON')
  return parsed
}

export function utcMillis(value) {
  if (typeof value !== 'string' || !UTC.test(value)) fail('EVIDENCE_TIME_FORMAT')
  const result = Date.parse(value)
  if (!Number.isFinite(result) || new Date(result).toISOString().replace(/\.000Z$/, 'Z') !== value.replace(/\.000Z$/, 'Z')) fail('EVIDENCE_TIME_INVALID')
  return result
}

export function validateBinding(binding) {
  exact(binding, ['tenant', 'environment', 'cutoverKey', 'targetGeneration', 'instanceId', 'runtimeDeployment'], 'EVIDENCE_BINDING_SHAPE')
  nonempty(binding.tenant, 'EVIDENCE_TENANT')
  if (!['prod', 'test', 'dev'].includes(binding.environment)) fail('EVIDENCE_ENVIRONMENT')
  for (const key of ['cutoverKey', 'instanceId', 'runtimeDeployment']) nonempty(binding[key], 'EVIDENCE_BINDING_VALUE')
  if (typeof binding.targetGeneration !== 'string' || !/^[1-9][0-9]{0,19}$/.test(binding.targetGeneration) || BigInt(binding.targetGeneration) > 18446744073709551615n) fail('EVIDENCE_GENERATION')
  return binding
}

export function validateObservation(value, binding, nowMs) {
  exact(value, ['schemaVersion', 'binding', 'kind', 'observedStart', 'observedEnd', 'collector', 'result'], 'EVIDENCE_OBSERVATION_SHAPE')
  if (value.schemaVersion !== OBSERVATION_SCHEMA || canonicalJson(value.binding) !== canonicalJson(binding)) fail('EVIDENCE_OBSERVATION_BINDING')
  nonempty(value.kind, 'EVIDENCE_KIND')
  nonempty(value.collector, 'EVIDENCE_COLLECTOR')
  if (!object(value.result)) fail('EVIDENCE_RESULT_SHAPE')
  const start = utcMillis(value.observedStart), end = utcMillis(value.observedEnd)
  if (start > end || end > nowMs + FIXED_LIMITS.clockSkewMs) fail('EVIDENCE_OBSERVATION_TIME')
  return { start, end }
}

function sourceRows(observation) {
  exact(observation.result, ['tables'], 'EVIDENCE_SOURCE_SHAPE')
  const tables = observation.result.tables
  if (!Array.isArray(tables) || tables.length === 0) fail('EVIDENCE_SOURCE_TABLES')
  let previous = ''
  for (const row of tables) {
    exact(row, ['schema', 'table', 'count', 'checksum'], 'EVIDENCE_TABLE_SHAPE')
    if (['schema', 'table', 'count', 'checksum'].some(key => typeof row[key] !== 'string') || !/^[a-z][a-z0-9_]{0,63}$/.test(row.schema) || !/^[a-z][a-z0-9_]{0,63}$/.test(row.table) || !/^(0|[1-9][0-9]*)$/.test(row.count) || !/^(0|[1-9][0-9]*)$/.test(row.checksum)) fail('EVIDENCE_TABLE_VALUE')
    const id = `${row.schema}.${row.table}`
    if (id <= previous) fail('EVIDENCE_TABLE_ORDER')
    previous = id
  }
  return canonicalJson(tables)
}

function validateState(kind, result) {
  if (kind.endsWith('gateway')) {
    exact(result, ['routeDisabled', 'workerDisabled', 'routeId', 'workerVersion'], 'EVIDENCE_GATEWAY_SHAPE')
    if (result.routeDisabled !== true || result.workerDisabled !== true) fail('EVIDENCE_GATEWAY_ACTIVE')
    nonempty(result.routeId, 'EVIDENCE_GATEWAY_ID'); nonempty(result.workerVersion, 'EVIDENCE_GATEWAY_VERSION')
  } else if (kind.endsWith('runtime')) {
    exact(result, ['serviceInactive', 'timerInactive', 'unit', 'timer'], 'EVIDENCE_RUNTIME_SHAPE')
    if (result.serviceInactive !== true || result.timerInactive !== true) fail('EVIDENCE_RUNTIME_ACTIVE')
    nonempty(result.unit, 'EVIDENCE_RUNTIME_UNIT'); nonempty(result.timer, 'EVIDENCE_RUNTIME_TIMER')
  } else if (kind.endsWith('nginx')) {
    exact(result, ['maintenanceConfig', 'maintenanceResponse', 'serverName'], 'EVIDENCE_NGINX_SHAPE')
    if (result.maintenanceConfig !== true || result.maintenanceResponse !== true) fail('EVIDENCE_NGINX_OPEN')
    nonempty(result.serverName, 'EVIDENCE_NGINX_NAME')
  } else if (kind.includes('source')) sourceRows({ result })
  else if (kind === 'dump-link' || kind === 'provider-report') {
    exact(result, ['sha256'], 'EVIDENCE_LINK_SHAPE')
    if (typeof result.sha256 !== 'string' || !HEX64.test(result.sha256)) fail('EVIDENCE_LINK_HASH')
  }
}

export function validateInputManifest(input) {
  exact(input, ['schemaVersion', 'phase', 'binding', 'files', 'approval'], 'EVIDENCE_INPUT_SHAPE')
  if (input.schemaVersion !== INPUT_SCHEMA || !['p', 'q'].includes(input.phase)) fail('EVIDENCE_PHASE')
  const binding = validateBinding(input.binding)
  const needed = input.phase === 'p' ? P_KINDS : Q_KINDS
  if (!Array.isArray(input.files) || input.files.length !== needed.length) fail('EVIDENCE_FILE_CLOSURE')
  const seen = new Set(), names = new Set()
  for (const file of input.files) {
    exact(file, ['kind', 'name'], 'EVIDENCE_FILE_SHAPE')
    if (!needed.includes(file.kind) || seen.has(file.kind) || typeof file.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(file.name) || file.name === '.' || file.name === '..' || names.has(file.name)) fail('EVIDENCE_FILE_CLOSURE')
    seen.add(file.kind); names.add(file.name)
  }
  if (seen.size !== needed.length) fail('EVIDENCE_FILE_CLOSURE')
  if (input.phase === 'p') {
    if (input.approval !== null) fail('EVIDENCE_APPROVAL_EARLY')
  } else {
    exact(input.approval, ['payloadSha256', 'approvedAt', 'pEarliestStart'], 'EVIDENCE_APPROVAL_SHAPE')
    if (typeof input.approval.payloadSha256 !== 'string' || !HEX64.test(input.approval.payloadSha256)) fail('EVIDENCE_APPROVAL_HASH')
    utcMillis(input.approval.approvedAt); utcMillis(input.approval.pEarliestStart)
  }
  return binding
}

export function validatePackageInput(input, observations, nowMs = Date.now()) {
  if (!Number.isSafeInteger(nowMs)) fail('EVIDENCE_NOW')
  const binding = validateInputManifest(input)
  const needed = input.phase === 'p' ? P_KINDS : Q_KINDS
  if (!Array.isArray(observations) || observations.length !== needed.length) fail('EVIDENCE_FILE_CLOSURE')
  const seen = new Set(), byKind = new Map(), metadata = new Map()
  for (let i = 0; i < input.files.length; i++) {
    const file = input.files[i]
    exact(file, ['kind', 'name'], 'EVIDENCE_FILE_SHAPE')
    if (!needed.includes(file.kind) || seen.has(file.kind)) fail('EVIDENCE_FILE_CLOSURE')
    seen.add(file.kind)
    if (observations[i].kind !== file.kind) fail('EVIDENCE_FILE_KIND')
    metadata.set(file.kind, validateObservation(observations[i], binding, nowMs))
    validateState(file.kind, observations[i].result)
    byKind.set(file.kind, observations[i])
  }
  if (seen.size !== needed.length) fail('EVIDENCE_FILE_CLOSURE')
  if (input.phase === 'p') {
    if (metadata.get('c2-source-second').start - metadata.get('c2-source-first').end < FIXED_LIMITS.c2MinIntervalMs) fail('EVIDENCE_C2_INTERVAL')
    if (metadata.get('dump-link').start < metadata.get('c2-source-second').end || metadata.get('provider-report').start < metadata.get('dump-link').end) fail('EVIDENCE_STAGE_ORDER')
    if (sourceRows(byKind.get('c2-source-first')) !== sourceRows(byKind.get('c2-source-second')) || sourceRows(byKind.get('p-source')) !== sourceRows(byKind.get('c2-source-second'))) fail('EVIDENCE_SOURCE_CHANGED')
    if (Math.min(...['p-gateway', 'p-runtime', 'p-source', 'p-nginx'].map(kind => metadata.get(kind).start)) < metadata.get('provider-report').end) fail('EVIDENCE_STAGE_ORDER')
  } else {
    if (sourceRows(byKind.get('q-source')) !== sourceRows(byKind.get('c2-source-second'))) fail('EVIDENCE_SOURCE_CHANGED')
    const qStart = Math.min(...['q-gateway', 'q-runtime', 'q-source', 'q-nginx'].map(kind => metadata.get(kind).start))
    const pStart = utcMillis(input.approval.pEarliestStart), approved = utcMillis(input.approval.approvedAt)
    if (metadata.get('c2-source-second').end >= pStart || metadata.get('c2-source-second').end >= approved || metadata.get('c2-source-second').end >= qStart || qStart < approved) fail('EVIDENCE_STAGE_ORDER')
  }
  return { binding, byKind, metadata }
}

function currentWindow(metadata, prefix) {
  const kinds = [`${prefix}-gateway`, `${prefix}-runtime`, `${prefix}-source`, `${prefix}-nginx`]
  const start = Math.min(...kinds.map(kind => metadata.get(kind).start))
  const end = Math.max(...kinds.map(kind => metadata.get(kind).end))
  if (end - start > FIXED_LIMITS.collectionSpanMs) fail('EVIDENCE_COLLECTION_SPAN')
  return { start, end }
}

export function evaluateTime(input, metadata, nowMs = Date.now()) {
  if (!Number.isSafeInteger(nowMs)) fail('EVIDENCE_NOW')
  const now = nowMs
  if (input.phase === 'p') {
    const p = currentWindow(metadata, 'p')
    if (now > p.start + FIXED_LIMITS.currentPEvidenceMs) fail('EVIDENCE_P_EXPIRED')
    return { phase: 'p', earliestObservedAt: new Date(p.start).toISOString(), latestObservedAt: new Date(p.end).toISOString(), expiresAt: new Date(p.start + FIXED_LIMITS.currentPEvidenceMs).toISOString() }
  }
  const q = currentWindow(metadata, 'q')
  const approved = utcMillis(input.approval.approvedAt), pStart = utcMillis(input.approval.pEarliestStart)
  if (approved > now + FIXED_LIMITS.clockSkewMs || pStart > approved || q.start < approved) fail('EVIDENCE_APPROVAL_TIME')
  const deadline = Math.min(pStart + FIXED_LIMITS.currentPEvidenceMs, q.start + FIXED_LIMITS.currentQEvidenceMs, approved + FIXED_LIMITS.approvalMs)
  if (now > deadline) fail('EVIDENCE_Q_EXPIRED')
  return { phase: 'q', earliestObservedAt: new Date(q.start).toISOString(), latestObservedAt: new Date(q.end).toISOString(), expiresAt: new Date(deadline).toISOString(), approvalPayloadSha256: input.approval.payloadSha256 }
}

export function activationDeadline({ pEarliestStart, qEarliestStart, approvedAt, checkSignedAt }, nowMs = Date.now()) {
  if (!Number.isSafeInteger(nowMs)) fail('EVIDENCE_NOW')
  const p = utcMillis(pEarliestStart), q = utcMillis(qEarliestStart), approved = utcMillis(approvedAt), signed = utcMillis(checkSignedAt)
  if (p > approved || approved > q || q > signed || signed > nowMs + FIXED_LIMITS.clockSkewMs) fail('EVIDENCE_ACTIVATION_ORDER')
  const deadline = Math.min(p + FIXED_LIMITS.currentPEvidenceMs, q + FIXED_LIMITS.currentQEvidenceMs, approved + FIXED_LIMITS.approvalMs, signed + FIXED_LIMITS.activationCheckMs)
  if (nowMs > deadline) fail('EVIDENCE_ACTIVATION_EXPIRED')
  return new Date(deadline).toISOString()
}

export function buildLocalPackage(input, observations, nowMs = Date.now(), credential) {
  const { metadata } = validatePackageInput(input, observations, nowMs)
  const time = evaluateTime(input, metadata, nowMs)
  const entries = observations.map((item, i) => ({ kind: item.kind, name: input.files[i].name, sha256: sha256(canonicalJson(item)), observedStart: item.observedStart, observedEnd: item.observedEnd })).sort((a, b) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)
  const manifestSha256 = sha256(canonicalJson(entries))
  const body = { schemaVersion: PACKAGE_SCHEMA, status: credential ? 'validated-local-structure' : 'draft', trustBoundary: 'fixture-or-local-material-only;not-platform-approved;not-live-drain-proof', binding: input.binding, phase: input.phase, time, entries, manifestSha256 }
  if (!credential) return body
  const payload = canonicalJson(body)
  return { ...body, localMac: { alg: 'HS256', payloadSha256: sha256(payload), signature: createHmac('sha256', credential).update(payload).digest('hex') } }
}
