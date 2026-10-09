import { requireEnvironmentAppReleaseAccess } from '~~/server/utils/environmentAppReleaseAccess'
import { withTransaction } from '~~/server/utils/db'
import { previewEnvironmentAppReleases } from '~~/server/utils/environmentAppReleasePreview'
import { saveEnvironmentAppSelection } from '~~/server/utils/environmentAppReleases'
import { ok, requireString } from '~~/server/utils/api'

export default defineEventHandler(async (event) => {
  await requireEnvironmentAppReleaseAccess(event, true)
  const tenant = requireString(getRouterParam(event, 'tenantCode'), 'tenantCode')
  const body = await readBody(event)
  const preview = await previewEnvironmentAppReleases(tenant, body)
  if (!body.reviewHash || body.reviewHash !== preview.result.reviewHash) throw createError({ statusCode: 409, message: '预览已变化，请重新查看完整差异' })
  const result = await withTransaction(tx => saveEnvironmentAppSelection(tx, { tenant, environment: preview.environment, actor: String(event.context.platformUid || ''), reason: String(body.reason || ''), expectedRevision: body.expectedRevision, selection: preview.selection, reviewHash: body.reviewHash, reviewEvidence: { diff: preview.result.diff, review: preview.result.review, sensitiveConfigurationChanged: preview.result.sensitiveConfigurationChanged } }))
  return ok(result)
})
