import type { H3Event } from 'h3'
import { claimOpsKnowledgeOperation, createRequestOpsKnowledgeOperationIO } from './serviceTicketOpsKnowledgeOperation'
import { executeProductFeedbackOperation, isProductFeedbackOperation } from './productFeedbackOperation'

type Row = Record<string, unknown>

export async function dispatchProductFeedback(event: H3Event, query: Row, ticketCode: string, submission: Row): Promise<boolean> {
  if (submission.status === 'succeeded') return true
  if (!['pending', 'retry_wait', 'partial_unknown'].includes(String(submission.status))) return false
  const id = submission.submissionId
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return false
  const key = `altoc:product-feedback:create:${id}`
  try {
    const io = createRequestOpsKnowledgeOperationIO(event, query)
    const claimed = await claimOpsKnowledgeOperation(io, key)
    if (!claimed || claimed.operationKey !== key || !isProductFeedbackOperation(claimed)
      || claimed.command?.ticketCode !== ticketCode || claimed.command?.productCode !== submission.productCode
      || claimed.command?.requestBizId !== submission.requestBizId) return false
    return (await executeProductFeedbackOperation(claimed, io)).succeeded
  } catch {
    // The source submission is durable. A claim or acknowledgement failure must
    // not cause the browser to create a different submission identity.
    return false
  }
}
