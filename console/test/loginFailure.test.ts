import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { loginFailureReason, publicLoginFailure, publicLoginRequestId } from '../shared/utils/loginFailure.ts'

test('login refusals map to safe distinct messages without exposing upstream details', () => {
  const cases = [
    ['directory_identity_user_not_found', 403, 'account_inactive'],
    ['directory_identity_inactive', 403, 'account_inactive'],
    ['directory_identity_provider_conflict', 409, 'identity_conflict'],
    ['console_external_login_state_expired', 400, 'login_expired'],
    ['console_external_login_state_consumed', 400, 'login_expired'],
    ['console_external_login_binding_mismatch', 403, 'login_expired'],
    ['permission_denied', 403, 'access_denied'],
    ['', 401, 'verification_failed'], ['', 503, 'service_unavailable'], ['', 400, 'invalid_request'], ['', 500, 'login_failed']
  ] as const
  for (const [code, statusCode, reason] of cases) {
    assert.equal(loginFailureReason({ statusCode, data: { code }, message: 'secret /internal/path' }), reason)
    assert.doesNotMatch(publicLoginFailure(reason), /secret|internal|directory_identity/)
  }
  assert.equal(publicLoginFailure('account_inactive'), '账号未启用或不在组织目录中，请联系管理员')
  assert.equal(publicLoginFailure('<script>secret</script>'), publicLoginFailure('login_failed'))
  assert.equal(publicLoginRequestId(['malicious']), '')
  assert.equal(publicLoginRequestId('<script>'), '')
  assert.equal(publicLoginRequestId('00000000-0000-4000-8000-000000000000'), '00000000-0000-4000-8000-000000000000')
})

test('all browser provider callbacks use denial redirect; failure page suppresses automatic login', () => {
  for (const provider of ['cas', 'oidc', 'wecom', 'dingtalk']) {
    const source = readFileSync(new URL(`../server/api/auth/${provider}-callback.get.ts`, import.meta.url), 'utf8')
    assert.match(source, /return redirectLoginFailure\(event, error\)/)
  }
  const source = readFileSync(new URL('../app/pages/login.vue', import.meta.url), 'utf8')
  assert.match(source, /if \(hasLoginFailure.value\) return/)
  assert.match(source, /navigator.clipboard.writeText\(requestId.value\)/)
  const helper = readFileSync(new URL('../server/utils/loginFailure.ts', import.meta.url), 'utf8')
  assert.match(helper, /const requestId = randomUUID\(\)/)
  assert.doesNotMatch(helper, /error\.message|getQuery|getCookie/)
})

test('a real browser denial response redirects to a safe page and correlates its generated request number', async () => {
  const { build } = await import('esbuild')
  const { createRequire } = await import('node:module')
  const { createServer } = await import('node:http')
  const { createApp, defineEventHandler, toNodeListener, createError } = await import('h3')
  const result = await build({ entryPoints: [new URL('../server/utils/loginFailure.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['h3'], plugins: [{ name: 'public-console-url', setup(builder) {
    builder.onResolve({ filter: /^@hzy\/foundation\/server\/utils\/appUrls$/ }, () => ({ path: 'appUrls', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const resolveCurrentAppUrl = (_event, path) => "/console" + path' }))
  } }] })
  const fixture = { exports: {} as { redirectLoginFailure: (event: unknown, error: unknown) => unknown } }
  new Function('require', 'module', 'exports', result.outputFiles[0]!.text)(createRequire(import.meta.url), fixture, fixture.exports)
  const app = createApp()
  app.use(defineEventHandler(event => fixture.exports.redirectLoginFailure(event, createError({ statusCode: 403, message: 'SECRET internal path /directory/users', data: { code: 'directory_identity_user_not_found' } }))))
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address() as { port: number }
    const response = await fetch(`http://127.0.0.1:${address.port}/callback`, { redirect: 'manual' })
    assert.equal(response.status, 303)
    const location = new URL(response.headers.get('location')!, 'http://fixture.local')
    assert.equal(location.pathname, '/console/login')
    assert.equal(location.searchParams.get('login_failure'), 'account_inactive')
    assert.equal(location.searchParams.get('request_id'), response.headers.get('x-request-id'))
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.doesNotMatch(location.href, /SECRET|directory|users|token|session/)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
