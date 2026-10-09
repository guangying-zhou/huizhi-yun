import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { queryRow } from '~~/server/utils/db'
import { getPlatformGitLabConfig, listGitLabReleases } from '~~/server/utils/gitlab'

interface ApplicationReleaseSourceRow extends RowDataPacket {
  repo_url: string | null
  manifest_path: string
  release_tag_prefix: string | null
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const appCode = normalizeNullableString(query.appCode)
  let repoUrl: string
  let manifestPath = normalizeNullableString(query.manifestPath)
  let releaseTagPrefix = normalizeNullableString(query.releaseTagPrefix)

  if (appCode) {
    const application = await queryRow<ApplicationReleaseSourceRow>(
      `SELECT repo_url, manifest_path, release_tag_prefix
       FROM platform_applications
       WHERE app_code = ?
       LIMIT 1`,
      [appCode]
    )
    if (!application) {
      throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `application not found: appCode=${appCode}` })
    }
    repoUrl = requireString(application.repo_url, 'application.repoUrl')
    manifestPath = application.manifest_path
    releaseTagPrefix = application.release_tag_prefix
  } else {
    repoUrl = requireString(query.repoUrl, 'repoUrl')
  }

  const config = getPlatformGitLabConfig(event)
  const releases = await listGitLabReleases(repoUrl, config, releaseTagPrefix)

  return ok({
    items: releases,
    source: {
      repoUrl,
      manifestPath: manifestPath || config.defaultManifestPath,
      releaseTagPrefix
    }
  })
})
