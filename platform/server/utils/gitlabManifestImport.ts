import { createError } from 'h3'
import type { H3Event } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString } from '~~/server/utils/api'
import { queryRow } from '~~/server/utils/db'
import { registerAppManifest } from '~~/server/utils/appManifests'
import {
  normalizeManifestPath,
  normalizeReleaseTagPrefix,
  qualifyReleaseRef,
  releaseVersionFromTag
} from '~~/server/utils/appReleaseRefs'
import {
  fetchGitLabRawFile,
  getPlatformGitLabConfig,
  resolveGitLabRefToCommitSha
} from '~~/server/utils/gitlab'

interface ApplicationRow extends RowDataPacket {
  id: number
  app_code: string
  repo_url: string | null
  manifest_path: string | null
  release_tag_prefix: string | null
}

export interface ImportGitLabManifestInput {
  appCode: string
  /** GitLab release/tag = 应用版本号，写入 platform_app_releases.release_version */
  version: string
  ref?: string | null
  tagName?: string | null
  commitSha?: string | null
  manifestPath?: string | null
}

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

function normalizeManifestJson(manifestJson: Record<string, unknown>) {
  const normalized = { ...manifestJson }
  delete normalized.version
  delete normalized.displayVersion
  return normalized
}

export async function importGitLabManifest(input: ImportGitLabManifestInput, event?: H3Event) {
  const appCode = input.appCode
  const config = getPlatformGitLabConfig(event)
  const explicitCommitSha = normalizeNullableString(input.commitSha)

  const application = await queryRow<ApplicationRow>(
    `SELECT id, app_code, repo_url, manifest_path, release_tag_prefix
     FROM platform_applications
     WHERE app_code = ?
     LIMIT 1`,
    [appCode]
  )

  if (!application) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `application not found: appCode=${appCode}` })
  }

  if (!application.repo_url) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `repoUrl is not configured: appCode=${appCode}` })
  }

  let releaseTagPrefix: string | null
  let manifestPath: string
  try {
    releaseTagPrefix = normalizeReleaseTagPrefix(application.release_tag_prefix)
    manifestPath = normalizeManifestPath(
      normalizeNullableString(input.manifestPath) || application.manifest_path,
      config.defaultManifestPath
    )
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: (error as Error).message })
  }

  const requestedVersion = input.version.trim()
  const requestedRef = normalizeNullableString(input.ref) || normalizeNullableString(input.tagName) || requestedVersion
  const ref = qualifyReleaseRef(requestedRef, releaseTagPrefix)
  const releaseVersion = releaseVersionFromTag(requestedVersion, releaseTagPrefix)

  const commitSha = explicitCommitSha || await resolveGitLabRefToCommitSha(application.repo_url, ref, config)
  const rawManifest = await fetchGitLabRawFile(application.repo_url, manifestPath, commitSha, config)
  const manifestJson = normalizeManifestJson(parseManifest(rawManifest))

  const manifestAppCode = normalizeNullableString(manifestJson.appCode)
  if (manifestAppCode && manifestAppCode !== appCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `manifest appCode mismatch: expected ${appCode}, got ${manifestAppCode}`
    })
  }

  const sourceEndpoint = `gitlab:${application.repo_url}#${commitSha}:${manifestPath}`
  const result = await registerAppManifest({
    appCode,
    releaseVersion,
    manifestJson,
    sourceType: 'gitlab_release',
    sourceEndpoint,
    sourceTag: ref,
    sourceCommitSha: commitSha,
    reviewComment: `Approved via GitLab import: release=${releaseVersion}, ref=${ref}, commit=${commitSha}`
  })

  return {
    manifest: result.manifest,
    release: result.release,
    roleMaterialization: result.roleMaterialization,
    ...(result.composition ? { composition: result.composition } : {}),
    gitlab: {
      repoUrl: application.repo_url,
      releaseVersion,
      ref,
      commitSha,
      manifestPath,
      releaseTagPrefix
    }
  }
}
