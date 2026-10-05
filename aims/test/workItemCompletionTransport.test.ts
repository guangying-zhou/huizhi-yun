/* eslint-disable @typescript-eslint/no-explicit-any -- isolated service-boundary adapter captures formal helpers. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/workItemCompletionTransport.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
function transport(mode = '') {
  const exports: any = {}, calls: any[] = []
  runInNewContext(compiled, { exports, URL, AbortSignal, crypto: { randomUUID: () => 'request-1' }, require: (name: string) => {
    if (name === 'h3') return { createError }
    if (name.endsWith('/consoleServiceBinding')) return { cloudflareEnvFromEvent: (event: any) => event.context.cloudflare?.env || event.context._platform?.cloudflare?.env || {} }
    if (name.endsWith('/tenantGatewayTrust')) return { resolveTrustedTenantGatewayContext: () => mode === 'wrong-source' ? { tenant: 'T1', deployment: 'ENTERPRISE', appCode: 'enterprise' } : { tenant: 'T1', deployment: 'AIMS', appCode: 'aims' } }
    if (name.endsWith('/serviceAppUrl')) return { resolveTrustedServiceAppRoute: () => mode === 'missing-route' ? null : { deploymentCode: 'WORKFLOW' }, resolveServiceAppBaseUrl: () => 'https://workflow.invalid' }
    if (name.endsWith('/tenantRuntimeClient')) return { buildServiceCommandRuntimeHeaders: async (args: any) => {
      calls.push({ signed: args })
      return { 'x-hzy-service-command-signature': 'signed' }
    } }
    if (name.endsWith('/serviceOidc')) return {
      trustedServiceRequestHeaders: (_event: any, target: string) => {
        calls.push({ trustedTarget: target })
        return {
          'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': 'verified-fixture',
          'x-hzy-tenant': 'T1', 'x-hzy-environment': 'test',
          'x-hzy-app-code': 'workflow', 'x-hzy-deployment': 'WORKFLOW',
          'x-forwarded-prefix': '/workflow', 'x-forwarded-host': 'tenant.example',
          'x-forwarded-proto': 'https'
        }
      },
      requestWithServiceAccessToken: async (args: any) => {
        calls.push({ token: { audience: args.audience, scope: args.scope } })
        return await args.request('aims-owned-token')
      }
    }
    if (name.endsWith('/appServiceBinding')) return { serviceAppFetch: async (_event: any, app: string, url: string, args: any) => {
      calls.push({ target: app, url, args })
      return { code: 0, data: { accepted: true } }
    } }
    throw Error(name)
  } })
  return { exports, calls }
}
const operation: any = { tenantCode: 'T1', deploymentCode: 'AIMS', idempotencyKey: 'key' }
test('hzy0 local-only delivery rejects cloud Workflow before token or service call', async () => {
  const { exports, calls } = transport()
  assert.throws(() => exports.assertLocalWorkflowCompletionTarget('https://workflow.huizhi.yun/workflow', true))
  assert.throws(() => exports.assertLocalWorkflowCompletionTarget('http://127.0.0.1:23141/workflow', true))
  assert.doesNotThrow(() => exports.assertLocalWorkflowCompletionTarget('http://127.0.0.1:23140/workflow', true))
  assert.equal(calls.length, 0)
})
test('completion transport uses aims.runtime signed identity and exact Workflow token/binding without Enterprise credentials', async () => {
  const { exports, calls } = transport()
  await exports.sendWorkItemCompletion({ headers: { 'cookie': 'caller-cookie', 'x-hzy-app-code': 'caller' } }, operation, { serviceCommand: { command: { actorUid: 'U1' } } })
  assert.equal(calls[0].token.audience, 'workflow')
  assert.equal(calls[0].token.scope, 'workflow:work-item-complete:create')
  assert.equal(calls[1].signed.sourceClientId, 'aims.runtime')
  assert.equal(calls[1].signed.sourceApp, 'aims')
  assert.equal(calls[1].signed.targetDeploymentCode, 'WORKFLOW')
  assert.equal(calls[2].trustedTarget, 'workflow')
  assert.equal(calls[3].target, 'workflow')
  const headers = calls[3].args.headers
  assert.equal(headers.authorization, 'Bearer aims-owned-token')
  assert.equal(headers['x-hzy-actor-uid'], 'U1')
  assert.equal(headers['x-hzy-gateway'], 'tenant-gateway')
  assert.equal(headers['x-hzy-gateway-token'], 'verified-fixture')
  assert.equal(headers['x-hzy-app-code'], 'workflow')
  assert.equal(headers['x-hzy-deployment'], 'WORKFLOW')
  assert.equal(headers['x-forwarded-prefix'], '/workflow')
  assert.equal(headers.cookie, undefined)
  assert.equal(calls[1].signed.requestTarget, new URL(calls[3].url).pathname)
})
test('wrong source or missing target route fail before credentials or outbound call; event-less requires explicit target deployment', async () => {
  for (const mode of ['wrong-source', 'missing-route']) {
    const { exports, calls } = transport(mode)
    await assert.rejects(exports.sendWorkItemCompletion({}, operation, {}))
    assert.equal(calls.length, 0)
  }
  const { exports, calls } = transport()
  await assert.rejects(exports.sendWorkItemCompletion(null, operation, {}))
  assert.equal(calls.length, 0)
  await assert.rejects(exports.sendWorkItemCompletion(null, operation, {}, 'WORKFLOW'))
  assert.equal(calls.length, 0)
})

test('cron uses the actual Gateway binding with workflow prefix and the same signed target; never public fallback', async () => {
  const { exports, calls } = transport()
  const sent: any[] = []
  const env = { HZY_TENANT_GATEWAY_SERVICE_URL: 'https://tenant.example', HZY_TENANT_GATEWAY_SERVICE: { async fetch(url: string, args: any) {
    sent.push({ url, args })
    return { ok: true, json: async () => ({ code: 0, data: { accepted: true } }) }
  } } }
  await exports.sendWorkItemCompletion(null, operation, { serviceCommand: { command: { actorUid: 'U1' } } }, 'WORKFLOW', { _platform: { cloudflare: { env } } })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].url, 'https://tenant.example/workflow/api/v1/service/aims-work-item-completion-approval')
  assert.equal(calls[1].signed.requestTarget, '/workflow/api/v1/service/aims-work-item-completion-approval')
  assert.equal(calls[1].signed.sourceDeploymentCode, 'AIMS')
  assert.equal(calls[1].signed.targetDeploymentCode, 'WORKFLOW')
  assert.equal(sent[0].args.headers['x-hzy-app-code'], 'workflow')
  assert.equal(sent[0].args.headers['x-hzy-deployment'], 'WORKFLOW')
  assert.equal(sent[0].args.headers['x-hzy-actor-uid'], 'U1')
  assert.equal(sent[0].args.headers['x-hzy-gateway-token'], undefined)
  assert.equal(calls.length, 2)
})

test('scheduled binding enters the real Gateway which creates Workflow trust and preserves signed command headers', async () => {
  const { default: gateway } = await import('../../deploy/cloudflare/tenant-gateway/src/index.js')
  const { exports } = transport()
  const forwarded: any[] = []
  const targetEnv = {
    HZY_ALLOWED_TENANTS: 'T1', HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'test-fixture-only',
    HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify({ domains: { 'tenant.example': { tenantCode: 'T1', deploymentCode: 'CONSOLE', environment: 'test', apps: { workflow: { deploymentCode: 'WORKFLOW' } } } } }),
    HZY_WORKFLOW_SERVICE: { async fetch(url: string, init: any) {
      forwarded.push({ url, headers: new Headers(init.headers) })
      return Response.json({ code: 0, data: { accepted: true } })
    } }
  }
  const env = { HZY_TENANT_GATEWAY_SERVICE_URL: 'https://tenant.example', HZY_TENANT_GATEWAY_SERVICE: { fetch: (url: string, init: any) => gateway.fetch(new Request(url, init), targetEnv) } }
  await exports.sendWorkItemCompletion(null, operation, { serviceCommand: { command: { actorUid: 'U1' } } }, 'WORKFLOW', { cloudflare: { env } })
  assert.equal(forwarded.length, 1)
  assert.equal(new URL(forwarded[0].url).pathname, '/workflow/api/v1/service/aims-work-item-completion-approval')
  assert.equal(forwarded[0].headers.get('x-hzy-gateway'), 'tenant-gateway')
  assert.equal(forwarded[0].headers.get('x-hzy-gateway-token'), 'test-fixture-only')
  assert.equal(forwarded[0].headers.get('x-hzy-app-code'), 'workflow')
  assert.equal(forwarded[0].headers.get('x-hzy-deployment'), 'WORKFLOW')
  assert.equal(forwarded[0].headers.get('x-forwarded-prefix'), '/workflow')
  assert.equal(forwarded[0].headers.get('x-hzy-service-command-signature'), 'signed')
  assert.equal(forwarded[0].headers.get('x-hzy-actor-uid'), 'U1')
})

test('scheduled Gateway failures preserve authorization/conflict/unavailable status and timeout without direct fallback', async () => {
  for (const status of [403, 409, 503]) {
    const { exports, calls } = transport()
    const env = { HZY_TENANT_GATEWAY_SERVICE_URL: 'https://tenant.example', HZY_TENANT_GATEWAY_SERVICE: { async fetch() {
      return Response.json({ code: status, message: 'rejected' }, { status })
    } } }
    await assert.rejects(exports.sendWorkItemCompletion(null, operation, {}, 'WORKFLOW', { cloudflare: { env } }), (error: any) => error.statusCode === status)
    assert.equal(calls.length, 2)
  }
  const { exports, calls } = transport()
  const env = { HZY_TENANT_GATEWAY_SERVICE_URL: 'https://tenant.example', HZY_TENANT_GATEWAY_SERVICE: { async fetch(_url: string, init: any) {
    assert.ok(init.signal instanceof AbortSignal)
    throw new DOMException('timed out', 'TimeoutError')
  } } }
  await assert.rejects(exports.sendWorkItemCompletion(null, operation, {}, 'WORKFLOW', { cloudflare: { env } }), (error: any) => error.name === 'TimeoutError')
  assert.equal(calls.length, 2)
})
