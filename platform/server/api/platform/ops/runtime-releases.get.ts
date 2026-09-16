import type { RowDataPacket } from 'mysql2/promise'
import { ok, parsePagination } from '~~/server/utils/api'
import { dataRuntimeReleaseSettings, dataRuntimeReleaseStaticSettings } from '~~/server/utils/dataRuntimeRelease'
import { fetchVerifiedDataRuntimeRelease, listDataRuntimeReleases } from '~~/server/utils/dataRuntimeReleaseRegistry'
import { queryRows } from '~~/server/utils/db'

interface RuntimeVersionRow extends RowDataPacket {
  current_version: string | null
  desired_version: string
  status: string
  instance_count: number
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object') {
    if ('data' in error && error.data && typeof error.data === 'object' && 'message' in error.data) {
      return String(error.data.message || '')
    }
    if ('message' in error) return String(error.message || '')
  }
  return 'Unable to read the latest Data Runtime release'
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'private, no-store, max-age=0')
  setResponseHeader(event, 'pragma', 'no-cache')
  const { page, pageSize, offset } = parsePagination(getQuery(event))
  const [settings, releases, runtimeRows] = await Promise.all([
    dataRuntimeReleaseSettings(),
    listDataRuntimeReleases(pageSize, offset),
    queryRows<RuntimeVersionRow[]>(
      `SELECT current_version, desired_version, status, COUNT(*) AS instance_count
       FROM tenant_runtime_instances
       GROUP BY current_version, desired_version, status
       ORDER BY instance_count DESC, current_version DESC`
    )
  ])
  const staticSettings = dataRuntimeReleaseStaticSettings()

  let latestPackage: Record<string, unknown>
  try {
    const latest = await fetchVerifiedDataRuntimeRelease({
      version: 'latest',
      packageBaseUrl: staticSettings.packageBaseUrl,
      releasePublicKeyPem: staticSettings.releasePublicKeyPem,
      releaseSigningKeyId: staticSettings.releaseSigningKeyId
    })
    latestPackage = {
      available: true,
      version: latest.version,
      commit: latest.commit,
      builtAt: latest.builtAt,
      manifestHash: latest.manifestHash,
      releaseSigningKeyId: latest.releaseSigningKeyId,
      synchronized: releases.items.some(item => item.version === latest.version && item.manifestHash === latest.manifestHash)
    }
  } catch (error) {
    latestPackage = { available: false, error: errorMessage(error) }
  }

  const versions = runtimeRows.map(row => ({
    currentVersion: row.current_version,
    desiredVersion: row.desired_version,
    status: row.status,
    count: Number(row.instance_count || 0)
  }))
  const total = versions.reduce((sum, item) => sum + item.count, 0)
  const aligned = versions
    .filter(item => item.currentVersion === settings.approvedVersion)
    .reduce((sum, item) => sum + item.count, 0)

  return ok({
    channel: {
      code: 'stable',
      approvedVersion: settings.approvedVersion,
      approvalKind: settings.approvalKind,
      approvedAt: settings.approvedAt,
      source: settings.approvedSource
    },
    trust: {
      releaseSigningKeyId: settings.releaseSigningKeyId,
      packageBaseUrl: settings.packageBaseUrl
    },
    latestPackage,
    releases: {
      ...releases,
      page,
      pageSize
    },
    instances: {
      total,
      aligned,
      pending: Math.max(0, total - aligned),
      versions
    }
  })
})
