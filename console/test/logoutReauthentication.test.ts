import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function functions(path: string, names: string[]) {
  const raw = readFileSync(new URL(path, import.meta.url), 'utf8')
  const source = raw.includes('<script') ? raw.split('<script setup lang="ts">')[1]!.split('</script>')[0]! : raw
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text))
  assert.equal(selected.length, names.length)
  return ts.transpileModule(selected.map(node => node.getText(ast)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
}

test('restart retains reauthentication intent, starts the provider and preserves the destination', async () => {
  const route = { query: { redirect: '/aims/', logged_out: '1' } as Record<string, string> }
  const marker = { value: '1' as string | null }
  const redirects: string[] = []
  const context = {
    URLSearchParams, route, logoutMarker: marker, loggedOut: { get value() { return marker.value === '1' || route.query.logged_out === '1' } },
    loginError: { value: '' }, config: { public: { appCode: 'console' } },
    availableProviders: { value: ['oidc'] }, hasLoginMethod: () => true,
    loadLoginConfig: async () => {}, providerLabel: () => 'SSO',
    resolveRedirectUrl: () => route.query.redirect, resolveCurrentAppUrl: (s: string) => s,
    redirectingProvider: { value: null }, redirecting: { value: false },
    navigator: { userAgent: 'browser' },
    navigateTo: async (target: { query: Record<string, string> }) => { route.query = target.query },
    window: { location: { assign: (s: string) => redirects.push(s) } },
    restartLogin: undefined as undefined | (() => Promise<void>)
  }
  runInNewContext(functions('../app/pages/login.vue', ['restartLogin', 'startLocalLogin', 'startProviderLogin']), context)
  await context.restartLogin!()
  assert.equal(marker.value, null)
  assert.equal(route.query.prompt, 'login')
  assert.equal(redirects.length, 1)
  const target = new URL(redirects[0]!, 'https://tenant.test')
  assert.equal(target.pathname, '/api/auth/oidc-login')
  assert.equal(target.searchParams.get('prompt'), 'login')
  assert.equal(target.searchParams.get('redirect'), '/aims/')
})

test('upstream forces credentials only for explicit reauthentication or a confirmed post-logout start', async () => {
  for (const sample of [
    { query: {}, marker: false, forced: false },
    { query: { force: '1' }, marker: false, forced: false },
    { query: { prompt: 'login' }, marker: false, forced: true },
    { query: { force: '1' }, marker: true, forced: true },
    { query: {}, marker: true, blocked: true }
  ]) {
    const exports: { startUpstreamOidcLogin?: (event: object) => Promise<string> } = {}
    runInNewContext(functions('../server/utils/upstreamOidc.ts', ['startUpstreamOidcLogin']), {
      exports, URL, URLSearchParams, getQuery: () => sample.query,
      resolveConfig: async () => ({ authorizationEndpoint: 'https://idp.test/authorize', clientId: 'console', redirectUri: 'https://tenant.test/callback', scope: 'openid' }),
      requireUsableConfig: () => {}, sanitizeRedirect: () => '/aims/', getTargetApp: () => 'aims',
      hasConsoleLogoutMarker: () => sample.marker, randomToken: () => 'random', getCookieOptions: () => ({}),
      setCookie: () => {}, cookies: {}, createPkceChallenge: () => 'challenge', sendRedirect: (_: unknown, url: string) => url
    })
    const target = new URL(await exports.startUpstreamOidcLogin!({}), 'https://tenant.test')
    if (sample.blocked) { assert.equal(target.pathname, '/login'); continue }
    assert.equal(target.hostname, 'idp.test')
    assert.equal(target.searchParams.get('prompt'), sample.forced ? 'login' : null)
    assert.equal(target.searchParams.get('max_age'), sample.forced ? '0' : null)
    assert.equal(target.searchParams.get('code_challenge_method'), 'S256')
    assert.ok(target.searchParams.get('state'))
    assert.ok(target.searchParams.get('nonce'))
  }
})
