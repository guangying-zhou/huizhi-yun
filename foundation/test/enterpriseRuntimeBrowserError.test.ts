import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createServer } from 'node:http'
import { callEnterpriseRuntime, enterpriseRuntimeBrowserError } from '../server/utils/enterpriseRuntimeClient.ts'
import { setLocalServiceTokenIssuer } from '../server/utils/serviceOidc.ts'
import { enterpriseErrorMessage, safeEnterpriseErrorCode } from '../shared/utils/enterpriseBusinessError.ts'

const globals = globalThis as { useRuntimeConfig?: () => unknown }
const originalConfig = globals.useRuntimeConfig
const originalWarn = console.warn
afterEach(() => {
  globals.useRuntimeConfig = originalConfig
  console.warn = originalWarn
  setLocalServiceTokenIssuer(null)
})
const user = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
const eventFor = () => ({
  context: { consoleAuth: user },
  node: { req: { headers: { host: 'host.test' }, url: '/enterprise/api/test' } }
}) as never
const token = [Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ tenant: 'tenant-a', deployment: 'enterprise-test' })).toString('base64url'), 'test-signature'].join('.')

type BrowserFailure = { statusCode?: number, message?: string, statusMessage?: string, data?: Record<string, unknown> }

async function callAgainst(endpoint: string): Promise<BrowserFailure> {
  globals.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' }, hzy: { tenantRuntime: { endpoint, dataAccessMode: 'tenant-runtime', token: 'legacy-static-token' } } })
  setLocalServiceTokenIssuer(async () => token)
  console.warn = () => {}
  try {
    await callEnterpriseRuntime(eventFor(), 'console.directory-self-accessible-departments', {})
  } catch (error) {
    return error as BrowserFailure
  }
  return assert.fail('Runtime failure must reject')
}

function visible(error: BrowserFailure) {
  return JSON.stringify({ message: error.message, statusMessage: error.statusMessage, data: error.data })
}

test('Runtime business errors reach the browser with status and code but a fixed message', async () => {
  const server = createServer((_request, response) => {
    response.statusCode = 409
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ error: { code: 'weekly_reporting_period_required', message: 'SECRET dial tcp 10.0.0.1:3306', details: { sql: 'SECRET' } } }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const error = await callAgainst(`http://127.0.0.1:${address.port}`)
    assert.equal(error.statusCode, 409)
    assert.equal(error.data?.code, 'weekly_reporting_period_required')
    assert.equal(error.data?.upstreamStatus, 409)
    assert.equal(error.message, enterpriseErrorMessage(409))
    assert.equal(error.data?.message, enterpriseErrorMessage(409))
    assert.doesNotMatch(visible(error), /SECRET|10\.0\.0\.1|127\.0\.0\.1/)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('transport failures stay 503 without the internal Runtime address', async () => {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>(resolve => server.close(() => resolve()))
  const error = await callAgainst(`http://127.0.0.1:${address.port}`)
  assert.equal(error.statusCode, 503)
  assert.equal(error.message, enterpriseErrorMessage(503))
  assert.doesNotMatch(visible(error), /127\.0\.0\.1|v1\/enterprise|fetch failed/)
})

test('only bounded snake_case codes survive and non-HTTP errors pass through unchanged', () => {
  for (const code of ['weekly_reporting_period_required', 'forbidden', 'invalid_period_key']) assert.equal(safeEnterpriseErrorCode(code), code)
  for (const code of ['', 'Weekly_Reporting', 'a.b', 'http://x', 'eyJhbGciOiJSUzI1NiJ9', `x_${'a'.repeat(70)}`, 42, null]) assert.equal(safeEnterpriseErrorCode(code), '')
  const dropped = enterpriseRuntimeBrowserError({ statusCode: 409, data: { code: 'Bearer abc.def', upstreamStatus: 'x' } }) as BrowserFailure
  assert.deepEqual(dropped.data, { message: enterpriseErrorMessage(409) })
  const programming = new TypeError('boom')
  assert.equal(enterpriseRuntimeBrowserError(programming), programming)
})
