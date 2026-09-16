#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const SCRIPT = 'accept-g2-3-labor-cost-loop'
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const PRODUCTION_GATEWAY = 'https://wiztek.huizhi.yun'
const DEFAULTS = {
  projectCode: 'DEMO-P3P4-202607-PROJ',
  cycleCode: 'DEMO-P3P4-202607-CYCLE',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
  periodMonth: '2026-07',
  expectedAllocatedCost: 7180,
  timeoutMs: 15000
}

export class AcceptanceConfigurationError extends Error {}

export function usage() {
  return `Usage (safe preview; sends no requests):
  pnpm run accept:g2-3-labor-cost-loop -- \\
    --gateway-url https://wiztek.huizhi.yun \\
    --aims-project-id <runtime-project-id>

Execute only after reviewing the preview digest:
  G2_3_ACCEPT_COOKIE='<console session>' pnpm run accept:g2-3-labor-cost-loop -- \\
    --gateway-url https://wiztek.huizhi.yun \\
    --aims-project-id <runtime-project-id> \\
    --cookie-env G2_3_ACCEPT_COOKIE \\
    --execute --confirm <preview-sha256>

Optional: --project-code, --cycle-code, --period-start, --period-end,
--period-month, --expected-allocated-cost, --timeout-ms, --evidence-file.

Execution sends exactly four intentional POSTs: the Aims contribution sync
twice, then the Finance labor-cost sync twice. No automatic retry or rollback
is attempted. Direct --cookie/--authorization arguments are forbidden.`
}

function consumeOption(argv, index, raw) {
  const equalsIndex = raw.indexOf('=')
  const name = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw
  const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : argv[index + 1]
  if (!value || value.startsWith('--')) throw new AcceptanceConfigurationError(`missing value for --${name}`)
  return { name, value, nextIndex: equalsIndex >= 0 ? index : index + 1 }
}

function normalizeGateway(value, allowHttp) {
  const target = new URL(value)
  if (target.username || target.password || target.search || target.hash) {
    throw new AcceptanceConfigurationError('--gateway-url must not contain credentials, query, or fragment')
  }
  const localhost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname)
  if (localhost) {
    if (target.protocol !== 'https:' && !(allowHttp && target.protocol === 'http:')) {
      throw new AcceptanceConfigurationError('localhost HTTP additionally requires --allow-http')
    }
  } else if (target.origin !== PRODUCTION_GATEWAY) {
    throw new AcceptanceConfigurationError(`--gateway-url must be ${PRODUCTION_GATEWAY} on port 443`)
  }
  if (!['', '/'].includes(target.pathname)) {
    throw new AcceptanceConfigurationError('--gateway-url must not contain an application path')
  }
  return target.origin
}

