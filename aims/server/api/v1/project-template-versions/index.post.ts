import type { ProjectCategory } from '~~/app/types/aims'
import { createProjectTemplateDraft } from '~~/server/utils/projectTemplates'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const body = await readBody(event)
  const category = body?.category ? String(body.category) as ProjectCategory : null

  if (!category) {
    throw createError({ statusCode: 400, message: '模板分类不能为空' })
  }

  const detail = await createProjectTemplateDraft({
    category,
    uid,
    templateSetId: body.templateSetId ? Number(body.templateSetId) : null,
    templateSetCode: body.templateSetCode || null,
    templateSetName: body.templateSetName || null,
    templateSetDescription: body.templateSetDescription || null,
    cloneFromVersionId: body.cloneFromVersionId ? Number(body.cloneFromVersionId) : null
  })

  return {
    code: 0,
    data: detail
  }
})
