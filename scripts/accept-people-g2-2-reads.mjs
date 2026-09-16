#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const SCRIPT = 'accept-people-g2-2-reads'
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const PRODUCTION_TENANT_GATEWAY_HOST = 'wiztek.huizhi.yun'
const DEFAULTS = {
  employeeUid: 'DEMO-P3P4-202607-EMP',
  assignmentCode: 'DEMO-P3P4-202607-ASN',
  rankCode: 'DEMO-P3P4-202607-P6',
  snapshotCode: 'DEMO-P3P4-202607-COST',
  periodMonth: '2026-07',
  cycleCode: 'DEMO-P3P4-202607-CYCLE',
  projectCode: 'DEMO-P3P4-202607-PROJ',
  timeoutMs: 10000
}

export class AcceptanceConfigurationError extends Error {}

export function usage() {
  return `Usage:
  pnpm run accept:people-g2-2-reads -- \\
    --base-url https://wiztek.huizhi.yun/people \\
    --cookie-env PEOPLE_ACCEPT_COOKIE \\
    [--employee-uid ${DEFAULTS.employeeUid}] \\
    [--assignment-code ${DEFAULTS.assignmentCode}] \\
    [--rank-code ${DEFAULTS.rankCode}] \\
    [--snapshot-code ${DEFAULTS.snapshotCode}] \\
    [--period-month ${DEFAULTS.periodMonth}] \\
    [--cycle-code ${DEFAULTS.cycleCode}] \\
    [--project-code ${DEFAULTS.projectCode}] \\
    [--timeout-ms ${DEFAULTS.timeoutMs}] \\
    [--evidence-file build/release/people-g2-2-reads/<timestamp>.json]

Only GET requests are sent through the supplied tenant People base URL. The
Console session cookie must be supplied through an environment variable and is
never printed or written to evidence. HTTP is rejected except for localhost
targets explicitly enabled with --allow-http. The test user needs view access
to employees, assignments, ranks, cost_snapshots, performance_cycles, and
standard_costs (the last grant exposes employee/assignment rank fields).`
}

function consumeOption(argv, index, raw) {
  const equalsIndex = raw.indexOf('=')
  const name = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw
  const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : argv[index + 1]
  if (!value || value.startsWith('--')) throw new AcceptanceConfigurationError(`missing value for --${name}`)
  return { name, value, nextIndex: equalsIndex >= 0 ? index : index + 1 }
}

export function parseArgs(argv, env = process.env) {
  const args = { ...DEFAULTS, baseUrl: '', cookie: '', evidenceFile: '', allowHttp: false, help: false }

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--') continue
    if (item === '--help' || item === '-h') {
      args.help = true
      continue
    }
    if (item === '--allow-http') {
      args.allowHttp = true
      continue
    }
    if (!item.startsWith('--')) throw new AcceptanceConfigurationError(`unexpected argument: ${item}`)

    const option = consumeOption(argv, index, item.slice(2))
    index = option.nextIndex
    switch (option.name) {
      case 'base-url': args.baseUrl = option.value; break
      case 'cookie-env': {
        const value = String(env[option.value] || '').trim()
        if (!value) throw new AcceptanceConfigurationError(`environment variable is empty: ${option.value}`)
        args.cookie = value.includes('=') ? value : `console_session=${value}`
        break
      }
      case 'employee-uid': args.employeeUid = option.value; break
      case 'assignment-code': args.assignmentCode = option.value; break
      case 'rank-code': args.rankCode = option.value; break
      case 'snapshot-code': args.snapshotCode = option.value; break
      case 'period-month': args.periodMonth = option.value; break
      case 'cycle-code': args.cycleCode = option.value; break
      case 'project-code': args.projectCode = option.value; break
      case 'timeout-ms': args.timeoutMs = Number(option.value); break
      case 'evidence-file': args.evidenceFile = option.value; break
      case 'cookie':
      case 'authorization':
        throw new AcceptanceConfigurationError(`--${option.name} is forbidden; pass credentials through --cookie-env`)
      default: throw new AcceptanceConfigurationError(`unknown option: --${option.name}`)
    }
  }

  if (args.help) return args
  if (!args.baseUrl) throw new AcceptanceConfigurationError('--base-url is required')
  if (!args.cookie) throw new AcceptanceConfigurationError('--cookie-env is required')
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1000 || args.timeoutMs > 60000) {
    throw new AcceptanceConfigurationError('--timeout-ms must be an integer between 1000 and 60000')
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.periodMonth)) {
    throw new AcceptanceConfigurationError('--period-month must use YYYY-MM')
  }

  const target = new URL(args.baseUrl)
  if (target.username || target.password || target.search || target.hash) {
    throw new AcceptanceConfigurationError('--base-url must not contain credentials, query, or fragment')
  }
  const localhost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname)
  if (localhost) {
    if (target.protocol !== 'https:' && !(args.allowHttp && target.protocol === 'http:')) {
      throw new AcceptanceConfigurationError('localhost HTTP additionally requires --allow-http')
    }
  } else {
    if (target.protocol !== 'https:') throw new AcceptanceConfigurationError('--base-url must use HTTPS')
    if (target.hostname !== PRODUCTION_TENANT_GATEWAY_HOST || target.port) {
      throw new AcceptanceConfigurationError(`--base-url must use the reviewed tenant gateway https://${PRODUCTION_TENANT_GATEWAY_HOST}/people on port 443`)
    }
  }
  target.pathname = target.pathname.replace(/\/+$/, '')
  if (target.pathname !== '/people') {
    throw new AcceptanceConfigurationError('--base-url path must be exactly /people')
  }
  args.baseUrl = target.toString().replace(/\/$/, '')
  return args
}

