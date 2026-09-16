import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  AcceptanceConfigurationError,
  assertAllowedPostPath,
  buildExecutionPlan,
  parseArgs,
  runLaborCostAcceptance
} from './accept-g2-3-labor-cost-loop.mjs'

function response(status, data) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

function previewArgs(extra = [], env = {}) {
  return parseArgs([
    '--gateway-url', 'https://wiztek.huizhi.yun',
    '--aims-project-id', '42',
    ...extra
  ], env)
}

function successResponses({ replay = true } = {}) {
  const aims = {
    code: 0,
    data: {
      projectId: '42',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
      timeEntryRows: 10,
      contributionItems: 1,
      peopleSync: { synced: 1, privateEmployeeName: 'must-not-leak' }
    }
  }
  const finance = idempotentReplay => ({
    code: 0,
    data: {
      projectCode: 'DEMO-P3P4-202607-PROJ',
      periodMonth: '2026-07',
      readinessStatus: 'ready',
      inputHash: 'a'.repeat(64),
      employeeStandardCostsSynced: 1,
      laborCostAllocationsSynced: 1,
      laborCostAllocationsReversed: 0,
      totalAllocatedCost: '7180.00',
      idempotentReplay,
      privateDownstreamResponse: 'must-not-leak'
    }
  })
  return [response(200, aims), response(200, aims), response(200, finance(false)), response(200, finance(replay))]
}

describe('G2-3 Cloudflare labor-cost loop acceptance CLI', () => {
  test('defaults to a zero-network preview with a stable confirmation digest', async () => {
    const args = previewArgs()
    let calls = 0
    const first = await runLaborCostAcceptance(args, { fetchImpl: async () => { calls += 1 } })
    const second = await runLaborCostAcceptance(args, { fetchImpl: async () => { calls += 1 } })
    assert.equal(first.mode, 'preview')
    assert.equal(calls, 0)
    assert.equal(first.plan.confirmationSha256, second.plan.confirmationSha256)
    assert.equal(first.plan.requests.length, 4)
    assert.deepEqual(first.plan.requests.map(item => item.family), [
      'aims_contribution_sync',
      'aims_contribution_sync',
      'finance_labor_cost_sync',
      'finance_labor_cost_sync'
    ])
  })

  test('requires the reviewed gateway and environment-only cookie for execution', () => {
    assert.throws(
      () => previewArgs(['--execute', '--confirm', 'a'.repeat(64)]),
      /--cookie-env is required/
    )
    assert.throws(
      () => parseArgs(['--gateway-url', 'https://attacker.example', '--aims-project-id', '42']),
      AcceptanceConfigurationError
    )
    assert.throws(
      () => previewArgs(['--cookie', 'secret']),
      /forbidden/
    )
    assert.throws(
      () => parseArgs(['--gateway-url', 'https://wiztek.huizhi.yun', '--aims-project-id', '../finance']),
      /safe path segment/
    )
    const local = parseArgs([
      '--gateway-url', 'http://127.0.0.1:3000', '--allow-http', '--aims-project-id', '42'
    ])
    assert.equal(local.gatewayUrl, 'http://127.0.0.1:3000')
  })

  test('requires exact second confirmation before sending a POST', async () => {
    const args = previewArgs([
      '--execute', '--confirm', 'a'.repeat(64), '--cookie-env', 'C'
    ], { C: 'secret' })
    let calls = 0
    await assert.rejects(
      () => runLaborCostAcceptance(args, { fetchImpl: async () => { calls += 1 } }),
      /exactly match/
    )
    assert.equal(calls, 0)
  })

  test('executes exactly the two whitelisted POST families twice and emits only projections', async () => {
    const preview = previewArgs()
    const confirmation = buildExecutionPlan(preview).confirmationSha256
    const args = previewArgs([
      '--execute', '--confirm', confirmation, '--cookie-env', 'C'
    ], { C: 'console_session=super-secret' })
    const responses = successResponses()
    const requests = []
    const result = await runLaborCostAcceptance(args, {
      fetchImpl: async (url, options) => {
        requests.push({ url, options })
        return responses.shift()
      },
      now: () => new Date('2026-07-09T12:00:00.000Z')
    })
    assert.equal(result.exitCode, 0)
    assert.equal(result.evidence.status, 'passed')
    assert.equal(result.evidence.successfulPosts, 4)
    assert.equal(requests.length, 4)
    assert.equal(requests.every(item => item.options.method === 'POST'), true)
    assert.deepEqual(requests.map(item => new URL(item.url).pathname), [
      '/aims/api/v1/projects/42/people-contributions/sync',
      '/aims/api/v1/projects/42/people-contributions/sync',
      '/finance/api/v1/finance/project-accounting/sync-people-costs',
      '/finance/api/v1/finance/project-accounting/sync-people-costs'
    ])
    assert.equal(requests.every(item => item.options.headers.cookie === 'console_session=super-secret'), true)
    assert.equal(requests[0].options.headers['idempotency-key'], requests[1].options.headers['idempotency-key'])
    assert.equal(requests[2].options.headers['idempotency-key'], requests[3].options.headers['idempotency-key'])
    assert.notEqual(requests[0].options.headers['idempotency-key'], requests[2].options.headers['idempotency-key'])
    const serialized = JSON.stringify(result.evidence)
    assert.equal(serialized.includes('super-secret'), false)
    assert.equal(serialized.includes('must-not-leak'), false)
    assert.equal(serialized.includes('privateDownstreamResponse'), false)
    assert.equal(result.evidence.automaticRetry, false)
    assert.equal(result.evidence.rollback, 'not_attempted')
  })

  test('hard-rejects any third POST path', () => {
    const plan = buildExecutionPlan(previewArgs())
    assert.doesNotThrow(() => assertAllowedPostPath(plan.requests[0].path, plan))
    assert.throws(
      () => assertAllowedPostPath('/people/api/v1/service/contributions:sync', plan),
      /not in the two-endpoint whitelist/
    )
  })

  test('stops immediately after a write failure and never retries or claims rollback', async () => {
    const preview = previewArgs()
    const args = previewArgs([
      '--execute', '--confirm', buildExecutionPlan(preview).confirmationSha256, '--cookie-env', 'C'
    ], { C: 'secret' })
    let calls = 0
    const result = await runLaborCostAcceptance(args, {
      fetchImpl: async () => { calls += 1; return response(503, { code: 503, message: 'private failure' }) }
    })
    assert.equal(calls, 1)
    assert.notEqual(result.exitCode, 0)
    assert.equal(result.evidence.successfulPosts, 0)
    assert.equal(result.evidence.automaticRetry, false)
    assert.equal(result.evidence.rollback, 'not_attempted')
    assert.equal(JSON.stringify(result.evidence).includes('private failure'), false)
  })

  test('rejects a Finance replay that is not explicitly idempotent', async () => {
    const preview = previewArgs()
    const args = previewArgs([
      '--execute', '--confirm', buildExecutionPlan(preview).confirmationSha256, '--cookie-env', 'C'
    ], { C: 'secret' })
    const responses = successResponses({ replay: false })
    const result = await runLaborCostAcceptance(args, { fetchImpl: async () => responses.shift() })
    assert.equal(result.exitCode, 8)
    assert.equal(result.evidence.checks.at(-1).error, 'replay_contract_failed')
    assert.equal(result.evidence.status, 'failed')
  })
})
