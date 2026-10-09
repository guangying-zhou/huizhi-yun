/* eslint-disable @typescript-eslint/no-explicit-any -- isolated verified service-auth boundary. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const compiled = ts.transpileModule(readFileSync(new URL('../server/api/v1/action-defs/sync.post.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
function fixture(source = 'enterprise', client = 'enterprise.runtime', target = 'aims', scope = 'workflow:action_defs:sync') {
  const exports: any = {}, calls: any[] = []
  runInNewContext(compiled, { exports, require(name: string) {
    if (name === 'h3') return { createError, defineEventHandler: (handler: any) => handler, readBody: async () => ({ appCode: target, actions: [] }) }
    if (name.endsWith('/consoleOidc')) return { resolveConsoleAuthContext: async () => ({ authenticated: true, subjectType: 'service', tokenUse: 'service', appCode: source, clientCode: client, scopes: [scope] }) }
    if (name.endsWith('/dataRuntime')) return { maybeCallWorkflowDataRuntime: async (_: any, path: string, options: any) => {
      calls.push({ path, options })
      return { handled: true, data: { code: 0 } }
    } }
    throw Error(name)
  } })
  return { run: () => exports.default({}), calls }
}
test('Aims definitions preserve owning app under the exact Host pair; legacy remains compatible', async () => {
  for (const [source, client] of [['enterprise', 'enterprise.runtime'], ['aims', 'aims.runtime']]) {
    const f = fixture(source, client)
    await f.run()
    assert.equal(f.calls[0].options.body.appCode, 'aims')
    assert.equal(f.calls[0].path, '/v1/workflow/action-defs/sync')
  }
})
test('Host cannot synchronize other owning apps, borrow a client or omit the exact capability', async () => {
  for (const args of [['enterprise', 'aims.runtime'], ['people', 'people.runtime'], ['enterprise', 'enterprise.runtime', 'people'], ['enterprise', 'enterprise.runtime', 'aims', 'aims:scheduler:execute']]) {
    const f = fixture(...args)
    await assert.rejects(f.run(), { statusCode: 403 })
    assert.equal(f.calls.length, 0)
  }
})
