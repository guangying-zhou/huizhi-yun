import assert from 'node:assert/strict'
import test from 'node:test'
import { verifiedLocalWorkflowCallbackHeaders } from '../server/utils/localCallbackContext.ts'

const valid = {
  appCode: 'aims',
  context: {
    tenant: 'C000001',
    deployment: 'C000001-test-workflow-local',
    environment: 'test',
    appCode: 'workflow',
    forwardedHost: 'hzy0.isme.dev'
  },
  canonicalRuntimeUrl: 'https://hzy-test-runtime.isme.dev',
  dialUrl: 'http://127.0.0.1:18084',
  forwardedHeaders: {
    'x-hzy-gateway': 'tenant-gateway',
    'x-hzy-gateway-token': 'test-fixture',
    'x-hzy-tenant': 'C000001',
    'x-hzy-app-code': 'aims',
    'x-hzy-deployment': 'C000001-test-aims',
    'x-forwarded-prefix': '/aims'
  }
}

test('local callback carries the exact Aims target and loopback Runtime dial', () => {
  assert.deepEqual(verifiedLocalWorkflowCallbackHeaders(valid), {
    ...valid.forwardedHeaders,
    'x-hzy-local-runtime-dial-url': valid.dialUrl
  })
})

test('local callback rejects untrusted gateway or mismatched target and dial', () => {
  for (const input of [
    { ...valid, context: null },
    { ...valid, context: { ...valid.context, deployment: 'other' } },
    { ...valid, appCode: 'codocs' },
    { ...valid, dialUrl: 'https://hzy-test-runtime.isme.dev' },
    { ...valid, forwardedHeaders: { ...valid.forwardedHeaders, 'x-hzy-deployment': 'other' } },
    { ...valid, forwardedHeaders: { ...valid.forwardedHeaders, 'x-hzy-gateway-token': '' } }
  ]) {
    assert.throws(() => verifiedLocalWorkflowCallbackHeaders(input), /local_callback_(gateway_context|target_binding)_invalid/)
  }
})
