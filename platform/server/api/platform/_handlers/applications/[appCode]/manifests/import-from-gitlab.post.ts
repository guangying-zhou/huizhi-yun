import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { importGitLabManifest } from '~~/server/utils/gitlabManifestImport'

export default defineEventHandler(async (event) => {
  const appCode = requireString(getRouterParam(event, 'appCode'), 'appCode')
  const body = await readBody<Record<string, unknown>>(event)
  const version = requireString(body.version, 'version')

  return ok(await importGitLabManifest({
    appCode,
    version,
    ref: normalizeNullableString(body.ref),
    tagName: normalizeNullableString(body.tagName),
    commitSha: normalizeNullableString(body.commitSha),
    manifestPath: normalizeNullableString(body.manifestPath)
  }, event))
})
