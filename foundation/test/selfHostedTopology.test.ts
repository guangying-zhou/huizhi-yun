import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseSelfHostedLoopbackOrigin,
  parseSelfHostedTopology,
  selfHostedRuntimeDialEndpoint,
  SelfHostedTopologyConfigError
} from '../shared/utils/selfHostedTopology.ts'

const services = JSON.stringify({
  console: 'http://127.0.0.1:3000',
  enterprise: 'http://127.0.0.1:3010',
  workflow: 'http://[::1]:3020',
  aims: 'http://127.0.0.2:3002/'
})
const runtime = {
  HZY_SELF_HOSTED_RUNTIME_ENDPOINT: 'https://runtime.example.test',
  HZY_SELF_HOSTED_RUNTIME_DIAL_ORIGIN: 'http://127.0.0.1:18084'
}

describe('self-hosted topology configuration', () => {
  test('absent configuration keeps every existing mode unchanged', () => {
    assert.equal(parseSelfHostedTopology({}), null)
    assert.equal(parseSelfHostedTopology({ HZY0_LOCAL_ENTERPRISE: 'true', HZY_CLOUDFLARE_BUILD: 'true' }), null)
  })

  test('accepts exact loopback origins and normalizes the Runtime mapping', () => {
    const topology = parseSelfHostedTopology({ HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON: services, ...runtime })
    assert.deepEqual(topology?.services, {
      console: 'http://127.0.0.1:3000',
      enterprise: 'http://127.0.0.1:3010',
      workflow: 'http://[::1]:3020',
      aims: 'http://127.0.0.2:3002'
    })
    assert.deepEqual(topology?.runtime, { canonicalEndpoint: 'https://runtime.example.test', dialOrigin: 'http://127.0.0.1:18084' })
    assert.ok(Object.isFrozen(topology) && Object.isFrozen(topology?.services))
  })

  test('service origins and Runtime mapping are independent', () => {
    assert.equal(parseSelfHostedTopology({ HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON: services })?.runtime, null)
    assert.equal(parseSelfHostedTopology(runtime)?.services, null)
  })

  test('rejects non-loopback, implicit-port, credentialed or path-bearing origins without echoing them', () => {
    for (const bad of [
      'https://127.0.0.1:3000', 'http://localhost:3000', 'http://10.0.0.8:3000', 'http://0.0.0.0:3000',
      'http://127.1:3000', 'http://2130706433:3000', 'http://127.0.0.1', 'http://127.0.0.1:80',
      'http://user@127.0.0.1:3000', 'http://user:secret-value@127.0.0.1:3000', 'http://127.0.0.1:3000/console',
      'http://127.0.0.1:3000?x=1', 'http://127.0.0.1:3000#f', 'HTTP://127.0.0.1:3000', '//127.0.0.1:3000',
      'http://127.0.0.256:3000', 'http://127.00.0.1:3000', '', 42
    ]) {
      assert.throws(() => parseSelfHostedLoopbackOrigin(bad, 'X'), (error: unknown) => {
        assert.ok(error instanceof SelfHostedTopologyConfigError)
        assert.doesNotMatch(error.message, /secret-value|10\.0\.0\.8|localhost/)
        return true
      }, String(bad))
    }
  })

  test('rejects malformed, unknown-app or console-less service maps', () => {
    for (const raw of [
      'not-json', '[]', 'null', '"x"',
      JSON.stringify({ enterprise: 'http://127.0.0.1:3010' }),
      JSON.stringify({ console: 'http://127.0.0.1:3000', platform: 'http://127.0.0.1:3011' }),
      JSON.stringify({ console: 'http://127.0.0.1:3000', workflow: 'https://workflow.example.test' }),
      JSON.stringify({ console: 'http://127.0.0.1:3000', pad: 'x'.repeat(5000) })
    ]) {
      assert.throws(() => parseSelfHostedTopology({ HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON: raw }), SelfHostedTopologyConfigError, raw.slice(0, 40))
    }
  })

  test('Runtime mapping requires both halves, a canonical HTTPS endpoint and a loopback dial', () => {
    assert.throws(() => parseSelfHostedTopology({ HZY_SELF_HOSTED_RUNTIME_ENDPOINT: runtime.HZY_SELF_HOSTED_RUNTIME_ENDPOINT }), /set together/)
    assert.throws(() => parseSelfHostedTopology({ HZY_SELF_HOSTED_RUNTIME_DIAL_ORIGIN: runtime.HZY_SELF_HOSTED_RUNTIME_DIAL_ORIGIN }), /set together/)
    for (const endpoint of ['http://runtime.example.test', 'https://127.0.0.1:18084', 'https://localhost', 'https://u:p@runtime.example.test', 'https://runtime.example.test/?a=1', 'https://runtime.example.test#x', 'nope']) {
      assert.throws(() => parseSelfHostedTopology({ ...runtime, HZY_SELF_HOSTED_RUNTIME_ENDPOINT: endpoint }), SelfHostedTopologyConfigError, endpoint)
    }
    assert.throws(() => parseSelfHostedTopology({ ...runtime, HZY_SELF_HOSTED_RUNTIME_DIAL_ORIGIN: 'https://runtime.example.test' }), SelfHostedTopologyConfigError)
  })

  test('never combines with hzy0 local flags or Cloudflare builds', () => {
    for (const flag of ['HZY0_LOCAL_ENTERPRISE', 'HZY0_WORKFLOW_LOCAL_ONLY', 'HZY0_LOCAL_CONSOLE_FACADE']) {
      assert.throws(() => parseSelfHostedTopology({ HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON: services, [flag]: 'true' }), /hzy0/)
      assert.throws(() => parseSelfHostedTopology({ ...runtime, [flag]: 'true' }), /hzy0/)
    }
    for (const flag of ['HZY_CLOUDFLARE_BUILD', 'HZY_CLOUDFLARE_RUNTIME']) {
      assert.throws(() => parseSelfHostedTopology({ HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON: services, [flag]: 'true' }), /Cloudflare/)
    }
  })
})

