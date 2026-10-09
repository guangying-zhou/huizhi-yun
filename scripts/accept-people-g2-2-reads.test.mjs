import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  AcceptanceConfigurationError,
  parseArgs,
  runPeopleReadAcceptance
} from './accept-people-g2-2-reads.mjs'

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('People G2-2 read acceptance CLI', () => {
  test('requires HTTPS and reads the cookie only from the named environment variable', () => {
    const args = parseArgs([
      '--base-url', 'https://wiztek.huizhi.yun/people/',
      '--cookie-env', 'PEOPLE_ACCEPT_COOKIE'
    ], { PEOPLE_ACCEPT_COOKIE: 'session-secret' })
    assert.equal(args.baseUrl, 'https://wiztek.huizhi.yun/people')
    assert.equal(args.cookie, 'console_session=session-secret')

    assert.throws(
      () => parseArgs(['--base-url', 'http://example.com/people', '--cookie-env', 'C'], { C: 'secret' }),
      AcceptanceConfigurationError
    )
    for (const rejected of [
      'https://attacker.example/people',
      'https://people.huizhi.yun/people',
      'https://console.huizhi.yun/people',
      'https://wiztek.huizhi.yun/not-people',
      'https://api.huizhi.yun/people',
      'https://downloads.huizhi.yun/people',
      'https://dev-agent-1.huizhi.yun/people',
      'https://wiztek-data-runtime.huizhi.yun/people',
      'https://nested.wiztek.huizhi.yun/people',
      'https://wiztek.huizhi.yun:444/people'
    ]) {
      assert.throws(
        () => parseArgs(['--base-url', rejected, '--cookie-env', 'C'], { C: 'secret' }),
        AcceptanceConfigurationError
      )
    }
    assert.throws(
      () => parseArgs(['--base-url', 'https://example.com/people', '--cookie', 'secret'], {}),
      /forbidden/
    )
  })

  test('accepts localhost HTTP only when explicitly enabled', () => {
    const args = parseArgs([
      '--base-url', 'http://127.0.0.1:3007/people',
      '--allow-http',
      '--cookie-env', 'C'
    ], { C: 'console_session=local' })
    assert.equal(args.baseUrl, 'http://127.0.0.1:3007/people')
  })

  test('proves all five demo facts using GET requests and emits no credential evidence', async () => {
    const requests = []
    const responses = [
      jsonResponse(401, { code: 401 }),
      jsonResponse(200, { code: 0, data: { total: 1, page: 1, pageSize: 100, items: [{ employee_uid: 'DEMO-P3P4-202607-EMP', employment_status: 'active', rank_code: 'DEMO-P3P4-202607-P6' }] } }),
      jsonResponse(200, { code: 0, data: { total: 1, page: 1, pageSize: 100, items: [{ assignment_code: 'DEMO-P3P4-202607-ASN', employee_uid: 'DEMO-P3P4-202607-EMP', rank_code: 'DEMO-P3P4-202607-P6', approval_status: 'approved', effective_to: null }] } }),
      jsonResponse(200, { code: 0, data: { total: 1, page: 1, pageSize: 100, items: [{ rank_code: 'DEMO-P3P4-202607-P6', enabled: 1 }] } }),
      jsonResponse(200, { code: 0, data: { total: 1, page: 1, pageSize: 100, items: [{ snapshot_code: 'DEMO-P3P4-202607-COST', employee_uid: 'DEMO-P3P4-202607-EMP', period_month: '2026-07', standard_cost: '20000.00', actual_cost: '20500.00', cost_basis: 'actual', standard_rate_code: 'DEMO-P3P4-202607-RATE', assignment_code: 'DEMO-P3P4-202607-ASN', rank_code_snapshot: 'DEMO-P3P4-202607-P6' }] } }),
      jsonResponse(200, { code: 0, data: { total: 1, page: 1, pageSize: 100, items: [{ cycle_code: 'DEMO-P3P4-202607-CYCLE', project_code: 'DEMO-P3P4-202607-PROJ', status: 'collecting' }] } })
    ]
    const fetchImpl = async (url, options) => {
      requests.push({ url, options })
      return responses.shift()
    }
    const args = parseArgs([
      '--base-url', 'https://wiztek.huizhi.yun/people',
      '--cookie-env', 'C'
    ], { C: 'console_session=super-secret' })
    const instant = new Date('2026-07-09T12:00:00.000Z')
    const result = await runPeopleReadAcceptance(args, { fetchImpl, now: () => instant })

    assert.equal(result.exitCode, 0)
    assert.equal(result.evidence.status, 'passed')
    assert.equal(result.evidence.checks.length, 6)
    assert.equal(result.evidence.checks.filter(check => check.result === 'PASS').length, 6)
    assert.equal(requests.every(request => request.options.method === 'GET'), true)
    assert.equal(requests[0].options.headers.cookie, undefined)
    assert.equal(requests.slice(1).every(request => request.options.headers.cookie === 'console_session=super-secret'), true)
    assert.equal(JSON.stringify(result.evidence).includes('super-secret'), false)
    assert.equal(JSON.stringify(result.evidence).includes('display_name'), false)
  })

  test('uses stable exit codes for authorization and fact failures', async () => {
    const args = parseArgs([
      '--base-url', 'https://wiztek.huizhi.yun/people',
      '--cookie-env', 'C'
    ], { C: 'secret' })
    const authorizationDenied = async () => jsonResponse(403, { code: 403 })
    const denied = await runPeopleReadAcceptance(args, { fetchImpl: authorizationDenied })
    assert.equal(denied.exitCode, 4)

    let call = 0
    const missingFacts = async () => {
      call += 1
      if (call === 1) return jsonResponse(401, { code: 401 })
      return jsonResponse(200, { code: 0, data: { total: 0, page: 1, pageSize: 100, items: [] } })
    }
    const missing = await runPeopleReadAcceptance(args, { fetchImpl: missingFacts })
    assert.equal(missing.exitCode, 6)
  })

  test('never writes custom business keys or untrusted envelope objects into evidence', async () => {
    const secretKey = 'alice@example.com'
    const args = parseArgs([
      '--base-url', 'https://wiztek.huizhi.yun/people',
      '--cookie-env', 'C',
      '--employee-uid', secretKey
    ], { C: 'secret' })
    let call = 0
    const malformed = async () => {
      call += 1
      if (call === 1) return jsonResponse(401, { code: 401 })
      return jsonResponse(200, { code: 0, data: { total: { private: 'leak-in-evidence' }, page: 1, pageSize: 100, items: [] } })
    }
    const result = await runPeopleReadAcceptance(args, { fetchImpl: malformed })
    const serialized = JSON.stringify(result.evidence)
    assert.equal(result.exitCode, 5)
    assert.equal(serialized.includes(secretKey), false)
    assert.equal(serialized.includes('leak-in-evidence'), false)
  })

  test('rejects undocumented rows/camelCase compatibility shapes', async () => {
    const args = parseArgs([
      '--base-url', 'https://wiztek.huizhi.yun/people',
      '--cookie-env', 'C'
    ], { C: 'secret' })
    let call = 0
    const compatibilityShape = async () => {
      call += 1
      if (call === 1) return jsonResponse(401, { code: 401 })
      return jsonResponse(200, {
        code: 0,
        data: { total: 1, page: 1, pageSize: 100, rows: [{ employeeUid: 'DEMO-P3P4-202607-EMP' }] }
      })
    }
    const result = await runPeopleReadAcceptance(args, { fetchImpl: compatibilityShape })
    assert.equal(result.exitCode, 5)
  })

  test('maps response stream failures and oversized streams to stable exit codes', async () => {
    const args = parseArgs([
      '--base-url', 'https://wiztek.huizhi.yun/people',
      '--cookie-env', 'C'
    ], { C: 'secret' })
    const streamFailure = async () => ({
      status: 200,
      headers: new Headers(),
      body: new ReadableStream({ pull(controller) { controller.error(new Error('secret stream reset')) } })
    })
    const failed = await runPeopleReadAcceptance(args, { fetchImpl: streamFailure })
    assert.equal(failed.exitCode, 3)
    assert.equal(JSON.stringify(failed.evidence).includes('secret stream reset'), false)

    const oversized = async () => new Response('x', {
      status: 200,
      headers: { 'content-length': String(2 * 1024 * 1024 + 1) }
    })
    const tooLarge = await runPeopleReadAcceptance(args, { fetchImpl: oversized })
    assert.equal(tooLarge.exitCode, 5)
  })

  test('rejects inconsistent pagination metadata and missing current-assignment null field', async () => {
    const args = parseArgs([
      '--base-url', 'https://wiztek.huizhi.yun/people',
      '--cookie-env', 'C'
    ], { C: 'secret' })
    let call = 0
    const inconsistentMetadata = async () => {
      call += 1
      if (call === 1) return jsonResponse(401, { code: 401 })
      return jsonResponse(200, {
        code: 0,
        data: { total: 0, page: 99, pageSize: 1, items: [{ employee_uid: 'DEMO-P3P4-202607-EMP' }] }
      })
    }
    const inconsistent = await runPeopleReadAcceptance(args, { fetchImpl: inconsistentMetadata })
    assert.equal(inconsistent.exitCode, 5)

    const responses = [
      jsonResponse(401, { code: 401 }),
      jsonResponse(200, { code: 0, data: { total: 1, page: 1, pageSize: 100, items: [{ employee_uid: 'DEMO-P3P4-202607-EMP', employment_status: 'active', rank_code: 'DEMO-P3P4-202607-P6' }] } }),
      jsonResponse(200, { code: 0, data: { total: 1, page: 1, pageSize: 100, items: [{ assignment_code: 'DEMO-P3P4-202607-ASN', employee_uid: 'DEMO-P3P4-202607-EMP', rank_code: 'DEMO-P3P4-202607-P6', approval_status: 'approved' }] } }),
      jsonResponse(200, { code: 0, data: { total: 1, page: 1, pageSize: 100, items: [{ rank_code: 'DEMO-P3P4-202607-P6', enabled: 1 }] } }),
      jsonResponse(200, { code: 0, data: { total: 1, page: 1, pageSize: 100, items: [{ snapshot_code: 'DEMO-P3P4-202607-COST', employee_uid: 'DEMO-P3P4-202607-EMP', period_month: '2026-07', standard_cost: 20000, actual_cost: 20500, assignment_code: 'DEMO-P3P4-202607-ASN', rank_code_snapshot: 'DEMO-P3P4-202607-P6' }] } }),
      jsonResponse(200, { code: 0, data: { total: 1, page: 1, pageSize: 100, items: [{ cycle_code: 'DEMO-P3P4-202607-CYCLE', project_code: 'DEMO-P3P4-202607-PROJ', status: 'collecting' }] } })
    ]
    const missingEffectiveTo = await runPeopleReadAcceptance(args, { fetchImpl: async () => responses.shift() })
    assert.equal(missingEffectiveTo.exitCode, 6)
  })
})
