import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  EnterpriseLoginAcceptanceError,
  parseArgs,
  runEnterpriseLoginAcceptance
} from './accept-enterprise-login-providers.mjs'

function json(data, status = 200) {
  return new Response(JSON.stringify({ code: status, data }), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function redirect(url) {
  return new Response(null, { status: 302, headers: { location: url } })
}

function args(extra = []) {
  return parseArgs([
    '--base-url', 'https://wiztek.huizhi.yun',
    '--primary', 'oidc',
    '--providers', 'oidc,wecom',
    ...extra
  ])
}

describe('enterprise login provider acceptance', () => {
  test('config-only mode verifies exact providers without creating login transactions', async () => {
    let calls = 0
    const evidence = await runEnterpriseLoginAcceptance(args(), {
      fetchImpl: async () => {
        calls += 1
        return json({ mode: 'oidc', enabledProviders: ['oidc', 'wecom'] })
      }
    })
    assert.equal(calls, 1)
    assert.equal(evidence.primary, 'oidc')
    assert.deepEqual(evidence.enabledProviders, ['oidc', 'wecom'])
    assert.deepEqual(evidence.startProbes, {})
  })

  test('start probes validate OIDC and both WeCom client flows', async () => {
    const responses = [
      json({ mode: 'oidc', enabledProviders: ['oidc', 'wecom'] }),
      redirect('https://sso.wiztek.cn/realms/wiztek/protocol/openid-connect/auth?state=one'),
      redirect('https://open.work.weixin.qq.com/wwopen/sso/qrConnect?state=two'),
      redirect('https://open.weixin.qq.com/connect/oauth2/authorize?state=three')
    ]
    const evidence = await runEnterpriseLoginAcceptance(args(['--probe-starts', '--oidc-host', 'sso.wiztek.cn']), {
      fetchImpl: async () => responses.shift()
    })
    assert.equal(evidence.startProbes.oidc.host, 'sso.wiztek.cn')
    assert.equal(evidence.startProbes.wecomDesktop.path, '/wwopen/sso/qrConnect')
    assert.equal(evidence.startProbes.wecomMobile.path, '/connect/oauth2/authorize')
  })

  test('rejects provider drift and public secret field names', async () => {
    await assert.rejects(
      () => runEnterpriseLoginAcceptance(args(), { fetchImpl: async () => json({ mode: 'oidc', enabledProviders: ['oidc'] }) }),
      EnterpriseLoginAcceptanceError
    )
    await assert.rejects(
      () => runEnterpriseLoginAcceptance(args(), { fetchImpl: async () => json({ mode: 'oidc', enabledProviders: ['oidc', 'wecom'], corpSecret: 'leak' }) }),
      /forbidden field corpsecret/
    )
  })

  test('invalid-state probe is explicit and requires start probes', () => {
    assert.throws(() => args(['--probe-invalid-state']), /requires --probe-starts/)
  })

  test('invalid-state probe rejects both enabled external provider callbacks', async () => {
    const configured = parseArgs([
      '--base-url', 'https://wiztek.huizhi.yun',
      '--primary', 'oidc',
      '--providers', 'oidc,wecom,dingtalk',
      '--probe-starts',
      '--probe-invalid-state',
      '--oidc-host', 'sso.wiztek.cn',
      '--dingtalk-host', 'login.dingtalk.com'
    ])
    const urls = []
    const responses = [
      json({ mode: 'oidc', enabledProviders: ['oidc', 'wecom', 'dingtalk'] }),
      redirect('https://sso.wiztek.cn/realms/wiztek/protocol/openid-connect/auth?state=one'),
      redirect('https://open.work.weixin.qq.com/wwopen/sso/qrConnect?state=two'),
      redirect('https://open.weixin.qq.com/connect/oauth2/authorize?state=three'),
      redirect('https://login.dingtalk.com/oauth2/auth?state=four'),
      new Response(null, { status: 400 }),
      new Response(null, { status: 400 })
    ]
    const evidence = await runEnterpriseLoginAcceptance(configured, {
      fetchImpl: async (url) => {
        urls.push(String(url))
        return responses.shift()
      }
    })
    assert.equal(evidence.invalidStateRejected, true)
    assert.match(urls.at(-2), /wecom-callback/)
    assert.match(urls.at(-1), /dingtalk-callback/)
  })

  test('accepts the pnpm argument separator', () => {
    assert.equal(parseArgs([
      '--', '--base-url', 'https://wiztek.huizhi.yun',
      '--primary', 'oidc', '--providers', 'oidc,wecom'
    ]).baseUrl, 'https://wiztek.huizhi.yun')
  })
})
