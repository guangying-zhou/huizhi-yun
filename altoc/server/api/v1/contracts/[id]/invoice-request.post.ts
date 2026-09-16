import { createError } from 'h3'

// Contract-level invoice creation had no stable receivable-plan identity and
// bypassed the durable Altoc -> Finance -> Workflow chain. Keep the route as an
// explicit tombstone so old clients fail closed instead of silently reverting
// to direct cross-app mutations.
export default defineEventHandler(() => {
  throw createError({
    statusCode: 410,
    statusMessage: 'Contract invoice request route retired',
    message: '请从回款计划发起开票申请，以使用可靠的 Finance/Workflow 审批链路。'
  })
})
