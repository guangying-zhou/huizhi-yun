import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../server/utils/requestIdentity.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText

function load(input: { cookie?: string, verify?: (token: string) => Promise<Record<string, unknown>> }) {
  const calls = { verify: [] as string[], session: 0 }
  const exports: { requireConsoleRequestUid?: (event: unknown) => Promise<string> } = {}
  const dependencies: Record<string, unknown> = {
    '~~/server/utils/authSession': {
      readConsoleSessionCookie: () => input.cookie || '',
      resolveConsoleSession: async () => {
        calls.session++
        if (!input.cookie) throw Object.assign(new Error('Console login required'), { statusCode: 401 })
        return { uid: 'session-user' }
      }
    },
    '~~/server/utils/consoleSessionActor': {
      consoleSessionActorContext: (session: { uid: string }) => ({ authenticated: true, uid: session.uid, source: 'session' })
    },
    '~~/server/utils/oidc': {
      verifyAccessToken: async (_event: unknown, token: string) => {
        calls.verify.push(token)
        return input.verify ? await input.verify(token) : { sub: 'user:app-user', hzy: { uid: 'app-user' } }
      }
    }
  }
  new Function('require', 'exports', compiled)((name: string) => dependencies[name], exports)
  return { requireConsoleRequestUid: exports.requireConsoleRequestUid!, calls }
}

const bypass = { authenticated: false, reason: 'bypass', token: 'app-token', tokenUse: 'access', subjectType: 'user' }

test('a middleware bypass carrying an app access token is verified by Console', async () => {
  const { requireConsoleRequestUid, calls } = load({})
  const event = { context: { consoleAuth: { ...bypass } } }
  assert.equal(await requireConsoleRequestUid(event), 'app-user')
  assert.deepEqual(calls.verify, ['app-token'])
  assert.equal(calls.session, 0)
  assert.equal((event.context.consoleAuth as { authenticated: boolean, uid: string }).authenticated, true)
  assert.equal((event.context.consoleAuth as { uid: string }).uid, 'app-user')
})

test('Console session cookie wins over a bypass token', async () => {
  const { requireConsoleRequestUid, calls } = load({ cookie: 'session-cookie' })
  assert.equal(await requireConsoleRequestUid({ context: { consoleAuth: { ...bypass } } }), 'session-user')
  assert.deepEqual(calls.verify, [])
})

test('tokens that did not come through the registered bypass are never accepted', async () => {
  for (const consoleAuth of [
    { ...bypass, reason: 'oidc' },
    { ...bypass, tokenUse: 'service', subjectType: 'service' },
    { ...bypass, token: '' },
    undefined
  ]) {
    const { requireConsoleRequestUid, calls } = load({})
    await assert.rejects(requireConsoleRequestUid({ context: { consoleAuth } }), { statusCode: 401 })
    assert.deepEqual(calls.verify, [])
  }
})

test('a rejected app access token is not replaced by any fallback', async () => {
  const { requireConsoleRequestUid, calls } = load({
    verify: async () => { throw Object.assign(new Error('invalid_token'), { statusCode: 401 }) }
  })
  await assert.rejects(requireConsoleRequestUid({ context: { consoleAuth: { ...bypass } } }), { statusCode: 401 })
  assert.equal(calls.session, 0)
})