describe('self-hosted Runtime dial mapping', () => {
  test('maps only the configured canonical endpoint and keeps its path', () => {
    const topology = parseSelfHostedTopology(runtime)
    assert.equal(selfHostedRuntimeDialEndpoint(topology, 'https://runtime.example.test'), 'http://127.0.0.1:18084')
    assert.equal(selfHostedRuntimeDialEndpoint(topology, 'https://runtime.example.test/'), 'http://127.0.0.1:18084')
    const withPath = parseSelfHostedTopology({ ...runtime, HZY_SELF_HOSTED_RUNTIME_ENDPOINT: 'https://runtime.example.test/agent/' })
    assert.equal(selfHostedRuntimeDialEndpoint(withPath, 'https://runtime.example.test/agent'), 'http://127.0.0.1:18084/agent')
  })

  test('a different Runtime endpoint fails closed instead of dialing a public Runtime', () => {
    const topology = parseSelfHostedTopology(runtime)
    for (const other of ['https://other-runtime.example.test', 'https://runtime.example.test/other', 'http://runtime.example.test', 'not a url']) {
      assert.throws(() => selfHostedRuntimeDialEndpoint(topology, other), SelfHostedTopologyConfigError, other)
    }
  })

  test('without a Runtime mapping the canonical endpoint is returned unchanged', () => {
    assert.equal(selfHostedRuntimeDialEndpoint(null, 'https://runtime.example.test'), 'https://runtime.example.test')
    const servicesOnly = parseSelfHostedTopology({ HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON: services })
    assert.equal(selfHostedRuntimeDialEndpoint(servicesOnly, 'https://runtime.example.test'), 'https://runtime.example.test')
  })
})