function text(value) {
  return String(value ?? '').trim()
}

function listItems(json) {
  const data = json?.data
  if (Array.isArray(data?.items)) return data.items
  return null
}

function validListEnvelope(json) {
  const data = json?.data
  return Number.isInteger(json?.code)
    && Number.isInteger(data?.total) && data.total >= 0
    && data?.page === 1
    && data?.pageSize === 100
    && Array.isArray(data?.items)
    && data.items.length <= data.pageSize
    && data.total >= data.items.length
}

function numeric(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function enabled(value) {
  return value === true || value === 1 || value === '1'
}

function sha256Projection(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function buildReadChecks(args) {
  const query = values => new URLSearchParams({ page: '1', page_size: '100', ...values }).toString()
  return [
    {
      code: 'people.employee',
      key: args.employeeUid,
      path: `/api/v1/employees?${query({ keyword: args.employeeUid })}`,
      match: row => text(row?.employee_uid) === args.employeeUid,
      assert: row => text(row?.employment_status) === 'active'
        && text(row?.rank_code) === args.rankCode,
      project: row => ({
        employeeUid: row.employee_uid,
        employmentStatus: row.employment_status,
        rankCode: row.rank_code
      })
    },
    {
      code: 'people.assignment',
      key: args.assignmentCode,
      path: `/api/v1/assignments?${query({ keyword: args.assignmentCode })}`,
      match: row => text(row?.assignment_code) === args.assignmentCode,
      assert: row => text(row?.employee_uid) === args.employeeUid
        && text(row?.rank_code) === args.rankCode
        && text(row?.approval_status) === 'approved'
        && Object.hasOwn(row, 'effective_to')
        && row.effective_to === null,
      project: row => ({
        assignmentCode: row.assignment_code,
        employeeUid: row.employee_uid,
        rankCode: row.rank_code,
        approvalStatus: row.approval_status
      })
    },
    {
      code: 'people.rank',
      key: args.rankCode,
      path: `/api/v1/ranks?${query({ keyword: args.rankCode })}`,
      match: row => text(row?.rank_code) === args.rankCode,
      assert: row => enabled(row?.enabled),
      project: row => ({ rankCode: row.rank_code, enabled: row.enabled })
    },
    {
      code: 'people.cost_snapshot',
      key: args.snapshotCode,
      path: `/api/v1/cost-snapshots?${query({ keyword: args.employeeUid, period_month: args.periodMonth })}`,
      match: row => text(row?.snapshot_code) === args.snapshotCode,
      assert: row => text(row?.employee_uid) === args.employeeUid
        && text(row?.period_month) === args.periodMonth
        && numeric(row?.standard_cost) === 20000
        && numeric(row?.actual_cost) === 20500
        && text(row?.assignment_code) === args.assignmentCode
        && text(row?.rank_code_snapshot) === args.rankCode,
      project: row => ({
        snapshotCode: row.snapshot_code,
        employeeUid: row.employee_uid,
        periodMonth: row.period_month,
        costBasis: row.cost_basis,
        standardRateCode: row.standard_rate_code,
        assignmentCode: row.assignment_code,
        rankCodeSnapshot: row.rank_code_snapshot
      })
    },
    {
      code: 'people.performance_cycle',
      key: args.cycleCode,
      path: `/api/v1/performance-cycles?${query({ keyword: args.cycleCode })}`,
      match: row => text(row?.cycle_code) === args.cycleCode,
      assert: row => text(row?.project_code) === args.projectCode
        && ['collecting', 'confirmed', 'closed'].includes(text(row?.status)),
      project: row => ({
        cycleCode: row.cycle_code,
        projectCode: row.project_code,
        status: row.status
      })
    }
  ]
}

async function requestJson(fetchImpl, url, { cookie = '', timeoutMs }) {
  const started = Date.now()
  let response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json', ...(cookie ? { cookie } : {}) },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (error) {
    return { kind: 'network', status: 0, durationMs: Date.now() - started, error: error instanceof Error ? error.name : 'NetworkError' }
  }

  const durationMs = Date.now() - started
  if (response.status >= 300 && response.status < 400) return { kind: 'network', status: response.status, durationMs, error: 'redirect_rejected' }
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {})
    return { kind: 'contract', status: response.status, durationMs, error: 'response_too_large' }
  }

  const chunks = []
  let received = 0
  try {
    const reader = response.body?.getReader()
    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {})
          return { kind: 'contract', status: response.status, durationMs, error: 'response_too_large' }
        }
        chunks.push(value)
      }
    }
  } catch {
    return { kind: 'network', status: response.status, durationMs, error: 'response_stream_failed' }
  }
  const bodyBytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const body = new TextDecoder().decode(bodyBytes)
  let json
  try {
    json = JSON.parse(body)
  } catch {
    return { kind: 'contract', status: response.status, durationMs, error: 'response_not_json' }
  }
  return { kind: 'http', status: response.status, durationMs, json }
}

