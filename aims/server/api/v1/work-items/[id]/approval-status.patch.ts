/**
 * 旧工作项审批状态直写入口已禁用。
 *
 * 审批通过/拒绝必须走 /api/v1/approvals/{id}，由 BFF 校验
 * work_items:confirm 后交给 tenant-runtime 基于审批记录闭环处理。
 */
export default defineEventHandler(() => {
  throw createError({
    statusCode: 410,
    message: '工作项审批状态不能直接修改，请通过 /api/v1/approvals/{id} 处理审批。'
  })
})
