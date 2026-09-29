import { installLocalCodocsConsoleEgress } from '@hzy/foundation/server/utils/localCodocsConsoleEgress'

export default defineNitroPlugin((nitro) => {
  if (process.env.HZY0_CODOCS_LOCAL_ONLY !== 'true') return
  nitro.hooks.hook('request', event => installLocalCodocsConsoleEgress(event))
})