export function parseArgs(argv, env = process.env) {
  const args = {
    ...DEFAULTS,
    gatewayUrl: '',
    aimsProjectId: '',
    cookieEnv: '',
    cookie: '',
    evidenceFile: '',
    confirm: '',
    execute: false,
    allowHttp: false,
    help: false
  }
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--') continue
    if (item === '--help' || item === '-h') { args.help = true; continue }
    if (item === '--execute') { args.execute = true; continue }
    if (item === '--allow-http') { args.allowHttp = true; continue }
    if (!item.startsWith('--')) throw new AcceptanceConfigurationError(`unexpected argument: ${item}`)
    const option = consumeOption(argv, index, item.slice(2))
    index = option.nextIndex
    switch (option.name) {
      case 'gateway-url': args.gatewayUrl = option.value; break
      case 'aims-project-id': args.aimsProjectId = option.value; break
      case 'project-code': args.projectCode = option.value; break
      case 'cycle-code': args.cycleCode = option.value; break
      case 'period-start': args.periodStart = option.value; break
      case 'period-end': args.periodEnd = option.value; break
      case 'period-month': args.periodMonth = option.value; break
      case 'expected-allocated-cost': args.expectedAllocatedCost = Number(option.value); break
      case 'timeout-ms': args.timeoutMs = Number(option.value); break
      case 'evidence-file': args.evidenceFile = option.value; break
      case 'confirm': args.confirm = option.value; break
      case 'cookie-env': args.cookieEnv = option.value; break
      case 'cookie':
      case 'authorization':
        throw new AcceptanceConfigurationError(`--${option.name} is forbidden; pass credentials through --cookie-env`)
      default: throw new AcceptanceConfigurationError(`unknown option: --${option.name}`)
    }
  }
  if (args.help) return args
  if (!args.gatewayUrl) throw new AcceptanceConfigurationError('--gateway-url is required')
  if (!args.aimsProjectId) throw new AcceptanceConfigurationError('--aims-project-id is required')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(args.aimsProjectId)) {
    throw new AcceptanceConfigurationError('--aims-project-id must be one safe path segment')
  }
  if (!text(args.projectCode) || !text(args.cycleCode)) {
    throw new AcceptanceConfigurationError('--project-code and --cycle-code must not be empty')
  }
  args.gatewayUrl = normalizeGateway(args.gatewayUrl, args.allowHttp)
  for (const [name, value] of [['period-start', args.periodStart], ['period-end', args.periodEnd]]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AcceptanceConfigurationError(`--${name} must use YYYY-MM-DD`)
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.periodMonth)) {
    throw new AcceptanceConfigurationError('--period-month must use YYYY-MM')
  }
  if (args.periodStart > args.periodEnd || !args.periodStart.startsWith(`${args.periodMonth}-`) || !args.periodEnd.startsWith(`${args.periodMonth}-`)) {
    throw new AcceptanceConfigurationError('period dates must be ordered and belong to --period-month')
  }
  if (!Number.isFinite(args.expectedAllocatedCost) || args.expectedAllocatedCost < 0) {
    throw new AcceptanceConfigurationError('--expected-allocated-cost must be a non-negative number')
  }
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1000 || args.timeoutMs > 60000) {
    throw new AcceptanceConfigurationError('--timeout-ms must be an integer between 1000 and 60000')
  }
  if (args.execute) {
    if (!args.cookieEnv) throw new AcceptanceConfigurationError('--cookie-env is required with --execute')
    const value = String(env[args.cookieEnv] || '').trim()
    if (!value) throw new AcceptanceConfigurationError(`environment variable is empty: ${args.cookieEnv}`)
    args.cookie = value.includes('=') ? value : `console_session=${value}`
  }
  return args
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
}

function text(value) {
  return String(value ?? '').trim()
}

function numeric(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function requestDefinitions(args) {
  const aimsPath = `/aims/api/v1/projects/${encodeURIComponent(args.aimsProjectId)}/people-contributions/sync`
  const financePath = '/finance/api/v1/finance/project-accounting/sync-people-costs'
  const aimsBody = {
    cycleCode: args.cycleCode,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd
  }
  const financeBody = {
    projectCode: args.projectCode,
    periodMonth: args.periodMonth,
    calculatedBy: 'g2-3-cloudflare-acceptance'
  }
  return [
    { code: 'aims.contribution_sync.first', family: 'aims_contribution_sync', replayOrdinal: 1, path: aimsPath, body: aimsBody },
    { code: 'aims.contribution_sync.replay', family: 'aims_contribution_sync', replayOrdinal: 2, path: aimsPath, body: aimsBody },
    { code: 'finance.labor_cost_sync.first', family: 'finance_labor_cost_sync', replayOrdinal: 1, path: financePath, body: financeBody },
    { code: 'finance.labor_cost_sync.replay', family: 'finance_labor_cost_sync', replayOrdinal: 2, path: financePath, body: financeBody }
  ]
}

export function buildExecutionPlan(args) {
  const requests = requestDefinitions(args)
  const summary = {
    schemaVersion: 1,
    target: args.gatewayUrl,
    projectCodeSha256: sha256(args.projectCode),
    aimsProjectIdSha256: sha256(args.aimsProjectId),
    cycleCodeSha256: sha256(args.cycleCode),
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    periodMonth: args.periodMonth,
    expectedAllocatedCost: args.expectedAllocatedCost,
    posts: requests.map(item => ({ method: 'POST', path: item.path, replayOrdinal: item.replayOrdinal }))
  }
  return { ...summary, confirmationSha256: sha256(summary), requests }
}

export function assertAllowedPostPath(path, plan) {
  const allowed = new Set(plan.requests.map(item => item.path))
  if (!allowed.has(path) || allowed.size !== 2) {
    throw new AcceptanceConfigurationError(`POST path is not in the two-endpoint whitelist: ${path}`)
  }
}

async function readResponse(response) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {})
    return { kind: 'contract', error: 'response_too_large' }
  }
  const reader = response.body?.getReader()
  const chunks = []
  let received = 0
  try {
    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {})
          return { kind: 'contract', error: 'response_too_large' }
        }
        chunks.push(value)
      }
    }
  } catch {
    return { kind: 'network', error: 'response_stream_failed' }
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try {
    return { kind: 'json', json: JSON.parse(new TextDecoder().decode(bytes)) }
  } catch {
    return { kind: 'contract', error: 'response_not_json' }
  }
}

