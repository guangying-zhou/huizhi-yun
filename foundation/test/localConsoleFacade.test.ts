import assert from 'node:assert/strict'
import test from 'node:test'
import { localConsoleFacadeIdentity } from '../server/utils/localConsoleFacade'

const fixture = () => ({ enabled: true, nodeEnv: 'development', proto: 'https',
  context: { tenant: 'C000001', environment: 'test', appCode: 'console',
    deployment: 'wiztek-test-console', forwardedHost: 'hzy0.isme.dev' } })
test('local facade separates endpoint and issuer only for exact trusted deployment', () => {
  const result = localConsoleFacadeIdentity(fixture())
  assert.deepEqual(result, { issuer: 'https://hzy-test.huizhi.yun', publicEndpointBaseUrl: 'https://hzy0.isme.dev/console' })
  const input = fixture()
  input.context.appCode = 'enterprise'
  input.context.deployment = 'C000001-test-enterprise'
  assert.deepEqual(localConsoleFacadeIdentity(input), result)
  input.context.appCode = 'collab'
  input.context.deployment = 'C000001-test-collab'
  assert.deepEqual(localConsoleFacadeIdentity(input), result)
  for (const [appCode, deployment] of [['aims', 'C000001-test-aims'], ['workflow', 'C000001-test-workflow-local']]) {
    input.context.appCode = appCode
    input.context.deployment = deployment
    assert.throws(() => localConsoleFacadeIdentity(input))
    assert.deepEqual(localConsoleFacadeIdentity({ ...input, workflowLocal: true }), result)
    input.context.deployment = 'wrong'
    assert.throws(() => localConsoleFacadeIdentity({ ...input, workflowLocal: true }))
  }
})
test('ordinary mode is unchanged and enabled mode fails closed outside binding', () => {
  assert.equal(localConsoleFacadeIdentity({ ...fixture(), enabled: false, context: null }), null)
  for (const change of [{ nodeEnv: 'production' }, { proto: 'http' }, { context: null }]) {
    assert.throws(() => localConsoleFacadeIdentity({ ...fixture(), ...change }))
  }
  for (const change of [{ tenant: 'other' }, { environment: 'prod' }, { appCode: 'assets' },
    { forwardedHost: 'evil.test' }, { deployment: 'other' }]) {
    const input = fixture()
    Object.assign(input.context, change)
    assert.throws(() => localConsoleFacadeIdentity(input))
  }
  const collab = fixture()
  collab.context.appCode = 'collab'
  assert.throws(() => localConsoleFacadeIdentity(collab))
})
