import test from 'node:test'
import assert from 'node:assert/strict'
import { workflowCallbackTarget } from '../server/utils/callbackTarget.ts'

test('Aims callbacks change the entire transport identity to Enterprise', () => {
  assert.deepEqual(workflowCallbackTarget('aims'), { appCode: 'enterprise', audience: 'enterprise', scope: 'enterprise:workflow-callback:execute' })
})
test('callbacks of every other app retain their original transport contract', () => {
  for (const appCode of ['codocs', 'assets', 'finance', 'altoc', 'workflow']) {
    assert.deepEqual(workflowCallbackTarget(appCode), { appCode, audience: appCode, scope: 'workflow:callback' })
  }
})

test('Altoc uses Enterprise only for the two complete tuples and exact frozen path', () => {
  const expected = { appCode: 'enterprise', audience: 'enterprise', scope: 'enterprise:workflow-callback:execute' }
  for (const resource of ['quotation', 'contract']) assert.deepEqual(workflowCallbackTarget('altoc', resource, 'approve', '/api/v1/service/workflow/callback'), expected)
  for (const [resource, action, path] of [
    ['customer', 'approve', '/api/v1/service/workflow/callback'],
    ['quotation', 'edit', '/api/v1/service/workflow/callback'],
    ['contract', 'approve', '/api/v1/service/workflow/callback?x=1'],
    ['contract', 'approve', 'https://evil.invalid/api/v1/service/workflow/callback']
  ]) assert.deepEqual(workflowCallbackTarget('altoc', resource, action, path), { appCode: 'altoc', audience: 'altoc', scope: 'workflow:callback' })
})

test('People maps only assignments/change at its frozen callback path to Enterprise', () => {
  const path = '/api/v1/service/workflow/callback'
  const legacy = { appCode: 'people', audience: 'people', scope: 'workflow:callback' }
  assert.deepEqual(workflowCallbackTarget('people', 'assignments', 'change', path), { appCode: 'enterprise', audience: 'enterprise', scope: 'enterprise:workflow-callback:execute' })
  for (const resource of ['performance_cycle', 'performance_cycles', 'cycle', 'onboarding', 'unknown', 'assignment', 'people_assignment', '']) {
    assert.deepEqual(workflowCallbackTarget('people', resource, 'change', path), legacy)
    assert.deepEqual(workflowCallbackTarget('people', resource, 'approve', path), legacy)
  }
  for (const action of ['approve', 'unknown', '']) assert.deepEqual(workflowCallbackTarget('people', 'assignments', action, path), legacy)
  for (const invalid of [path + '/more', path + '?x=1', 'https://evil.invalid' + path, '']) assert.deepEqual(workflowCallbackTarget('people', 'assignments', 'change', invalid), legacy)
  assert.deepEqual(workflowCallbackTarget('assets', 'assignments', 'change', path), { appCode: 'assets', audience: 'assets', scope: 'workflow:callback' })
})

test('Finance only invoices/request and its two exact legacy relative paths map to Host', () => {
  const expected = { appCode: 'enterprise', audience: 'enterprise', scope: 'enterprise:workflow-callback:execute', deliveryPath: '/api/v1/service/workflow/callback' }
  const legacy = { appCode: 'finance', audience: 'finance', scope: 'workflow:callback' }
  for (const path of ['/api/v1/finance/workflow/callback', '/finance/api/v1/finance/workflow/callback']) {
    assert.deepEqual(workflowCallbackTarget('finance', 'invoices', 'request', path), expected)
    for (const invalid of [path + '?', path + '#', path + '/more', 'https://evil.invalid' + path]) assert.deepEqual(workflowCallbackTarget('finance', 'invoices', 'request', invalid), legacy)
  }
  for (const action of ['unknown']) assert.deepEqual(workflowCallbackTarget('finance', 'expenses', action, '/api/v1/finance/workflow/callback'), legacy)
  assert.deepEqual(workflowCallbackTarget('finance', 'invoices', 'approve', '/api/v1/finance/workflow/callback'), legacy)
})

test('APF13a claims and project expenses use two exact legacy paths; payment maps exactly', () => {
  for (const action of ['claim', 'project_expense', 'payment']) for (const path of ['/api/v1/finance/workflow/callback', '/finance/api/v1/finance/workflow/callback']) {
    assert.equal(workflowCallbackTarget('finance', 'expenses', action, path).deliveryPath, '/api/v1/service/workflow/callback')
    for (const raw of [path + '?', path + '/extra', 'https://evil.invalid' + path]) assert.equal(workflowCallbackTarget('finance', 'expenses', action, raw).appCode, 'finance')
    assert.equal(workflowCallbackTarget('altoc', 'expenses', action, path).appCode, 'altoc')
  }
})