async function postJson(fetchImpl, args, plan, definition) {
  assertAllowedPostPath(definition.path, plan)
  const started = Date.now()
  let response
  try {
    response = await fetchImpl(`${args.gatewayUrl}${definition.path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        cookie: args.cookie,
        'idempotency-key': `g2-3:${definition.family}:${sha256(definition.body)}`
      },
      body: JSON.stringify(definition.body),
      redirect: 'manual',
      signal: AbortSignal.timeout(args.timeoutMs)
    })
  } catch {
    return { kind: 'network', status: 0, durationMs: Date.now() - started, error: 'request_failed' }
  }
  const durationMs = Date.now() - started
  if (response.status >= 300 && response.status < 400) {
    return { kind: 'network', status: response.status, durationMs, error: 'redirect_rejected' }
  }
  const body = await readResponse(response)
  return { ...body, status: response.status, durationMs }
}

function aimsProjection(json, args) {
  const data = json?.data
  const peopleSynced = numeric(data?.peopleSync?.synced)
  if (json?.code !== 0 || !data || text(data.projectId) !== args.aimsProjectId
    || text(data.periodStart) !== args.periodStart || text(data.periodEnd) !== args.periodEnd
    || data.timeEntryRows !== 10 || data.contributionItems !== 1 || peopleSynced !== data.contributionItems) return null
  return {
    projectIdSha256: sha256(data.projectId),
    periodStart: data.periodStart,
    periodEnd: data.periodEnd,
    timeEntryRows: data.timeEntryRows,
    contributionItems: data.contributionItems,
    peopleSynced
  }
}

function financeProjection(json, args) {
  const data = json?.data
  const inputHash = text(data?.inputHash)
  if (json?.code !== 0 || !data || text(data.projectCode) !== args.projectCode
    || text(data.periodMonth) !== args.periodMonth || text(data.readinessStatus) !== 'ready'
    || !/^[a-f0-9]{64}$/.test(inputHash)
    || numeric(data.totalAllocatedCost) !== args.expectedAllocatedCost
    || !Number.isInteger(data.employeeStandardCostsSynced) || data.employeeStandardCostsSynced <= 0
    || !Number.isInteger(data.laborCostAllocationsSynced) || data.laborCostAllocationsSynced <= 0) return null
  return {
    projectCodeSha256: sha256(data.projectCode),
    periodMonth: data.periodMonth,
    readinessStatus: data.readinessStatus,
    inputHash,
    employeeStandardCostsSynced: data.employeeStandardCostsSynced,
    laborCostAllocationsSynced: data.laborCostAllocationsSynced,
    laborCostAllocationsReversed: numeric(data.laborCostAllocationsReversed),
    totalAllocatedCost: numeric(data.totalAllocatedCost),
    idempotentReplay: data.idempotentReplay === true
  }
}

function projectionWithoutReplay(projection) {
  const { idempotentReplay: _ignored, ...stable } = projection
  return stable
}

export async function runLaborCostAcceptance(args, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const plan = buildExecutionPlan(args)
  if (!args.execute) return { exitCode: 0, mode: 'preview', plan }
  if (!/^[a-f0-9]{64}$/.test(args.confirm) || args.confirm !== plan.confirmationSha256) {
    throw new AcceptanceConfigurationError('--confirm must exactly match the current preview confirmation SHA-256')
  }

  const checks = []
  const projections = new Map()
  let exitCode = 0
  let attemptedPosts = 0
  let successfulPosts = 0
  for (const definition of plan.requests) {
    attemptedPosts += 1
    const response = await postJson(fetchImpl, args, plan, definition)
    const check = {
      checkCode: definition.code,
      method: 'POST',
      pathname: definition.family === 'aims_contribution_sync'
        ? '/aims/api/v1/projects/{projectId}/people-contributions/sync'
        : definition.path,
      replayOrdinal: definition.replayOrdinal,
      requestBodySha256: sha256(definition.body),
      status: response.status,
      durationMs: response.durationMs,
      envelopeCode: Number.isInteger(response.json?.code) ? response.json.code : null,
      result: 'FAIL'
    }
    if (response.kind === 'network') {
      check.error = response.error
      exitCode = 3
    } else if (response.status === 401 || response.status === 403) {
      check.error = 'authorization_denied'
      exitCode = 4
    } else if (response.kind !== 'json' || response.status < 200 || response.status >= 300) {
      check.error = response.error || 'http_or_response_contract_failed'
      exitCode = 5
    } else {
      const projection = definition.family === 'aims_contribution_sync'
        ? aimsProjection(response.json, args)
        : financeProjection(response.json, args)
      if (!projection) {
        check.error = 'fact_contract_failed'
        exitCode = 6
      } else {
        const prior = projections.get(definition.family)
        const stableProjection = definition.family === 'finance_labor_cost_sync'
          ? projectionWithoutReplay(projection)
          : projection
        if (definition.replayOrdinal === 2
          && (!prior || JSON.stringify(prior) !== JSON.stringify(stableProjection)
            || (definition.family === 'finance_labor_cost_sync' && !projection.idempotentReplay))) {
          check.error = 'replay_contract_failed'
          exitCode = 6
        } else {
          if (definition.replayOrdinal === 1) projections.set(definition.family, stableProjection)
          check.result = 'PASS'
          check.projectionSha256 = sha256(projection)
          successfulPosts += 1
        }
      }
    }
    checks.push(check)
    if (check.result !== 'PASS') {
      exitCode = 8
      break
    }
  }

  const generatedAt = now().toISOString()
  return {
    exitCode,
    mode: 'execute',
    evidence: {
      schemaVersion: 1,
      runId: `g2-3-labor-cost-loop-${generatedAt.replaceAll(':', '').replaceAll('.', '-')}`,
      generatedAt,
      target: args.gatewayUrl,
      confirmationSha256: plan.confirmationSha256,
      status: exitCode === 0 && checks.length === 4 ? 'passed' : 'failed',
      attemptedPosts,
      successfulPosts,
      writeState: successfulPosts === 4 ? 'four_intentional_posts_completed' : 'partial_or_unknown',
      automaticRetry: false,
      rollback: 'not_attempted',
      checks
    }
  }
}

export function writeEvidence(path, evidence) {
  const absolutePath = resolve(process.cwd(), path)
  mkdirSync(dirname(absolutePath), { recursive: true })
  const temporaryPath = `${absolutePath}.tmp-${process.pid}`
  writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporaryPath, absolutePath)
  chmodSync(absolutePath, 0o600)
  return absolutePath
}

function defaultEvidencePath(date = new Date()) {
  return `build/release/g2-3-labor-cost-loop/${date.toISOString().replaceAll(':', '').replaceAll('.', '-')}.json`
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
    if (args.help) { console.info(usage()); return }
    const result = await runLaborCostAcceptance(args)
    if (result.mode === 'preview') {
      console.info(`[${SCRIPT}] PREVIEW ONLY; no network request was sent`)
      for (const item of result.plan.requests) console.info(`[${SCRIPT}] POST ${item.path} replay=${item.replayOrdinal}`)
      console.info(`[${SCRIPT}] confirmationSha256=${result.plan.confirmationSha256}`)
      return
    }
    for (const check of result.evidence.checks) {
      console.info(`[${SCRIPT}] ${check.result} ${check.checkCode} HTTP ${check.status}`)
    }
    const evidencePath = writeEvidence(args.evidenceFile || defaultEvidencePath(), result.evidence)
    console.info(`[${SCRIPT}] evidence=${evidencePath}`)
    if (result.exitCode !== 0) console.error(`[${SCRIPT}] stopped without retry or rollback; exit code ${result.exitCode}`)
    process.exitCode = result.exitCode
  } catch (error) {
    if (error instanceof AcceptanceConfigurationError) {
      console.error(`[${SCRIPT}] ${error.message}`)
      process.exitCode = 2
      return
    }
    console.error(`[${SCRIPT}] unexpected operational failure; no retry or rollback attempted`)
    process.exitCode = 3
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
