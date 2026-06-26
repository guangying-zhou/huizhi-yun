/**
 * 根据 OSS 路径查询文档的发布记录
 * GET /api/reviews/by-oss-path?path=codocs/company/tech-specs/xxx.md
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const ossPath = String(query.path || '').trim()
  if (!ossPath) {
    throw createError({ statusCode: 400, message: '缺少 path 参数' })
  }

  const data = await callCodocsTenantRuntime(event, '/v1/codocs/reviews/by-oss-path', {
    query: { path: ossPath },
    scope: 'codocs.read'
  })

  return {
    code: 0,
    message: 'success',
    data
  }
})
