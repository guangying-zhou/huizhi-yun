/**
 * 查询部门待接收的移交文档
 * GET /api/dept-shares?deptCode=xxx
 */
import { requireDepartmentManagerAccess } from '~~/server/utils/departmentAccess'
import { fetchDirectoryResponse } from '~~/server/utils/directoryCompat'
import type { AccountUser } from '~/types/account'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface DeptShareRow {
  id: number
  document_id: number
  document_uuid?: string | null
  document_title: string
  mode: 'share' | 'transfer'
  from_uid: string
  shared_by?: string | null
  from_real_name?: string
  dept_code: string
  status: string
  created_at: string
  oss_path: string | null
  doc_type: string | null
}

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event)

  const { deptCode, status } = getQuery(event) as { deptCode?: string, status?: string }
  if (!deptCode) {
    throw createError({ statusCode: 400, message: '缺少 deptCode' })
  }

  await requireDepartmentManagerAccess(uid, deptCode, '仅部门经理可查看待接收移交文档')

  const page = await callCodocsTenantRuntime<{ items?: DeptShareRow[] }>(event, '/v1/codocs/dept-shares', {
    query: { dept_code: deptCode, status: status || 'pending', limit: 5000 },
    scope: 'codocs.read'
  })
  const rows = page.items || []

  for (const row of rows) {
    row.from_uid = row.from_uid || row.shared_by || ''
  }

  const senderUids = [...new Set(rows.map(row => row.from_uid).filter(Boolean))]

  if (senderUids.length > 0) {
    try {
      const response = await fetchDirectoryResponse<AccountUser[]>(
        '/users/batch',
        {
          method: 'POST',
          body: { uids: senderUids },
          timeout: 5000
        }
      )

      const userMap = new Map(
        (response.data || []).map(user => [user.uid, user.realName || user.uid])
      )

      for (const row of rows) {
        row.from_real_name = userMap.get(row.from_uid) || row.from_uid
      }
    } catch (error) {
      console.warn('[DeptShares] Failed to resolve sender real names:', error)
    }
  }

  for (const row of rows) {
    row.from_real_name = row.from_real_name || row.from_uid
  }

  return { code: 0, data: rows }
})
