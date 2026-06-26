import { fetchProjectTemplateVersionDetail } from '~~/server/utils/projectTemplates'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的模板版本ID' })
  }

  const detail = await fetchProjectTemplateVersionDetail(id)
  if (!detail) {
    throw createError({ statusCode: 404, message: '模板版本不存在' })
  }

  return {
    code: 0,
    data: detail
  }
})
