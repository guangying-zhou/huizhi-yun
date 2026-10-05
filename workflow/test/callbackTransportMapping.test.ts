import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { workflowCallbackTarget } from '../server/utils/callbackTarget.ts'

// Run the real sender; external transports and Runtime checkpoints are observed, not called.
const source = readFileSync(new URL('../server/utils/dataRuntime.ts', import.meta.url), 'utf8') + '\nexport { sendRuntimeCallbacks }\n'
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

test('actual callback sender maps Aims URL, target and capability together without changing payload or key', async () => {
  const tokens: Array<{ audience: string, scope: string }> = []
  const targets: string[] = []
  const requests: Array<{ url: string, body: unknown }> = []
  const checkpoints: Array<{ path: string, body: unknown }> = []
  const exports: Record<string, (event: unknown, callbacks: unknown[]) => Promise<unknown[]>> = {}
  runInNewContext(compiled, { exports, console, process: { env: {} }, AbortSignal, require(name: string) {
    if (name === './callbackTarget') return { workflowCallbackTarget }
    if (name === 'h3') return { getHeader: () => '' }
    if (name === 'ofetch') return { $fetch: async (url: string, init: { body: unknown }) => {
      requests.push({ url, body: init.body })
    } }
    if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_: unknown, path: string, init: { body: unknown }) => {
      checkpoints.push({ path, body: init.body })
      return { handled: true, data: { code: 0, data: {} } }
    } }
    if (name.endsWith('/serviceOidc')) return { requestServiceAccessToken: async (input: { audience: string, scope: string }) => {
      tokens.push(input)
      return 'fixture-token'
    } }
    if (name.endsWith('/serviceAppUrl')) return { resolveServiceAppBaseUrl: (_: unknown, app: string) => {
      targets.push(app)
      return `https://site.test/${app}`
    } }
    if (name.endsWith('/selfHostedServiceTransport')) return { isSelfHostedServiceTopologyEnabled: () => false }
    if (name.endsWith('/cloudflareServiceBinding')) return { tenantGatewayServiceBinding: () => null }
    if (name === './effectCheckpointTokenDenials') return { withWorkflowEffectCheckpointTokenDenial: (_: unknown, work: () => unknown) => work() }
    return {}
  } })
  const callbacks = ['aims', 'codocs', 'assets', 'workflow'].map((app, i) => ({ effectId: i + 1, versionNo: 11, url: '/api/v1/service/workflow/callback', payload: { app_code: app, event: 'flow_completed', idempotencyKey: `original:${i}` } }))
  const result = await exports.sendRuntimeCallbacks!({}, callbacks)
  assert.equal(result.length, 4)
  assert.deepEqual(targets, ['enterprise', 'codocs', 'assets', 'workflow'])
  for (const [i, callback] of callbacks.entries()) {
    const target = workflowCallbackTarget(callback.payload.app_code)
    assert.equal(requests[i]!.url, `https://site.test/${target.appCode}${callback.url}`)
    assert.equal(requests[i]!.body, callback.payload)
    assert.equal(tokens[i]!.audience, target.audience)
    assert.equal(tokens[i]!.scope, target.scope)
    assert.equal((checkpoints[i]!.body as { expectedEffectVersion: number }).expectedEffectVersion, 11)
  }
})