function sanitizedTarget(baseUrl) {
  const target = new URL(baseUrl)
  return `${target.origin}${target.pathname}`
}

function sanitizedRequestPath(path) {
  const parsed = new URL(path, 'https://evidence.invalid')
  return {
    pathname: parsed.pathname,
    queryKeys: [...new Set(parsed.searchParams.keys())].sort()
  }
}

function highestPriorityExitCode(codes) {
  return [3, 4, 5, 6].find(code => codes.includes(code)) || 0
}

export async function runPeopleReadAcceptance(args, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const checks = []
  const exitCodes = []
  const anonymousPath = `/api/v1/employees?page=1&page_size=1&keyword=${encodeURIComponent(args.employeeUid)}`
  const anonymous = await requestJson(fetchImpl, `${args.baseUrl}${anonymousPath}`, { timeoutMs: args.timeoutMs })
  const anonymousPassed = anonymous.kind === 'http' && [401, 403].includes(anonymous.status)
  checks.push({
    checkCode: 'people.anonymous_blocked',
    method: 'GET',
    ...sanitizedRequestPath(anonymousPath),
    status: anonymous.status,
    durationMs: anonymous.durationMs,
    result: anonymousPassed ? 'PASS' : 'FAIL'
  })
  if (!anonymousPassed) exitCodes.push(anonymous.kind === 'network' ? 3 : anonymous.status === 401 || anonymous.status === 403 ? 4 : 5)

  for (const definition of buildReadChecks(args)) {
    const response = await requestJson(fetchImpl, `${args.baseUrl}${definition.path}`, {
      cookie: args.cookie,
      timeoutMs: args.timeoutMs
    })
    const evidence = {
      checkCode: definition.code,
      method: 'GET',
      ...sanitizedRequestPath(definition.path),
      expectedKeySha256: sha256Projection(definition.key),
      status: response.status,
      durationMs: response.durationMs,
      envelopeCode: Number.isInteger(response.json?.code) ? response.json.code : null,
      total: Number.isInteger(response.json?.data?.total) ? response.json.data.total : null,
      matchedCount: 0,
      result: 'FAIL'
    }
    if (response.kind === 'network') {
      evidence.error = response.error
      exitCodes.push(3)
    } else if (response.status === 401 || response.status === 403) {
      evidence.error = 'authorization_denied'
      exitCodes.push(4)
    } else if (response.status < 200 || response.status >= 300 || response.json?.code !== 0 || !validListEnvelope(response.json)) {
      evidence.error = 'http_or_envelope_contract_failed'
      exitCodes.push(5)
    } else {
      const items = listItems(response.json)
      if (!items) {
        evidence.error = 'list_contract_failed'
        exitCodes.push(5)
      } else {
        const matched = items.filter(definition.match)
        evidence.matchedCount = matched.length
        if (matched.length !== 1 || !definition.assert(matched[0])) {
          evidence.error = matched.length === 1 ? 'fact_assertion_failed' : 'expected_unique_fact_missing'
          exitCodes.push(6)
        } else {
          evidence.result = 'PASS'
          evidence.projectionSha256 = sha256Projection(definition.project(matched[0]))
        }
      }
    }
    checks.push(evidence)
  }

  const exitCode = highestPriorityExitCode(exitCodes)
  return {
    exitCode,
    evidence: {
      schemaVersion: 1,
      runId: `people-g2-2-reads-${now().toISOString().replaceAll(':', '').replaceAll('.', '-')}`,
      generatedAt: now().toISOString(),
      target: sanitizedTarget(args.baseUrl),
      mode: 'read_only_get',
      status: exitCode === 0 ? 'passed' : 'failed',
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
  const timestamp = date.toISOString().replaceAll(':', '').replaceAll('.', '-')
  return `build/release/people-g2-2-reads/${timestamp}.json`
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`[${SCRIPT}] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
    return
  }
  if (args.help) {
    console.info(usage())
    return
  }

  try {
    const result = await runPeopleReadAcceptance(args)
    for (const check of result.evidence.checks) {
      console.info(`[${SCRIPT}] ${check.result} ${check.checkCode} HTTP ${check.status}`)
    }
    const evidencePath = writeEvidence(args.evidenceFile || defaultEvidencePath(), result.evidence)
    console.info(`[${SCRIPT}] evidence=${evidencePath}`)
    if (result.exitCode !== 0) console.error(`[${SCRIPT}] failed with exit code ${result.exitCode}`)
    process.exitCode = result.exitCode
  } catch {
    console.error(`[${SCRIPT}] unexpected operational failure`)
    process.exitCode = 3
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
