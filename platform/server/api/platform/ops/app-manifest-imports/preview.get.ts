import { createError } from 'h3'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import {
  fetchGitLabRawFile,
  getPlatformGitLabConfig,
  resolveGitLabRefToCommitSha
} from '~~/server/utils/gitlab'

function parseManifest(raw: string): Record<string, unknown> {
  try {
    const manifest = JSON.parse(raw)
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('manifest root must be an object')
    }
    return manifest as Record<string, unknown>
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `invalid app manifest JSON: ${(error as Error).message}`
    })
  }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const repoUrl = requireString(query.repoUrl, 'repoUrl')
  const ref = requireString(query.ref, 'ref')
  const config = getPlatformGitLabConfig(event)
  const manifestPath = normalizeNullableString(query.manifestPath) || config.defaultManifestPath

  const commitSha = await resolveGitLabRefToCommitSha(repoUrl, ref, config)
  const rawManifest = await fetchGitLabRawFile(repoUrl, manifestPath, commitSha, config)
  const manifestJson = parseManifest(rawManifest)

  return ok({
    manifestJson,
    gitlab: {
      repoUrl,
      ref,
      commitSha,
      manifestPath
    }
  })
})
