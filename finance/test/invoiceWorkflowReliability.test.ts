import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('Finance target receipt reports pending Workflow delivery as HTTP 202', () => {
  const route = read('server/api/v1/finance/service/invoice-requests/create.post.ts')
  assert.match(route, /setResponseStatus\(event, workflowDelivery\.synced \? 200 : 202\)/)
})

test('Finance to Workflow uses exact capability, delegated actor and no browser credentials', () => {
  const executor = read('server/utils/altocFinanceSummaryOperation.ts')
  assert.match(executor, /audience:\s*'workflow', scope:\s*'workflow:invoice-request:create'/)
  assert.match(executor, /'x-hzy-actor-uid': actorUid/)
  assert.doesNotMatch(executor, /cookie/)
})
