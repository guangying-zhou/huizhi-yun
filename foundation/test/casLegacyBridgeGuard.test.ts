import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function functionBody(content: string, name: string) {
  const start = content.indexOf(`export async function ${name}`)
  assert.notEqual(start, -1, `${name} must exist`)

  const next = content.indexOf('\nexport async function ', start + 1)
  return content.slice(start, next === -1 ? undefined : next)
}

test('Foundation CAS routes remain thin legacy bridge entrypoints', () => {
  for (const route of ['server/api/auth/cas-login.get.ts', 'server/api/auth/cas-callback.get.ts']) {
    const content = source(route)
    assert.match(content, /return handleCas(?:Login|Callback)\(event\)/)
  }
})

test('CAS login and callback fail closed before request data or legacy side effects by default', () => {
  const content = source('server/utils/casAuth.ts')

  assert.match(content, /getConsoleOidcConfig\(event\)\.legacyFallback/)
  assert.match(content, /statusCode: 410/)

  const login = functionBody(content, 'handleCasLogin')
  const callback = functionBody(content, 'handleCasCallback')

  for (const [name, body, sideEffects] of [
    ['login', login, ['getQuery(event)', 'buildCallbackServiceUrl(event, targetApp, redirect)', 'sendRedirect(event, loginUrl)']],
    ['callback', callback, ['getQuery(event)', 'buildCallbackServiceUrl(event, targetApp, redirect)', 'fetchExternal<string>(validateUrl', 'getUserByUid(uid)', 'setCookie(event,', 'reportLoginAudit(']]
  ] as const) {
    const guard = body.indexOf('requireExplicitLegacyAuthBridge(event)')
    assert.notEqual(guard, -1, `${name} must require explicit legacy mode`)
    for (const sideEffect of sideEffects) {
      const offset = body.indexOf(sideEffect)
      assert.notEqual(offset, -1, `${name} must retain ${sideEffect} for explicit legacy mode`)
      assert.ok(guard < offset, `${name} must guard before ${sideEffect}`)
    }
  }
})
