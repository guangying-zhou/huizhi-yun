import { ensurePlatformSigningKey } from '~~/server/utils/platformSigning'

export default defineNitroPlugin(async () => {
  const runtimeConfig = useRuntimeConfig()
  const securityConfig = runtimeConfig.security || {}
  const isProduction = process.env.NODE_ENV === 'production'

  try {
    await ensurePlatformSigningKey({
      allowGenerateDevKey: !isProduction,
      keyDir: securityConfig.platformSigningKeyDir
        ? String(securityConfig.platformSigningKeyDir)
        : null
    })
  } catch (error) {
    if (isProduction) {
      throw error
    }

    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[platform] signing key initialization skipped: ${message}`)
  }
})
