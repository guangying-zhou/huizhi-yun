import { loadCodocsOssRuntimeConfigFromConsole } from '~~/server/utils/ossRuntime'

function stringValue(value: unknown) {
  return String(value || '').trim()
}

export default defineNitroPlugin(async () => {
  if (process.env.HZY_CLOUDFLARE_BUILD === 'true') {
    console.log('[Codocs Integrations] Cloudflare runtime will lazy-load OSS integration per request')
    return
  }

  const config = useRuntimeConfig() as unknown as {
    oss?: Record<string, unknown>
  }

  try {
    const integrationCode = stringValue(config.oss?.integrationCode) || 'oss.default'
    await loadCodocsOssRuntimeConfigFromConsole(integrationCode)
    console.log(`[Codocs Integrations] Loaded OSS integration ${integrationCode}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[Codocs Integrations] OSS integration unavailable: ${message}`)
  }
})
