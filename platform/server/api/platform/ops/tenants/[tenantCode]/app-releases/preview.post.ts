import { requireEnvironmentAppReleaseAccess } from '~~/server/utils/environmentAppReleaseAccess'
import { previewEnvironmentAppReleases } from '~~/server/utils/environmentAppReleasePreview'
import { ok, requireString } from '~~/server/utils/api'

export default defineEventHandler(async (event) => {
  await requireEnvironmentAppReleaseAccess(event)
  const preview = await previewEnvironmentAppReleases(requireString(getRouterParam(event, 'tenantCode'), 'tenantCode'), await readBody(event))
  return ok(preview.result)
})
