import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('account operation audit uses event-aware Console binding without eventless fallback', async () => {
  const root = resolve(import.meta.dirname, '..')
  const tokenCalls = []
  const serviceCalls = []
  const fetchCalls = []
  const logs = []
  const event = { context: { audit: true } }
  const oldConfig = globalThis.useRuntimeConfig
  const oldFetch = globalThis.$fetch
  const oldError = console.error
  globalThis.useRuntimeConfig = receivedEvent => {
    assert.equal(receivedEvent === event || receivedEvent === undefined, true)
    return { public: { appCode: 'enterprise' }, hzy: { audit: { consoleApiUrl: receivedEvent ? 'https://event-console.test' : 'https://legacy-console.test' } } }
  }
  globalThis.$fetch = async (...args) => {
    fetchCalls.push(args)
    return { code: 0, message: 'ok', data: null }
  }
  console.error = (...args) => logs.push(args)

  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/serviceOidc')) source = 'export const requestServiceAccessToken=async input=>{globalThis.__auditTokenCalls.push(input);return "audit-token"}'
      if (specifier.endsWith('/consoleServiceBinding')) source = 'export const consoleServiceFetch=async(...args)=>{if(globalThis.__auditServiceFailure) throw globalThis.__auditServiceFailure;globalThis.__auditServiceCalls.push(args);return {code:0,message:"ok",data:null}}'
      if (specifier.endsWith('/consoleRuntime')) source = 'export const resolveConsoleRuntimeBaseUrl=config=>config?.hzy?.audit?.consoleApiUrl||""'
      if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
      let candidate
      if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
      return next(specifier, context)
    }
  })

  globalThis.__auditTokenCalls = tokenCalls
  globalThis.__auditServiceCalls = serviceCalls
  try {
    const { reportOperationAudit, reportLoginAudit } = await import('../server/utils/accountApi.ts')
    await reportOperationAudit({ sourceApp: 'enterprise', action: 'codocs.document.upload', operatorUid: 'person-a' }, { event, idempotencyKey: 'per-file-key' })
    assert.equal(tokenCalls.length, 1)
    assert.equal(tokenCalls[0].audience, 'audit')
    assert.equal(tokenCalls[0].scope, 'audit:write')
    assert.equal(tokenCalls[0].event, event)
    assert.equal(serviceCalls.length, 1)
    assert.equal(serviceCalls[0][0], event)
    assert.equal(serviceCalls[0][1], 'https://event-console.test/api/v1/operation-logs')
    assert.equal(serviceCalls[0][2].headers['Idempotency-Key'], 'per-file-key')
    assert.equal(serviceCalls[0][2].headers.Authorization, 'Bearer audit-token')
    assert.equal(fetchCalls.length, 0)

    await reportOperationAudit({ action: 'codocs.document.upload' })
    assert.equal(fetchCalls.length, 1)
    assert.equal(fetchCalls[0][0], 'https://legacy-console.test/api/v1/operation-logs')
    assert.match(fetchCalls[0][1].headers['Idempotency-Key'], /^foundation:audit:/)
    assert.equal(tokenCalls.at(-1).event, undefined)

    await reportLoginAudit({ loginType: 'sso', loginResult: 1, uid: 'person-a' })
    assert.equal(fetchCalls.length, 2)
    assert.equal(fetchCalls[1][0], 'https://legacy-console.test/api/v1/login-logs')

    globalThis.__auditServiceFailure = new Error('secret-token-and-console-url')
    const beforeFailedFetch = fetchCalls.length
    await reportOperationAudit({ action: 'codocs.document.upload' }, { event, idempotencyKey: 'failed-key' })
    assert.equal(fetchCalls.length, beforeFailedFetch)
    assert.equal(logs.at(-1)[0], '[Foundation.reportOperationAudit] failed')
    assert.equal(logs.at(-1).some(value => String(value).includes('secret-token-and-console-url')), false)
  } finally {
    if (hooks) hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    globalThis.$fetch = oldFetch
    delete globalThis.__auditTokenCalls
    delete globalThis.__auditServiceCalls
    delete globalThis.__auditServiceFailure
    console.error = oldError
  }
})
