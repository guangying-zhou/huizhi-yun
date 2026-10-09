/**
 * 根据 OSS 路径查询文档的发布记录
 * GET /api/reviews/by-oss-path?path=codocs/company/tech-specs/xxx.md
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'
import { withTrustedCodocsReviewReadContext } from '~~/server/utils/reviewReadScope'

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event, '未登录')
  await requirePermission(event, 'reviews', 'view', '缺少审阅查看权限')
  const query = getQuery(event)
  const ossPath = String(query.path || '').trim()
  if (!ossPath) {
    throw createError({ statusCode: 400, message: '缺少 path 参数' })
  }

  const companyAsset = ossPath.replace(/^\/+/, '').startsWith('codocs/company/')
  if (companyAsset) {
    await requirePermission(event, 'admin', 'admin', '仅系统管理员可查看组织资产发布记录')
  }

  const data = await callCodocsTenantRuntime(event, '/v1/codocs/reviews/by-oss-path', {
    query: withTrustedCodocsReviewReadContext({
      path: ossPath,
      ...(companyAsset ? { codocs_trusted_company_publish_history: '1' } : {})
    }, uid),
    scope: 'codocs.read'
  })

  return {
    code: 0,
    message: 'success',
    data
  }
})
