/**
 * 更新审批流程模板
 * PATCH /api/reviews/templates/:id
 */

import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface ReviewTemplatePatchBody {
  name?: string
  review_type?: string
  sub_type?: string | null
  target_category?: string
  nodes?: unknown[]
  status?: number
}

interface StatusError {
  statusCode: number
}

const hasStatusCode = (error: unknown): error is StatusError => {
  return typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' && error.message) {
    return error.message
  }

  return fallback
}

export default defineEventHandler(async (event) => {
  try {
    requireRequestUid(event, '未登录')

    const id = getRouterParam(event, 'id')
    if (!id) {
      throw createError({
        statusCode: 400,
        message: '缺少模板ID'
      })
    }

    const body = await readBody<ReviewTemplatePatchBody>(event)
    const { name, review_type, sub_type, target_category, nodes, status }
      = body

    const updates: Record<string, unknown> = {}

    if (name !== undefined) {
      updates.name = name
    }
    if (review_type !== undefined) {
      updates.review_type = review_type
    }
    if (sub_type !== undefined) {
      updates.sub_type = sub_type || null
    }
    if (target_category !== undefined) {
      updates.target_category = target_category
    }
    if (nodes !== undefined) {
      // 验证节点配置
      if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > 5) {
        throw createError({
          statusCode: 400,
          message: '审批节点数量必须在1-5个之间'
        })
      }
      updates.nodes = JSON.stringify(nodes)
    }
    if (status !== undefined) {
      updates.status = status
    }

    if (Object.keys(updates).length === 0) {
      throw createError({
        statusCode: 400,
        message: '没有要更新的字段'
      })
    }

    await callCodocsTenantRuntime(event, `/v1/codocs/reviews/templates/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      scope: 'codocs.write',
      body: updates
    })

    return {
      code: 0,
      message: 'success'
    }
  } catch (error: unknown) {
    console.error('[ReviewTemplates] Failed to update template:', error)

    if (hasStatusCode(error)) {
      throw error
    }

    throw createError({
      statusCode: 500,
      message: getErrorMessage(error, '更新模板失败')
    })
  }
})
