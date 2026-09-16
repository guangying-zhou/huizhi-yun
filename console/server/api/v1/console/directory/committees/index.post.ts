import { createConsoleDirectoryCommittee } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import type { DirectoryDepartmentInput } from '~~/server/utils/directoryAdmin'
import { getDirectoryCommittee, ok } from '~~/server/utils/directoryRuntime'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'

interface CommitteeBody extends DirectoryDepartmentInput {
  committeeCode?: unknown
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_departments', 'edit', '需要目录组织编辑权限')
  requireIdempotencyKey(event)

  const body = await readBody<CommitteeBody>(event)
  const committeeCode = String(body.committeeCode || body.deptCode || '').trim()
  await createConsoleDirectoryCommittee(event, {
    ...body,
    deptCode: committeeCode
  } as Record<string, unknown>)

  return ok(await getDirectoryCommittee(committeeCode))
})
