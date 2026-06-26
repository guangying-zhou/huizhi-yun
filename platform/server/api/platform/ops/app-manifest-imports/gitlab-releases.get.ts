import { ok, requireString } from '~~/server/utils/api'
import { getPlatformGitLabConfig, listGitLabReleases } from '~~/server/utils/gitlab'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const repoUrl = requireString(query.repoUrl, 'repoUrl')

  const config = getPlatformGitLabConfig(event)
  const releases = await listGitLabReleases(repoUrl, config)

  return ok({
    items: releases
  })
})
