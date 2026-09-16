import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildExecutionPlan,
  DingTalkAcceptanceError,
  parseArgs,
  runDingTalkAcceptance
} from './accept-dingtalk-connector.mjs'

function json(data, status = 200) {
  return new Response(JSON.stringify({ code: status === 200 ? 0 : status, data }), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function loginConfig(providers = ['oidc']) {
  return { mode: 'oidc', enabledProviders: providers, dingtalkClientId: providers.includes('dingtalk') ? 'ding-public' : null }
}

function health() {
  return {
    status: 'ok', version: '0.4.11', runtimeProduct: 'hzy-connector-runtime',
    tenant: 'C000001', deployment: 'C000001-console', authMode: 'jwt',
    providers: ['wecom', 'dingtalk'], deliveryStore: 'ready', deliveryStoreType: 'sqlite'
  }
}

function capabilities() {
  return {
    schemaVersion: 'hzy.connector-capabilities.v1',
    runtimeProduct: 'hzy-connector-runtime',
    arbitraryHttpProxy: false,
    providers: [{
      code: 'dingtalk',
      allowedOrigins: ['https://api.dingtalk.com', 'https://oapi.dingtalk.com'],
      dynamicTargetAllowed: false,
      credentialSource: 'console-vault'
    }],
    capabilities: [
      { code: 'notifications.send', version: 'v1', method: 'POST', path: '/v1/notifications/send', requiredScope: 'connector-runtime:notifications:send' },
      { code: 'identity.dingtalk.exchange', version: 'v1', method: 'POST', path: '/v1/identity/dingtalk/exchange', requiredScope: 'connector-runtime:identity:dingtalk:exchange' },
      { code: 'people.dingtalk.sync', version: 'v1', method: 'POST', path: '/v1/people-sync-jobs', requiredScope: 'connector-runtime:people:sync' }
    ]
  }
}

function baseArgs(extra = [], env = {}) {
  return parseArgs([
    '--gateway-url', 'https://wiztek.huizhi.yun',
    '--runtime-url', 'https://connector.wiztek.cn',
    ...extra
  ], env)
}

function readOnlyFetch(calls, providers = ['oidc']) {
  return async (url, options = {}) => {
    calls.push({ url, options })
    if (url.endsWith('/api/auth/login-config')) return json(loginConfig(providers))
    if (url.endsWith('/runtime/health')) return json(health())
    if (url.endsWith('/runtime/capabilities')) return json(capabilities())
    throw new Error(`unexpected request ${url}`)
  }
}

describe('DingTalk Connector acceptance', () => {
  test('default mode performs only three read-only public/runtime checks', async () => {
    const calls = []
    const result = await runDingTalkAcceptance(baseArgs(), { fetchImpl: readOnlyFetch(calls) })
    assert.equal(result.mode, 'read-only')
    assert.equal(calls.length, 3)
    assert.equal(calls.every(call => !call.options.method || call.options.method === 'GET'), true)
    assert.equal(calls.every(call => call.options.headers.cookie === undefined), true)
    assert.equal(result.checks.runtime.arbitraryHttpProxy, false)
    assert.deepEqual(result.checks.runtime.allowedOrigins, ['https://api.dingtalk.com', 'https://oapi.dingtalk.com'])
  })

  test('rejects insecure URLs, direct credentials, and missing environment cookie', () => {
    assert.throws(
      () => baseArgs(['--runtime-url', 'http://connector.example.com']),
      /must use HTTPS/
    )
    assert.throws(() => baseArgs(['--secret', 'plaintext']), /is forbidden/)
    assert.throws(
      () => baseArgs(['--include-diagnostics', '--cookie-env', 'DINGTALK_COOKIE']),
      /environment variable is empty/
    )
  })

  test('preview is stable, sanitized, and sends no selected action', async () => {
    const extra = [
      '--change-id', 'CHG-20260715-DINGTALK',
      '--send-test', '--recipient', 'private-user-id',
      '--start-people-sync', '--cookie-env', 'DINGTALK_COOKIE'
    ]
    const args = baseArgs(extra, { DINGTALK_COOKIE: 'top-secret-session' })
    const firstPlan = buildExecutionPlan(args)
    const secondPlan = buildExecutionPlan(args)
    assert.equal(firstPlan.confirmationSha256, secondPlan.confirmationSha256)
    const calls = []
    const result = await runDingTalkAcceptance(args, { fetchImpl: readOnlyFetch(calls) })
    assert.equal(result.mode, 'preview')
    assert.equal(calls.length, 3)
    const serialized = JSON.stringify(result)
    assert.doesNotMatch(serialized, /private-user-id|top-secret-session|console_session/)
    assert.deepEqual(result.plan.actions.map(action => action.code), ['notification.send_test', 'people.sync'])
  })

  test('wrong confirmation performs read-only checks but no action', async () => {
    const args = baseArgs([
      '--change-id', 'CHG-WRONG', '--probe-login-start', '--execute', '--confirm', 'a'.repeat(64)
    ])
    const calls = []
    await assert.rejects(
      () => runDingTalkAcceptance(args, { fetchImpl: readOnlyFetch(calls) }),
      /must exactly match/
    )
    assert.equal(calls.length, 3)
  })

  test('confirmed execution calls only the fixed action allowlist and emits projections', async () => {
    const preview = baseArgs([
      '--primary', 'oidc', '--expected-providers', 'oidc,dingtalk',
      '--change-id', 'CHG-REAL-DINGTALK', '--cookie-env', 'DINGTALK_COOKIE',
      '--include-diagnostics', '--check-integration', '--activate-notifications',
      '--activate-identity', '--probe-login-start', '--send-test', '--recipient', 'ding-user-01',
      '--start-people-sync'
    ], { DINGTALK_COOKIE: 'session-secret' })
    const plan = buildExecutionPlan(preview)
    const args = { ...preview, execute: true, confirm: plan.confirmationSha256 }
    const calls = []
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, options })
      if (url.endsWith('/api/auth/login-config')) return json(loginConfig(['oidc', 'dingtalk']))
      if (url.endsWith('/runtime/health')) return json(health())
      if (url.endsWith('/runtime/capabilities')) return json(capabilities())
      if (url.endsWith('/api/v1/console/connector-runtime/diagnostics')) return json({
        runtimeProduct: 'hzy-connector-runtime', version: '0.4.11',
        metrics: { collectedAt: '2026-07-15T12:00:00Z', databaseBytes: 65536, deliveries: { succeeded: 4 }, peopleJobs: {} }
      })
      if (url.endsWith('/api/v1/console/integrations/dingtalk.default/check')) return json({ status: 'healthy', summary: { checkMode: 'dingtalk_config_vault_connector_configured' } })
      if (url.endsWith('/notification-activation')) return json({ enabled: true, version: '0.4.11' })
      if (url.endsWith('/identity-activation')) return json({ enabled: true, version: '0.4.11' })
      if (url.includes('/api/auth/dingtalk-login?')) return new Response(null, { status: 302, headers: { location: 'https://login.dingtalk.com/oauth2/auth?state=one-time' } })
      if (url.endsWith('/dingtalk-test')) return json({ status: 'sent', deliveryMode: 'connector-runtime', replayVerified: true })
      if (url.endsWith('/people-sync-jobs')) return json({ jobId: 'crj_12345678901234567890', status: 'pending' }, 202)
      throw new Error(`unexpected request ${url}`)
    }
    const result = await runDingTalkAcceptance(args, { fetchImpl })
    assert.equal(result.mode, 'execute')
    assert.deepEqual(result.actions.map(action => action.code), [
      'integration.check', 'notifications.activate', 'identity.activate',
      'login.start', 'notification.send_test', 'people.sync'
    ])
    const actionCalls = calls.filter(call => call.options.method === 'POST' || call.url.includes('/dingtalk-login?'))
    assert.deepEqual(actionCalls.map(call => new URL(call.url).pathname), [
      '/api/v1/console/integrations/dingtalk.default/check',
      '/api/v1/console/connector-runtime/notification-activation',
      '/api/v1/console/connector-runtime/identity-activation',
      '/api/auth/dingtalk-login',
      '/api/v1/console/connector-runtime/dingtalk-test',
      '/api/v1/console/connector-runtime/people-sync-jobs'
    ])
    const loginCall = actionCalls.find(call => call.url.includes('/dingtalk-login?'))
    assert.equal(loginCall.options.headers.cookie, undefined)
    assert.equal(actionCalls.filter(call => call.options.method === 'POST').every(call => call.options.headers.cookie === 'console_session=session-secret'), true)
    const serialized = JSON.stringify(result)
    assert.doesNotMatch(serialized, /ding-user-01|session-secret|console_session/)
  })

  test('fails closed on provider origin drift and public secret exposure', async () => {
    const args = baseArgs()
    const badCapabilities = capabilities()
    badCapabilities.providers[0].allowedOrigins.push('https://arbitrary.example.com')
    await assert.rejects(
      () => runDingTalkAcceptance(args, {
        fetchImpl: async (url) => {
          if (url.endsWith('/api/auth/login-config')) return json(loginConfig())
          if (url.endsWith('/runtime/health')) return json(health())
          return json(badCapabilities)
        }
      }),
      DingTalkAcceptanceError
    )
    await assert.rejects(
      () => runDingTalkAcceptance(args, {
        fetchImpl: async (url) => {
          if (url.endsWith('/api/auth/login-config')) return json({ ...loginConfig(), appSecret: 'leak' })
          if (url.endsWith('/runtime/health')) return json(health())
          return json(capabilities())
        }
      }),
      /forbidden field appsecret/
    )
  })
})
