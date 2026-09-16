/**
 * 部门开放文档列表
 * GET /api/open-department-docs
 */
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { loadOpenDepartmentDocs } from '~~/server/utils/openDepartmentDocs'

export default defineEventHandler(async (event) => {
  requireRequestUid(event)
  const departments = await loadOpenDepartmentDocs(event)

  return {
    success: true,
    data: {
      departments
    }
  }
})
