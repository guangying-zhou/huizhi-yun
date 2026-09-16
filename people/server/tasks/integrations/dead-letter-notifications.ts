import { drainPeopleIntegrationOperationDeadLetterNotifications } from '~~/server/utils/integrationOperationDeadLetterNotificationDrain'

export default defineTask({
  meta: {
    name: 'integrations:dead-letter-notifications',
    description: 'Publishes and closes only People allowlisted integration-operation dead-letter actionables.'
  },
  async run() {
    const result = await drainPeopleIntegrationOperationDeadLetterNotifications({ limit: 1 })
    console.log('[people:integrations:dead-letter-notifications]', result)
    return { result }
  }
})
