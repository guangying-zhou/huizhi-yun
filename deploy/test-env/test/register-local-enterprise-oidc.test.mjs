import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = readFileSync('deploy/test-env/register-local-enterprise-oidc.mjs', 'utf8')

test('local Enterprise OIDC registration is pinned to hzy0 and never manages credentials or grants', () => {
  assert.match(source, /https:\/\/hzy0\.isme\.dev/)
  assert.match(source, /ENTERPRISE_CLIENT_CONFLICT/)
  assert.match(source, /TARGET_MISMATCH/)
  assert.doesNotMatch(source, /service_client_grants/)
  assert.doesNotMatch(source, /service_client_credentials/)
})
