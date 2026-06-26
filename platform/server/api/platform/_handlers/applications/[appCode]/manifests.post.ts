import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { registerAppManifest } from '~~/server/utils/appManifests'

export default defineEventHandler(async (event) => {
  const appCode = requireString(getRouterParam(event, 'appCode'), 'appCode')
  const body = await readBody<Record<string, unknown>>(event)
  const version = requireString(body.version, 'version')
  const manifestJson = body.manifestJson

  if (!manifestJson || typeof manifestJson !== 'object' || Array.isArray(manifestJson)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'manifestJson must be an object' })
  }

  const sourceType = normalizeNullableString(body.sourceType) || 'admin_ui'
  const sourceEndpoint = normalizeNullableString(body.sourceEndpoint)
  const reviewComment = normalizeNullableString(body.reviewComment) || 'Approved via admin API'

  const { manifest, release, roleMaterialization } = await registerAppManifest({
    appCode,
    releaseVersion: version,
    manifestJson: manifestJson as Record<string, unknown>,
    sourceType,
    sourceEndpoint,
    reviewComment
  })

  return ok({
    id: manifest.id,
    tenantCode: manifest.tenantCode,
    appCode: manifest.appCode,
    manifestSeq: manifest.manifestSeq,
    manifestHash: manifest.manifestHash,
    manifestJson: manifest.manifestJson,
    status: manifest.status,
    createdAt: manifest.createdAt,
    release: {
      id: release.id,
      releaseVersion: release.releaseVersion,
      status: release.status
    },
    roleMaterialization
  })
})
