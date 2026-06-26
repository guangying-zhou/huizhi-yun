import { createHash } from 'node:crypto'
import { listSubjectExports, listSubjectMemberships } from '~~/server/utils/directoryRuntime'
import { startDirectorySyncJob } from '~~/server/utils/directorySyncJobs'
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

const platformSubjectTypes = new Set(['user', 'department', 'committee', 'job'])

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

export async function syncSubjectProjectionToPlatform(config: PlatformRuntimeConfig) {
  const syncJob = await startDirectorySyncJob({
    providerCode: 'console',
    syncType: 'manual',
    objectScope: 'subjects',
    requestedBy: 'startup'
  })
  const allItems: SubjectExportItem[] = []
  let cursor: string | undefined

  do {
    const page = await listSubjectExports({
      cursor,
      limit: 500
    })

    allItems.push(
      ...page.items.filter(item => platformSubjectTypes.has(item.subjectType))
    )
    cursor = page.nextCursor || undefined
  } while (cursor)

  if (allItems.length === 0) {
    return {
      jobCode: syncJob?.jobCode || null,
      snapshotHash: hashSubjectSnapshot([]),
      sentCount: 0,
      acceptedCount: 0,
      skippedCount: 0,
      upsertedCount: 0
    }
  }

  const memberships = await listSubjectMemberships()
  const snapshotHash = hashSubjectSnapshot(allItems, memberships)
  const response = await $fetch<SubjectSyncResponse>(
    `${config.baseUrl}/api/v1/runtime/subjects/sync`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.runtimeToken}`
      },
      body: {
        tenantCode: config.tenantCode,
        deploymentId: config.deploymentCode,
        cursor: syncJob?.jobCode || null,
        snapshotHash,
        items: allItems.map(toPlatformSubjectItem),
        memberships
      },
      timeout: 15000
    }
  )

  if (response.code !== 0 || !response.data) {
    throw new Error('platform subject sync response is invalid')
  }

  return {
    jobCode: syncJob?.jobCode || null,
    snapshotHash,
    sentCount: allItems.length,
    acceptedCount: response.data.acceptedCount,
    skippedCount: response.data.skippedCount,
    upsertedCount: response.data.upsertedCount
  }
}
