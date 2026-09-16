import { createError, getQuery } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { appCode } from '~~/app/config/permissions'
import { requirePeopleGlobalEmployeeScope } from '~~/server/utils/peopleGlobalScope'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'
import { callConsoleSubjectMerge, describeUpstreamFailure } from '~~/server/utils/onboardingProvisioning'

interface ApiResponse<T> { code: number, data: T, message?: string }
type Row = Record<string, unknown>

const text = (value: unknown) => String(value || '').trim()

// 遗留 dt-* 主体归并预览。只读，同时给出 People 与 Console 两侧将被改写的内容。
export default defineEventHandler(async (event) => {
  const snapshot = await assertPeoplePermission(event, 'employees', 'admin')
  const actorUid = text(snapshot.uid)
  if (!actorUid) throw createError({ statusCode: 403, message: '需要已验证的操作人身份。' })
  const scopeQuery = await requirePeopleGlobalEmployeeScope(event, actorUid)

  const query = getQuery(event)
  const legacyUid = text(query.legacyUid)
  const canonicalUid = text(query.canonicalUid)
  if (!legacyUid || !canonicalUid) {
    throw createError({ statusCode: 400, message: '需要提供 legacyUid 与 canonicalUid。' })
  }

  const runtime = await maybeCallTenantRuntime<ApiResponse<Row>>(
    event,
    '/v1/people/subject-merge:preview',
    {
      appCode,
      scope: 'people.read',
      method: 'GET',
      query: { ...scopeQuery, current_user: actorUid, legacy_uid: legacyUid, canonical_uid: canonicalUid }
    }
  ).catch(error => describeUpstreamFailure('People data-runtime', '/v1/people/subject-merge:preview', error))
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'People tenant-runtime is not configured' })
  }
  const consoleSide = await callConsoleSubjectMerge(event, legacyUid, canonicalUid, true)
    .catch(error => describeUpstreamFailure('Console', '/service/directory/subject-merge-preview', error))

  return {
    code: 0,
    data: {
      people: (runtime.data as ApiResponse<Row>)?.data || {},
      console: consoleSide
    }
  }
})
