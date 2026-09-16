import type { ProjectCategory } from '~~/app/types/aims'
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'
import { buildProjectTemplateAdminRuntimeQuery } from '~~/server/utils/projectTemplateRuntimeAccess'

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

  const detail = await forwardAimsRuntimePost(event, '/v1/aims/project-template-versions', {
    uid,
    query: await buildProjectTemplateAdminRuntimeQuery(event),
    body: {
      ...body,
      category
    }
  })

  return {
    code: 0,
    data: detail
  }
})
