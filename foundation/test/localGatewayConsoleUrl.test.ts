import assert from 'node:assert/strict'
import { test } from 'node:test'
import { localGatewayConsoleUrl } from '../server/utils/localGatewayConsoleUrl'

const local = {
  enabled: 'true', nodeEnv: 'development', environment: 'test',
  consoleUrl: 'http://127.0.0.1:3000/console'
}

test('local test gateway preserves the separate Console origin and base path', () => {
  assert.equal(localGatewayConsoleUrl(local), `${local.consoleUrl}/`)
  assert.equal(localGatewayConsoleUrl({ ...local, consoleUrl: `${local.consoleUrl}/` }), `${local.consoleUrl}/`)
})

test('production, disabled and non-loopback configurations retain normal navigation', () => {
  for (const change of [
    { enabled: 'false' }, { nodeEnv: 'production' }, { environment: 'prod' },
    { consoleUrl: 'https://huizhi.yun' }, { consoleUrl: 'http://example.com' },
    { consoleUrl: 'http://user:password@127.0.0.1' },
    { consoleUrl: 'http://127.0.0.1/?redirect=other' }, { consoleUrl: 'invalid' }
  ]) assert.equal(localGatewayConsoleUrl({ ...local, ...change }), null)
})
