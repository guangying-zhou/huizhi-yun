import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

type Options = { event?: unknown, method?: string, body?: unknown, params: { uids: string }, scope?: string, audience?: string, request: (token: string) => Promise<unknown> }
type Call = { event: unknown, url: string, options: Options }
type Fetch = (path: string, options: { method: string, event?: unknown, body: { uids: unknown[], projection?: string } }) => Promise<{ data: unknown[] }>

function adapter(failure?: number) {
  const calls: Call[] = []
  const exports: { fetchConsoleDirectoryApi?: Fetch } = {}
  const dependencies: Record<string, unknown> = {
    'h3': { getHeader: () => '' },
    './directoryActiveStatusData': {},
    './consoleRuntime': { resolveConsoleRuntimeBaseUrl: () => 'https://console.test' },
    './consoleServiceBinding': { consoleServiceFetch: async (event: unknown, url: string, options: Options) => {
      calls.push({ event, url, options })
      if (failure && calls.length === failure) throw Object.assign(Error('denied'), { statusCode: 403 })
      return { code: 0, data: options.params.uids.split(',').map((uid: string) => ({ uid, realName: '姓名' })) }
    } },
    './serviceOidc': {
      trustedServiceRequestHeaders: () => ({ trusted: 'yes' }),
      requestWithServiceAccessToken: async (options: Options) => {
        assert.equal(options.scope, 'console:directory-users:read')
        assert.equal(options.audience, 'console')
        return options.request('test-token')
      }
    }
  }
  runInNewContext(ts.transpileModule(readFileSync(new URL('../server/utils/directoryApi.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, {
    exports, require: (name: string) => {
      assert.ok(name in dependencies)
      return dependencies[name]
    }, process,
    useRuntimeConfig: () => ({ public: { appCode: 'enterprise' } }),
    createError: (input: { message: string, statusCode: number }) => Object.assign(Error(input.message), input)
  })
  return { calls, fetch: exports.fetchConsoleDirectoryApi! }
}

test('batch uses bounded exact UID shared projection with existing grant, never Console admin route', async () => {
  const { calls, fetch } = adapter()
  const event = { context: {} }
  const uids = Array.from({ length: 101 }, (_, i) => `Person${i}`)
  const result = await fetch('/users/batch', { method: 'POST', event, body: { uids: [...uids, uids[0]], projection: 'active-status' } })
  assert.equal(result.data.length, 101)
  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.equal(call.event, event)
    assert.equal(call.url, 'https://console.test/api/v1/console/service/directory/users')
    assert.deepEqual(Object.keys(call.options.params), ['uids'])
    assert.equal(call.options.body, undefined)
    assert.equal(call.options.params.uids.split(',').length <= 100, true)
  }
  const empty = await fetch('/users/batch', { method: 'POST', body: { uids: [] } })
  assert.equal(empty.data.length, 0)
  assert.equal(calls.length, 2)
})

test('batch rejects selector injection and large inputs; dependency denial never returns partial success', async () => {
  const { calls, fetch } = adapter()
  for (const uids of [['x,y'], [' x'], ['x\n'], [1], ['x'.repeat(129)], Array(1001).fill('x')]) {
    await assert.rejects(fetch('/users/batch', { method: 'POST', body: { uids } }), { statusCode: 400 })
  }
  assert.equal(calls.length, 0)
  const failing = adapter(2)
  await assert.rejects(failing.fetch('/users/batch', { method: 'POST', body: { uids: Array.from({ length: 101 }, (_, i) => `u${i}`) } }), { statusCode: 403 })
  assert.equal(failing.calls.length, 2)
})
