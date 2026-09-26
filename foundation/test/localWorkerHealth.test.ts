import assert from 'node:assert/strict'
import test from 'node:test'
import { isLocalWorkerHealthRequest } from '../server/utils/localWorkerHealth.ts'

function fixture(token = 'fixture', host = '127.0.0.1:23180', method = 'GET') {
  return { method, node: { req: { method, headers: { host, 'x-hzy0-local-health': token } } } } as never
}

test('local worker probe requires pinned local process and direct loopback request', () => {
  const prior = { nodeEnv: process.env.NODE_ENV, profile: process.env.HZY0_PROFILE_PATH, token: process.env.HZY0_GATEWAY_INTERNAL_TOKEN }
  process.env.NODE_ENV = 'development'
  process.env.HZY0_PROFILE_PATH = 'hzy0-local-enterprise'
  process.env.HZY0_GATEWAY_INTERNAL_TOKEN = 'fixture'
  try {
    assert.equal(isLocalWorkerHealthRequest(fixture()), true)
    assert.equal(isLocalWorkerHealthRequest(fixture('wrong')), false)
    assert.equal(isLocalWorkerHealthRequest(fixture('fixture', 'hzy0.isme.dev')), false)
    assert.equal(isLocalWorkerHealthRequest(fixture('fixture', '127.0.0.1:23180', 'POST')), false)
    process.env.HZY0_PROFILE_PATH = 'other'
    assert.equal(isLocalWorkerHealthRequest(fixture()), false)
  } finally {
    for (const [key, value] of Object.entries({ NODE_ENV: prior.nodeEnv, HZY0_PROFILE_PATH: prior.profile, HZY0_GATEWAY_INTERNAL_TOKEN: prior.token })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
