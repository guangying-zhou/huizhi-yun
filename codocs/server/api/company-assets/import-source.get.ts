/**
 * 公司知识库导入源
 * GET /api/company-assets/import-source?deptCode=&folderId=
 */
import { fetchDirectoryData } from '~~/server/utils/directoryCompat'
import { requirePermission } from '~~/server/utils/checkPermission'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import type { DepartmentResponse } from '~/types/account'

interface RuntimePage<T> {
  items?: T[]
}

const normalizeFolderId = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '' || value === 'null') return null
  const id = Number(value)
  return Number.isFinite(id) && id > 0 ? String(id) : null
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'company', 'admin', '仅管理员可导入知识库文档')

  const query = getQuery(event)
  const deptCode = String(query.deptCode || '').trim()
  const folderId = normalizeFolderId(query.folderId)
  const departments = await fetchDirectoryData<DepartmentResponse>('/departments')

  if (!deptCode) {
    return {
      code: 0,
      data: {
        departments,
        folders: [],
        documents: []
      }
    }
  }

  const [folders, documents] = await Promise.all([
    callCodocsTenantRuntime<RuntimePage<Record<string, unknown>>>(event, '/v1/codocs/folders', {
      query: {
        folder_type: 'department',
        dept_code: deptCode,
        limit: 5000
      },
      scope: 'codocs.read'
    }),
    callCodocsTenantRuntime<RuntimePage<Record<string, unknown>>>(event, '/v1/codocs/documents', {
      query: {
        type: 'department',
        dept_code: deptCode,
        folder_id: folderId ?? '',
        limit: 5000
      },
      scope: 'codocs.read'
    })
  ])

  return {
    code: 0,
    data: {
      departments,
      folders: folders.items || [],
      documents: documents.items || []
    }
  }
})
