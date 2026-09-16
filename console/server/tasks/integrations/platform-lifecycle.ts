import { drainPlatformLifecycleOperations } from '~~/server/utils/platformLifecycleOperation'
import { drainPlatformLifecycleActionables } from '~~/server/utils/platformLifecycleActionableDrain'

export default defineTask({
  meta: {
    name: 'integrations:platform-lifecycle',
    description: 'Reliably applies Console Directory lifecycle to Platform authorization.'
  },
  async run() {
    // The operation drain and notification drain intentionally remain
    // separate checkpoints: a portal outage must not roll back an already
    // fenced Platform result, and the durable outbox will retry later.
    const result = await drainPlatformLifecycleOperations()
    const actionables = await drainPlatformLifecycleActionables()
    return { result, actionables }
  }
})
