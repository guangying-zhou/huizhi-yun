import test from 'node:test'
import assert from 'node:assert/strict'
import { trustedNotificationDetailActor } from '../server/utils/tenantRuntimeClient.ts'

test('Enterprise owning inspection preserves the Console viewer purpose boundary', () => {
  const auth = { authenticated: true, tokenUse: 'service', subjectType: 'service', appCode: 'console', clientCode: 'console.runtime', tenant: 'T', deployment: 'T-console', scopes: ['enterprise:notification-detail:authorize'] }
  for (const domain of ['aims', 'assets'] as const) {
    const input = { event: { context: { consoleAuth: auth } } as never, tenant: 'T', path: `/v1/${domain}/notification-details/authorize`, options: { appCode: 'enterprise', notificationDetailDomain: domain, scope: `${domain}:notification-detail:authorize`, method: 'POST', notificationDetailActor: { uid: 'viewer', tenantId: 'T', deploymentId: 'T-console' } } }
    assert.equal(trustedNotificationDetailActor(input), 'viewer')
    for (const options of [
      { ...input.options, scope: `${domain}:scheduler:execute` },
      { ...input.options, appCode: 'aims' },
      { ...input.options, method: 'GET' },
      { ...input.options, notificationDetailActor: { ...input.options.notificationDetailActor, tenantId: 'other' } },
      { ...input.options, notificationDetailActor: { ...input.options.notificationDetailActor, deploymentId: 'other' } }
    ]) assert.throws(() => trustedNotificationDetailActor({ ...input, options }), { statusCode: 403 })
    assert.throws(() => trustedNotificationDetailActor({ ...input, path: `/v1/${domain}/work-items` }), { statusCode: 403 })
    assert.throws(() => trustedNotificationDetailActor({ ...input, event: { context: { consoleAuth: { ...auth, clientCode: 'aims.runtime' } } } as never }), { statusCode: 403 })
    assert.throws(() => trustedNotificationDetailActor({ ...input, event: { context: { consoleAuth: { ...auth, scopes: [`${domain}:scheduler:execute`] } } } as never }), { statusCode: 403 })
  }
})

test('explicit system channel skips every actor derivation even with a user cookie', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../server/utils/tenantRuntimeClient.ts', import.meta.url), 'utf8')
  const start = source.indexOf('  const systemChannel = options.channel === \'system\'')
  const end = source.indexOf('  let enterpriseDocumentPermitSignature', start)
  assert.ok(start > 0 && end > start)
  const names = ['trustedNotificationDetailActor', 'verifiedServiceCommandActor', 'trustedServiceCommandActor', 'trustedWorkflowProxyActor', 'currentSubjectUid', 'currentSubjectDeptCodes', 'signActorDelegation']
  const forbidden = () => {
    throw Error('system channel must never derive or sign actor')
  }
  const execute = new Function('options', 'event', ...names, `return (async () => { const path='/v1/aims/service/workflow/callback', tenant='T', deployment='D', envelope={}, token='fixture', method='POST', url=new URL('https://runtime.test/v1/aims/service/workflow/callback'); ${source.slice(start, end)} return { subjectUid, subjectDeptCodes, actorSignature }; })()`)
  const result = await execute({ channel: 'system', appCode: 'enterprise' }, { context: { uid: 'viewer' }, headers: { cookie: 'user-session' } }, ...names.map(() => forbidden))
  assert.deepEqual(result, { subjectUid: '', subjectDeptCodes: [], actorSignature: '' })
  const caller = readFileSync(new URL('../server/utils/enterpriseRuntimeChannels.ts', import.meta.url), 'utf8')
  assert.match(caller, /channel: 'system', appCode: 'enterprise'/)
})
