import type { H3Event } from 'h3'
import { getConsoleDirectoryDepartment } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { buildNotificationDetailDepartmentTree } from './notificationDetailDepartmentTree'

interface DepartmentParentRow {
  deptCode: string
  parentId: string | null
}

export async function loadNotificationDetailDepartmentTree(event: H3Event, deptCodeInput: string) {
  return await buildNotificationDetailDepartmentTree(
    deptCodeInput,
    async (current) => {
      const envelope = await getConsoleDirectoryDepartment(event, current)
      const row = envelope.data as DepartmentParentRow | null
      return row
        ? { deptCode: row.deptCode, parentDeptCode: row.parentId || null }
        : null
    }
  )
}
