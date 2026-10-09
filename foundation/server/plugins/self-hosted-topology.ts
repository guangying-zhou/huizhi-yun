import { loadSelfHostedTopology } from '../utils/selfHostedServiceTransport'

// Validate the self-hosted loopback topology once at startup so a malformed or
// conflicting value stops the process instead of failing individual requests.
// Only the configuration error name/message is reported, never the values.
export default defineNitroPlugin(() => {
  const topology = loadSelfHostedTopology()
  if (!topology) return
  console.info('[foundation.self-hosted-topology] loopback service topology enabled', {
    services: topology.services ? Object.keys(topology.services).sort() : [],
    runtimeDial: Boolean(topology.runtime)
  })
})
