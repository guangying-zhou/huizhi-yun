import { installLocalWorkflowConsoleEgress } from '@hzy/foundation/server/utils/localWorkflowConsoleEgress'

export default defineNitroPlugin(nitro => {
  if (process.env.HZY0_WORKFLOW_LOCAL_ONLY !== 'true') return
  nitro.hooks.hook('request', event => installLocalWorkflowConsoleEgress(event, 'workflow'))
})
