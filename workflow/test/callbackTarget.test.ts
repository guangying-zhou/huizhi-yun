import test from 'node:test'
import assert from 'node:assert/strict'
import { workflowCallbackTarget } from '../server/utils/callbackTarget.ts'

test('Aims callbacks change the entire transport identity to Enterprise', () => {
  assert.deepEqual(workflowCallbackTarget('aims'), { appCode: 'enterprise', audience: 'enterprise', scope: 'enterprise:workflow-callback:execute' })
})
test('callbacks of every other app retain their original transport contract', () => {
  for (const appCode of ['codocs', 'assets', 'finance', 'people', 'altoc', 'workflow']) {
    assert.deepEqual(workflowCallbackTarget(appCode), { appCode, audience: appCode, scope: 'workflow:callback' })
  }
})
