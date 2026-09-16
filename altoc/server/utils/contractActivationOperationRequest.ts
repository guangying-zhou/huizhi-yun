import { createError, type H3Event } from 'h3'
import { executeClaimedContractActivationOperation } from './contractActivationOperation'
import { claimOpsKnowledgeOperation, createRequestOpsKnowledgeOperationIO } from './serviceTicketOpsKnowledgeOperation'

type RuntimeRow = Record<string, unknown>
function text(value: unknown) {
  return String(value || '').trim()
}

export async function executeContractActivationOperationsForRequest(event: H3Event, operations: RuntimeRow[], query: RuntimeRow) {
  const io = createRequestOpsKnowledgeOperationIO(event, query)
  const ordered = [...operations].sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0))
  const results: RuntimeRow[] = []
  for (const descriptor of ordered) {
    const operationKey = text(descriptor.operationKey)
    if (!operationKey) throw createError({ statusCode: 502, message: 'Altoc activation operation descriptor is invalid.' })
    const claimed = await claimOpsKnowledgeOperation(io, operationKey)
    if (!claimed) {
      const succeeded = text(descriptor.status) === 'succeeded'
      results.push({ ...descriptor, claimed: false, pending: !succeeded, succeeded })
      continue
    }
    const executed = await executeClaimedContractActivationOperation(claimed, io)
    results.push({ ...descriptor, claimed: true, ...executed })
  }
  return results
}
