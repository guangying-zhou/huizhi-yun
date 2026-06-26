/**
 * 创建审批流程模板
 * POST /api/reviews/templates
 */
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface ReviewTemplateBody {
  name?: string
  review_type?: string
  sub_type?: string | null
  target_category?: string
  nodes?: Array<{
    index?: number
    name?: string
    role?: string
    pass_type?: string
    pass_count?: number
    pass_total?: number
  }>
  status?: number
}

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event, '未登录')
  const body = await readBody<ReviewTemplateBody>(event)
  const { name, review_type, sub_type, target_category, nodes, status } = body

  if (!name || !review_type || !target_category || !nodes) {
    throw createError({ statusCode: 400, message: '缺少必填字段' })
  }
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > 5) {
    throw createError({ statusCode: 400, message: '审批节点数量必须在1-5个之间' })
  }

  for (const node of nodes) {
    if (
      typeof node.index !== 'number'
      || !node.name
      || !node.role
      || !node.pass_type
      || typeof node.pass_count !== 'number'
    ) {
      throw createError({ statusCode: 400, message: '节点配置不完整' })
    }
    if (!['all', 'any', 'ratio'].includes(node.pass_type)) {
      throw createError({ statusCode: 400, message: '通过类型必须是 all/any/ratio' })
    }
    if (node.pass_type === 'ratio' && !node.pass_total) {
      throw createError({ statusCode: 400, message: '比例通过模式必须指定 pass_total' })
    }
  }

  const data = await callCodocsTenantRuntime(event, '/v1/codocs/reviews/templates', {
    method: 'POST',
    scope: 'codocs.write',
    body: {
      name,
      review_type,
      sub_type: sub_type || null,
      target_category,
      nodes,
      status: status !== undefined ? status : 1,
      created_by: uid,
      current_user: uid
    }
  })

  return {
    code: 0,
    message: 'success',
    data
  }
})
