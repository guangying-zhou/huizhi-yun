import { requireEnvironmentAppReleaseAccess } from '~~/server/utils/environmentAppReleaseAccess'
import { queryRow, queryRows } from '~~/server/utils/db'
import { loadEnvironmentAppReleaseState } from '~~/server/utils/environmentAppReleases'
import { pinEnvironment } from '~~/server/utils/environmentAppReleaseModel'
import { ok, requireString } from '~~/server/utils/api'

export default defineEventHandler(async (event) => {
  await requireEnvironmentAppReleaseAccess(event)
  const tenant = requireString(getRouterParam(event, 'tenantCode'), 'tenantCode')
  const environment = pinEnvironment(getQuery(event).environment)
  if (!await queryRow('SELECT tenant_code FROM tenants WHERE tenant_code=?', [tenant])) throw createError({ statusCode: 404, message: '租户不存在' })
  const selection = await loadEnvironmentAppReleaseState({ queryRow, queryRows }, tenant, environment)
  const releases = await queryRows(`SELECT r.id,r.app_code AS appCode,r.release_version AS releaseVersion,r.source_tag AS sourceTag,r.release_kind AS releaseKind,r.manifest_id AS manifestId FROM platform_app_releases r JOIN platform_app_manifests m ON m.id=r.manifest_id AND m.app_code=r.app_code WHERE (r.status='released' OR (r.status='baseline' AND JSON_UNQUOTE(JSON_EXTRACT(r.baseline_source_json,'$.tenant'))=? AND JSON_UNQUOTE(JSON_EXTRACT(r.baseline_source_json,'$.environment'))=?)) AND m.status='active' ORDER BY r.app_code,r.released_at DESC,r.id DESC`, [tenant, environment])
  const audits = await queryRows('SELECT id,actor_uid AS actorUid,reason,review_hash AS reviewHash,created_at AS createdAt,old_selection_json AS oldSelection,new_selection_json AS newSelection FROM platform_environment_app_release_audits WHERE tenant_code=? AND environment=? ORDER BY id DESC LIMIT 20', [tenant, environment])
  return ok({ selection, releases, audits })
})
