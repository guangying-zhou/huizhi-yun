import { getQuery } from 'h3'
import { previewConsoleDirectorySubjectMerge } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

// 归并预览。只读，不做任何写入。
export default defineEventHandler(async (event) => {
  await requireConsoleServiceActor(event, 'console', 'console:directory-user:provision', {
    requireBoundTargetApp: true
  })
  const query = getQuery(event)
  const legacyUid = String(query.legacyUid || '').trim()
  const canonicalUid = String(query.canonicalUid || '').trim()
  if (!legacyUid || !canonicalUid) {
    throw createError({ statusCode: 400, message: 'legacyUid and canonicalUid are required.' })
  }

  const runtime = await previewConsoleDirectorySubjectMerge(event, legacyUid, canonicalUid)
  return { code: 0, message: 'ok', data: runtime.data }
})
