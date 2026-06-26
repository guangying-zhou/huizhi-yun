import type { ProjectCategory, ProjectTemplateVersionStatus } from '~~/app/types/aims'
import { fetchProjectTemplateVersionSummaries } from '~~/server/utils/projectTemplates'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const query = getQuery(event)
  const category = query.category ? String(query.category) as ProjectCategory : undefined
  const status = query.status ? String(query.status) as ProjectTemplateVersionStatus : undefined

  const items = await fetchProjectTemplateVersionSummaries({ category, status })

  return {
    code: 0,
    data: items
  }
})
