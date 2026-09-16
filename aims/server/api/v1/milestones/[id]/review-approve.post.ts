/**
 * 里程碑评审通过（可靠推进 Altoc 回款计划）
 * POST /api/v1/milestones/:id/review-approve
 */
import { createError } from 'h3'

export default defineEventHandler(async (_event) => {
  throw createError({
    statusCode: 410,
    statusMessage: 'Gone',
    message: '里程碑最终完成必须通过完成申请与 Workflow 审批'
  })
})
