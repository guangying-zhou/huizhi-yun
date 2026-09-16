import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Script, createContext } from 'node:vm'
import ts from 'typescript'

test('Assets metadata middleware binds route UUID after auth and supports application prefixes', async () => {
  const source = readFileSync(new URL('../server/middleware/tenant-runtime.ts', import.meta.url), 'utf8')
  const start = source.indexOf('export default defineEventHandler(')
  const end = source.indexOf('  if (/^\\/api\\/v1\\/service\\/product-documents', start)
  const helperStart = source.indexOf('function currentApiPath(')
  const helperEnd = source.indexOf('function withCurrentUser(', helperStart)
  assert.ok(start > 0 && end > start && helperEnd > helperStart)
  const body = source.slice(start, end).replace('export default ', 'globalThis.handler = ') + '\n})\n' + source.slice(helperStart, helperEnd)
  const calls: string[] = []
  let failAuth = false
  const context = createContext({
    defineEventHandler: (handler: unknown) => handler,
    getRequestURL: (event: { path: string }) => new URL(event.path, 'https://codocs.invalid'),
    ensureConsoleAuthContext: async () => {
      calls.push('auth')
      if (failAuth) throw new Error('auth unavailable')
    },
    assetsProductDocumentMetadataService: async (event: { context: { params: { uuid: string } } }) => {
      calls.push('dispatch')
      return event.context.params.uuid
    },
    createError: (input: { statusCode: number }) => Object.assign(new Error('method'), input)
  })
  new Script(ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText).runInContext(context)
  const uuid = '00000000-0000-4000-8000-000000000001'
  const event = (prefix = '', method = 'POST') => ({ path: `${prefix}/api/v1/service/assets-product-documents/${uuid}/metadata`, node: { req: { method } }, context: { params: { uuid: 'forged' } } })
  for (const prefix of ['', '/codocs']) {
    calls.length = 0
    assert.equal(await context.handler(event(prefix)), uuid)
    assert.deepEqual(calls, ['auth', 'dispatch'])
  }
  calls.length = 0
  await assert.rejects(context.handler(event('', 'GET')), (error: unknown) => (error as { statusCode: number }).statusCode === 405)
  assert.deepEqual(calls, ['auth'])
  failAuth = true
  calls.length = 0
  await assert.rejects(context.handler(event()), /auth unavailable/)
  assert.deepEqual(calls, ['auth'])
})
