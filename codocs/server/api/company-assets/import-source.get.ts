/**
 * 公司知识库导入源
 * GET /api/company-assets/import-source?deptCode=&folderId=
 */
import { fetchDirectoryData } from '~~/server/utils/directoryCompat'
import { requirePermission } from '~~/server/utils/checkPermission'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { withTrustedCodocsDocumentReadContext } from '~~/server/utils/documentReadScope'
import type { DepartmentResponse } from '~/types/account'

interface RuntimePage<T> {
  items?: T[]
  total?: number
}

const normalizeFolderId = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '' || value === 'null') return null
  const id = Number(value)
  return Number.isFinite(id) && id > 0 ? String(id) : null
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin', 'admin', '仅系统管理员可直接发布组织资产')
  await requirePermission(event, 'company', 'publish', '缺少组织资产发布权限')
  const actor = requireRequestUid(event)

  const query = getQuery(event)
  const deptCode = String(query.deptCode || '').trim()
  const folderId = normalizeFolderId(query.folderId)
  const page = Math.max(1, Math.floor(Number(query.page) || 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(query.pageSize) || 50)))
  const departments = await fetchDirectoryData<DepartmentResponse>('/departments', { event })

  if (!deptCode) {
    return {
      code: 0,
      data: {
        departments,
        folders: [],
        documents: [],
        page, pageSize, total: 0
      }
    }
  }

  const [folders, documents] = await Promise.all([
    callCodocsTenantRuntime<RuntimePage<Record<string, unknown>>>(event, '/v1/codocs/folders', {
      query: withTrustedCodocsDocumentReadContext({
        folder_type: 'department',
        dept_code: deptCode,
        limit: 5000
      }, actor, deptCode),
      scope: 'codocs.read'
    }),
    callCodocsTenantRuntime<RuntimePage<Record<string, unknown>>>(event, '/v1/codocs/documents', {
      query: withTrustedCodocsDocumentReadContext({
        type: 'department',
        dept_code: deptCode,
        folder_id: folderId ?? '',
        page, limit: pageSize
      }, actor, deptCode),
      scope: 'codocs.read'
    })
  ])

  return {
    code: 0,
    data: {
      departments,
      folders: folders.items || [],
      documents: documents.items || [],
      page, pageSize, total: documents.total || 0
    }
  }
})
