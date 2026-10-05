import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { maybeCallTenantRuntime } from '../server/utils/tenantRuntimeClient.ts'

// The Aims company weekly summary command carries `operatorUid`, never
// `actorUid`. Its Codocs BFF therefore must not ask the shared client for a
// trusted service-command actor delegation, which only accepts `actorUid`.
const envelope = {
  operationId: '00000000-0000-4000-8000-000000000001',
  targetApp: 'codocs',
  operationCode: 'aims.company-weekly-summary.codocs-publish.v1',
  requiredCapability: 'codocs:company-weekly-summary:publish',
  idempotencyKey: 'company-weekly-summary:2026-W40',
  commandSchemaVersion: 'v1',
  commandSha256: 'a'.repeat(64),
  command: { periodKey: '2026-W40', operatorUid: 'operator-1', documentType: 'company' }
}
const aimsAuth = {
  authenticated: true, subjectType: 'service', tokenUse: 'service', appCode: 'aims', clientCode: 'aims.runtime',
  scopes: ['codocs:company-weekly-summary:publish'], tenant: 'tenant-a', deployment: 'aims-deployment'
}
const path = '/v1/codocs/service/company-weekly-summaries/2026-W40:publish'
const options = (extra: Record<string, unknown> = {}) => ({
  appCode: 'codocs', method: 'POST', scope: 'codocs.write', query: {},
  body: { serviceCommand: envelope, markdownContent: 'body', ossPath: 'p', ossVersionId: 'v', documentUrl: 'u' }, ...extra
}) as never

test('company summary Runtime call fails closed with a fixed code when an actor delegation is requested for an operatorUid command', async () => {
  const requests: Array<{ headers: Record<string, string | string[] | undefined>, body: string }> = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      requests.push({ headers: request.headers, body })
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ code: 0, data: { ok: true } }))
    })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('runtime test server did not bind')
  const config = { hzy: { tenantRuntime: { endpoint: `http://127.0.0.1:${address.port}`, token: 'short-lived-codocs-runtime-token',
    tenant: 'tenant-a', deployment: 'codocs-deployment', dataAccessMode: 'tenant-runtime' } } }
  const globals = globalThis as typeof globalThis & { useRuntimeConfig?: () => unknown }
  const originalUseRuntimeConfig = globals.useRuntimeConfig
  globals.useRuntimeConfig = () => config
  const event = (consoleAuth: Record<string, unknown>) => ({ context: { consoleAuth }, node: { req: { headers: {}, url: '/api/v1/service/company-weekly-summaries/2026-W40:publish' } } }) as never
  const warnings: string[] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) }
  try {
    await assert.rejects(
      () => maybeCallTenantRuntime(event(aimsAuth), path, options({ serviceCommandActor: { uid: 'operator-1' } })),
      error => Number((error as { statusCode?: number }).statusCode) === 403
    )
    assert.equal(requests.length, 0, 'a rejected delegation must not reach the Runtime')
    assert.ok(warnings.some(line => line.includes('"code":"service_command_actor_delegation_invalid"')))

    const result = await maybeCallTenantRuntime(event(aimsAuth), path, options())
    assert.equal(result.handled, true)
    assert.equal(requests.length, 1)
    const headers = requests[0]!.headers
    assert.equal(headers['x-hzy-service-command-source-app'], 'aims')
    assert.equal(headers['x-hzy-service-command-source-client'], 'aims.runtime')
    assert.equal(headers['x-hzy-service-command-target-app'], 'codocs')
    assert.equal(headers['x-hzy-service-command-capability'], 'codocs:company-weekly-summary:publish')
    assert.equal(headers['x-hzy-actor-uid'], undefined)
    assert.equal(headers['x-hzy-actor-signature'], undefined)
    assert.equal(JSON.parse(requests[0]!.body).serviceCommand.command.operatorUid, 'operator-1')

    warnings.length = 0
    await assert.rejects(
      () => maybeCallTenantRuntime(event({ ...aimsAuth, tokenUse: 'access', subjectType: 'user' }), path, options()),
      error => Number((error as { statusCode?: number }).statusCode) === 403
    )
    assert.ok(warnings.some(line => line.includes('"code":"service_command_source_identity_required"')))
    assert.equal(requests.length, 1)
    for (const line of warnings) assert.doesNotMatch(line, /short-lived-codocs-runtime-token|operator-1/)
  } finally {
    console.warn = originalWarn
    if (originalUseRuntimeConfig) globals.useRuntimeConfig = originalUseRuntimeConfig
    else delete globals.useRuntimeConfig
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
