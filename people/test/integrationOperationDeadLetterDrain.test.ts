import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8')

test('People dead-letter drain is default-off, bounded, and isolated from business claims', () => {
  const drain = read('server/utils/integrationOperationDeadLetterNotificationDrain.ts')
  const task = read('server/tasks/integrations/dead-letter-notifications.ts')
  const directory = read('server/utils/directoryLifecycleOperation.ts')
  const assets = read('server/utils/assetsOffboardingProjectionDrain.ts')

  assert.match(drain, /HZY_PEOPLE_INTEGRATION_OPERATION_DEAD_LETTER_NOTIFICATIONS_ENABLED/)
  assert.match(drain, /drainIntegrationOperationDeadLetterNotifications\('people', binding/)
  assert.match(drain, /const limit = 1/)
  assert.match(drain, /requirePeopleScheduledRuntimeBinding/)
  assert.match(drain, /people:integration_operation:execute/)
  assert.match(drain, /catch \(error\)[\s\S]*return \{ enabled: true, published: 0, closed: 0, failures: 1 \}/)
  assert.match(task, /drainPeopleIntegrationOperationDeadLetterNotifications\(\{ limit: 1 \}\)/)
  assert.doesNotMatch(directory, /drainPeopleIntegrationOperationDeadLetterNotifications/)
  assert.doesNotMatch(assets, /drainPeopleIntegrationOperationDeadLetterNotifications/)
})
