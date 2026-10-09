import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

for (const page of ['data-runtime', 'connector-runtime']) {
  test(`${page} settings give every write a distinct valid idempotency key and reject unauthorized saves`, async () => {
    const source = readFileSync(new URL(`../app/pages/${page}.vue`, import.meta.url), 'utf8')
    const start = source.indexOf(page === 'data-runtime' ? 'async function saveParameters()' : 'async function saveRuntimeUrl()')
    const end = source.indexOf(page === 'data-runtime' ? 'async function triggerUpdate()' : 'onBeforeRouteLeave(', start)
    const body = source.slice(start, end)
    const calls: Array<{ url: string, options: { method: string, headers: Record<string, string> } }> = []
    const permission = { value: false }
    const compiled = ts.transpileModule(`${body}\nreturn ${page === 'data-runtime' ? 'saveParameters' : 'saveRuntimeUrl'};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText
    const save = new Function('$fetch', 'crypto', 'canEditDataRuntime', 'canEdit', 'toast', 'saving', 'runtimeApiUrl', 'packageBaseUrl', 'audience', 'refresh', 'refreshSettings', 'refreshMetadata', 'errorMessage', compiled)(
      async (url: string, options: { method: string, headers: Record<string, string> }) => { calls.push({ url, options }) },
      { randomUUID }, permission, permission, { add: () => {} }, { value: false }, { value: 'https://fixture.invalid' }, { value: 'https://fixture.invalid/packages' }, { value: 'data-runtime' },
      async () => {}, async () => {}, async () => {}, () => 'fixed failure')
    await save()
    assert.equal(calls.length, 0)
    permission.value = true
    await save()
    assert.equal(calls.length, page === 'data-runtime' ? 3 : 1)
    for (const call of calls) {
      assert.equal(call.options.method, 'PUT')
      assert.match(call.url, /^\/api\/v1\/console\/settings\/values\//)
      assert.match(call.options.headers['Idempotency-Key']!, /^[a-f0-9-]{36}$/)
    }
    assert.equal(new Set(calls.map(call => call.options.headers['Idempotency-Key'])).size, calls.length)
  })
}
