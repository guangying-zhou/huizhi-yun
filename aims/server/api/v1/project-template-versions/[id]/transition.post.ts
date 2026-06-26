import { transitionProjectTemplateVersion } from '~~/server/utils/projectTemplates'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的模板版本ID' })
  }

  const body = await readBody(event)
  const action = String(body?.action || '')
  if (!['publish', 'archive', 'revert_to_draft'].includes(action)) {
    throw createError({ statusCode: 400, message: '无效的模板版本流转动作' })
  }

  const detail = await transitionProjectTemplateVersion(id, {
    action: action as 'publish' | 'archive' | 'revert_to_draft',
    uid
  })

  return {
    code: 0,
    data: detail
  }
})
