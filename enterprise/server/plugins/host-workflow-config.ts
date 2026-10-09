import { resolveEnterpriseHostWorkflowConfig } from '../../shared/host-workflow-config.mjs'

// Fail closed at startup: an invalid Host Workflow topology (non-loopback,
// credentials, path, stray origin without the switch) stops the process
// before it can serve a request. Only the validated mode is logged.
export default defineNitroPlugin(() => {
  const config = resolveEnterpriseHostWorkflowConfig(process.env)
  if (config.mode === 'loopback') console.info(JSON.stringify({ event: 'enterprise-host-workflow', mode: config.mode, origin: config.origin }))
})
