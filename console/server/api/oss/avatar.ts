import OSS from 'ali-oss'
import type { H3Event } from 'h3'
import { getIntegration } from '~~/server/utils/integrations'
import { resolveVaultSecret } from '~~/server/utils/vault'

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function getConfigValue(config: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = config[key]
    if (value !== undefined && value !== null && stringValue(value)) {
      return stringValue(value)
    }
  }
  return ''
}

async function resolveOssIntegration(event: H3Event) {
  const integrationCode = process.env.HZY_OSS_INTEGRATION_CODE || 'oss.default'
  const integration = await getIntegration(integrationCode)

  if (!integration || integration.status !== 'active' || integration.integrationType !== 'oss') {
    throw createError({
      statusCode: 503,
      statusMessage: 'OSS_INTEGRATION_MISSING',
      message: `OSS integration ${integrationCode} is not active`
    })
  }

  const credential = integration.currentCredential
  if (!credential?.secretRef && !credential?.secretCode) {
    throw createError({
      statusCode: 503,
      statusMessage: 'OSS_CREDENTIAL_MISSING',
      message: `OSS integration ${integrationCode} has no active credential`
    })
  }

  const config = integration.config || {}
  const accessKeyId = getConfigValue(config, ['accessKeyId'])
  const bucket = getConfigValue(config, ['bucketName', 'bucket'])
  const endpoint = getConfigValue(config, ['endpoint']) || stringValue(integration.baseUrl)
  const region = getConfigValue(config, ['region'])

  if (!accessKeyId || !bucket || !endpoint) {
    throw createError({
      statusCode: 503,
      statusMessage: 'OSS_INTEGRATION_INCOMPLETE',
      message: `OSS integration ${integrationCode} requires accessKeyId, bucketName and endpoint`
    })
  }

  const secret = await resolveVaultSecret({
    event,
    secretRef: credential.secretRef || undefined,
    secretCode: credential.secretRef ? undefined : credential.secretCode,
    actor: {
      actorType: 'system',
      actorId: 'console:oss-avatar-proxy',
      appCode: 'console'
    },
    purpose: `oss_avatar_proxy:${integrationCode}`
  })

  return {
    bucket,
    endpoint: /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`,
    accessKeyId,
    accessKeySecret: secret.value,
    region: region || undefined
  }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const avatarPath = String(query.path || '').trim()

  if (!avatarPath) {
    throw createError({
      statusCode: 400,
      message: 'Missing avatar path'
    })
  }

  try {
    const oss = await resolveOssIntegration(event)
    const client = new OSS({
      bucket: oss.bucket,
      endpoint: oss.endpoint,
      accessKeyId: oss.accessKeyId,
      accessKeySecret: oss.accessKeySecret,
      region: oss.region
    })
    const result = await client.get(`avatars/${avatarPath}`)
    const headers = result.res.headers as Record<string, string>

    setHeader(event, 'Content-Type', headers['content-type'] || 'image/png')
    setHeader(event, 'Cache-Control', 'public, max-age=86400')

    return result.content
  } catch (err: unknown) {
    const error = err as { code?: string, message?: string }
    if (error.code === 'NoSuchKey') {
      throw createError({
        statusCode: 404,
        statusMessage: 'AVATAR_NOT_FOUND',
        message: 'Avatar not found'
      })
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'AVATAR_FETCH_FAILED',
      message: error.message || 'Failed to fetch avatar'
    })
  }
})
