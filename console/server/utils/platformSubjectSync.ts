import { createHash } from 'node:crypto'
import { fetchExternal } from '@hzy/foundation/server/utils/externalFetch'
import { listSubjectExports, listSubjectMemberships } from '~~/server/utils/directoryRuntime'
import type { PlatformRuntimeConfig } from '~~/server/utils/platformRuntime'

interface SubjectExportItem {
  subjectType: string
  subjectCode: string
  externalRef: string | null
  parentSubjectType: string | null
  parentSubjectCode: string | null
  snapshotHash: string
  status: string
  exportedAt: string
  updatedAt: string
}

interface SubjectSyncResponse {
  code: number
  data: {
    receivedCount: number
    acceptedCount: number
    skippedCount: number
    upsertedCount: number
    membershipReceivedCount?: number
    membershipAcceptedCount?: number
    membershipUpsertedCount?: number
  }
}

interface SubjectMembershipItem {
  subjectType: string
  subjectCode: string
  containerSubjectType: string
  containerSubjectCode: string
  relationType: string
  isPrimary: boolean
  status: string
}

const platformSubjectTypes = new Set(['user', 'department', 'committee', 'project'])
const platformSubjectSyncTimeoutMs = 60_000

function stableSubjectLine(item: SubjectExportItem) {
  return [
    item.subjectType,
    item.subjectCode,
    item.externalRef || '',
    item.parentSubjectType || '',
    item.parentSubjectCode || '',
    item.status,
    item.snapshotHash
  ].join('|')
}

function stableMembershipLine(item: SubjectMembershipItem) {
  return [
    item.subjectType,
    item.subjectCode,
    item.containerSubjectType,
    item.containerSubjectCode,
    item.relationType,
    item.isPrimary ? '1' : '0',
    item.status
  ].join('|')
}

function hashSubjectSnapshot(items: SubjectExportItem[], memberships: SubjectMembershipItem[] = []) {
  const payload = items
    .map(stableSubjectLine)
    .concat(memberships.map(stableMembershipLine))
    .sort()
    .join('\n')

  return `sha256_${createHash('sha256').update(payload).digest('hex')}`
}

function toPlatformSubjectItem(item: SubjectExportItem) {
  return {
    subjectType: item.subjectType,
    subjectCode: item.subjectCode,
    externalRef: item.externalRef,
    parentSubjectType: item.parentSubjectType,
    parentSubjectCode: item.parentSubjectCode,
    status: item.status,
    snapshotHash: item.snapshotHash
  }
}

export async function pushSubjectProjectionToPlatform(config: PlatformRuntimeConfig, jobCode: string | null) {
  const allItems: SubjectExportItem[] = []
  let cursor: string | undefined

  do {
    const page = await listSubjectExports({
      cursor,
      limit: 100
    })

    allItems.push(
      ...page.items.filter((item: SubjectExportItem) => platformSubjectTypes.has(item.subjectType))
    )
    cursor = page.nextCursor || undefined
  } while (cursor)

  if (allItems.length === 0) {
    return {
      jobCode,
      snapshotHash: hashSubjectSnapshot([]),
      sentCount: 0,
      acceptedCount: 0,
      skippedCount: 0,
      upsertedCount: 0
    }
  }

  const memberships = await listSubjectMemberships()
  const snapshotHash = hashSubjectSnapshot(allItems, memberships)
  const body = {
    cursor: jobCode,
    snapshotHash,
    items: allItems.map(toPlatformSubjectItem),
    memberships
  }
  type SubjectSyncFetch = (
    url: string,
    options: Record<string, unknown>
  ) => Promise<SubjectSyncResponse>
  const rawFetchSubjectSync = fetchExternal as unknown as SubjectSyncFetch
  // 与 platformRuntime.ts 同因：Worker 子请求需带该 UA 才命中 WAF 豁免。
  const fetchSubjectSync: SubjectSyncFetch = (url, options) => rawFetchSubjectSync(url, {
    ...options,
    headers: {
      ...((options.headers as Record<string, string> | undefined) || {}),
      'user-agent': 'HZY-Cloudflare-Worker/1.0'
    }
  })
  const response = config.activationMode === 'managed-cloud-multitenant'
    ? await fetchSubjectSync(
        `${config.baseUrl}/api/platform/internal/console/tenants/${encodeURIComponent(config.tenantCode)}/subjects/sync`,
        {
          method: 'POST',
          query: {
            environment: config.environment,
            ...(config.deploymentCode ? { deploymentCode: config.deploymentCode } : {})
          },
          headers: {
            'Authorization': `Bearer ${config.platformServiceToken}`,
            'x-hzy-internal-principal': 'console-managed-cloud-worker'
          },
          body,
          timeout: platformSubjectSyncTimeoutMs
        }
      )
    : await fetchSubjectSync(
        `${config.baseUrl}/api/v1/runtime/subjects/sync`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.runtimeToken}`
          },
          body: {
            tenantCode: config.tenantCode,
            deploymentId: config.deploymentCode,
            ...body
          },
          timeout: platformSubjectSyncTimeoutMs
        }
      )

  if (response.code !== 0 || !response.data) {
    throw new Error('platform subject sync response is invalid')
  }

  return {
    jobCode,
    snapshotHash,
    sentCount: allItems.length,
    acceptedCount: response.data.acceptedCount,
    skippedCount: response.data.skippedCount,
    upsertedCount: response.data.upsertedCount
  }
}
