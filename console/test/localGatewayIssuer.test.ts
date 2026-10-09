import assert from 'node:assert/strict'
import { test } from 'node:test'
import { localGatewayIssuer } from '../server/utils/localGatewayIssuer.ts'

const fixture = { enabled: true, nodeEnv: 'development', profile: 'dev', environment: 'test',
  configuredIssuer: 'http://127.0.0.1:3000/console', forwardedHost: '127.0.0.1:3000',
  forwardedProto: 'http', forwardedPrefix: '/console' }
test('explicit test gateway preserves configured loopback issuer and path', () => {
  assert.equal(localGatewayIssuer(fixture), fixture.configuredIssuer)
})
test('production, untrusted origin shape and mismatched forwarded context do not use local issuer', () => {
  for (const override of [{ enabled: false }, { nodeEnv: 'production' }, { profile: 'self-hosted' },
    { environment: 'prod' }, { configuredIssuer: 'http://hzy.wiztek.cn/console' },
    { configuredIssuer: 'http://user:password@127.0.0.1:3000/console' },
    { forwardedHost: 'evil.test' }, { forwardedProto: 'https' }, { forwardedPrefix: '/people' }]) {
    assert.equal(localGatewayIssuer({ ...fixture, ...override }), '')
  }
})
