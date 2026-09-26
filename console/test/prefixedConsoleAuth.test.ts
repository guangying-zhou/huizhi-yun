import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../../foundation/server/middleware/console-auth.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText

for (const base of ['/', '/console/']) {
  for (const path of ['/oauth/userinfo', '/oauth/introspect', '/api/internal/policy-bundle/sync', '/api/v1/console/user/permissions', '/api/private']) {
    test(`${base} mount preserves the handler boundary for ${path}`, async () => {
      let genericCalls = 0
      const event = { context: {} as Record<string, unknown> }
      const exports: { default?: (event: unknown) => Promise<void> } = {}
      const dependencies = {
        'h3': { getRequestURL: () => new URL(`https://fixture.test${base.slice(0, -1)}${path}`),
          getHeader: () => 'Bearer fixture', setResponseStatus: () => {} },
        'jose': { decodeJwt: () => ({ token_use: 'access' }) },
        '../utils/consoleSessionBridge': {
          resolveConsoleAuthWithSessionBridge: async () => {
            genericCalls++
            return { authenticated: true }
          }
        }
      }
      new Function('require', 'exports', 'defineEventHandler', 'useRuntimeConfig', compiled)(
        (name: keyof typeof dependencies) => dependencies[name], exports,
        (handler: unknown) => handler, () => ({ app: { baseURL: base }, public: { appCode: 'console' } })
      )
      await exports.default!(event)
      assert.equal(genericCalls, path === '/api/private' ? 1 : 0)
      if (path !== '/api/private') assert.equal((event.context.consoleAuth as { authenticated: boolean }).authenticated, false)
    })
  }
}

test('a foreign prefix cannot select an introspection bypass', async () => {
  const code = source.slice(source.indexOf('  const requestPath ='), source.indexOf('  const isAuthApi ='))
  const js = ts.transpile(`${code}\nreturn pathname`, { target: ts.ScriptTarget.ES2022 })
  const path = new Function('event', 'getRequestURL', 'useRuntimeConfig', js)(
    {}, () => new URL('https://fixture.test/foreign/oauth/userinfo'), () => ({ app: { baseURL: '/console/' } })
  )
  assert.equal(path, '/foreign/oauth/userinfo')
})

for (const [path, method, calls] of [
  ['/enterprise/_nuxt/module.js', 'GET', 0],
  ['/enterprise/_nuxt/module.js', 'HEAD', 0],
  ['/api/_nuxt_icon/lucide.json', 'GET', 0],
  ['/api/_nuxt_icon/lucide.json', 'POST', 1],
  ['/api/_nuxt_icon/private', 'GET', 1],
  ['/api/directory/users', 'GET', 1],
  ['/aims/api/v1/projects', 'GET', 1],
  ['/enterprise/_nuxt-extra/private', 'GET', 1]
] as const) {
  test(`public resources avoid session lookup without exempting ${method} ${path}`, async () => {
    let actual = 0
    const exports: { default?: (event: unknown) => Promise<void> } = {}
    const dependencies = {
      'h3': { getRequestURL: () => new URL(`https://fixture.test${path}`), getHeader: () => '', setResponseStatus: () => {} },
      'jose': { decodeJwt: () => ({}) },
      '../utils/consoleSessionBridge': { resolveConsoleAuthWithSessionBridge: async () => {
        actual++
        return { authenticated: true }
      } }
    }
    new Function('require', 'exports', 'defineEventHandler', 'useRuntimeConfig', compiled)(
      (name: keyof typeof dependencies) => dependencies[name], exports,
      (handler: unknown) => handler, () => ({ app: { baseURL: '/', buildAssetsDir: '/enterprise/_nuxt/' } })
    )
    await exports.default!({ context: {}, method })
    assert.equal(actual, calls)
  })
}
