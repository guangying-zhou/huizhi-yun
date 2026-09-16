import { createError, getHeader, getRouterParam, readBody, setResponseStatus, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { resolveCurrentAltocDataAccessQuery } from '~~/server/utils/altocScopedAuthorization'
import {
  existingOpsKnowledgeDocument,
  resolveServiceTicketOpsKnowledgeContext,
  serviceTicketOpsKnowledgeIdempotencyKey,
  type RuntimeRow
} from '~~/server/utils/serviceTicketOpsKnowledge'
import {
  claimOpsKnowledgeOperation,
  createRequestOpsKnowledgeOperationIO,
  executeClaimedOpsKnowledgeOperation
} from '~~/server/utils/serviceTicketOpsKnowledgeOperation'

interface RuntimeEnvelope<T> {
  code?: number | string
  data?: T
  message?: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function objectBody(value: unknown): RuntimeRow {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as RuntimeRow
  return {}
}

async function callAltocRuntime<T>(
  event: H3Event,
  path: string,
  scope: string,
  query: RuntimeRow,
  body?: RuntimeRow
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'altoc',
    scope,
    method: body ? 'POST' : 'GET',
    query,
    body
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for ops knowledge linking.' })
  }
  if (runtime.data.code !== undefined && String(runtime.data.code) !== '0') {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Altoc tenant-runtime returned an error.' })
  }
  return runtime.data.data as T
}

function acceptedOperationResponse(
  event: H3Event,
  ticketCode: string,
  documentUuid: string,
  idempotencyKey: string,
  reservation: RuntimeRow,
  operation: RuntimeRow | null,
  completedSteps: RuntimeRow = {}
) {
  setResponseStatus(event, 202)
  return {
    code: 0,
    message: 'accepted',
    data: {
      ticketCode,
      documentUuid,
      idempotencyKey,
      reservation,
      operation,
      ...completedSteps
    }
  }
}

export default defineEventHandler(async (event) => {
  const ticketCode = text(getRouterParam(event, 'ticketCode'))
  const request = objectBody(await readBody(event))
  const documentUuid = text(request.documentUuid || request.document_uuid || request.uuid)
  if (!ticketCode) throw createError({ statusCode: 400, message: 'ticketCode is required.' })
  if (!documentUuid) throw createError({ statusCode: 400, message: 'documentUuid is required.' })

  await requirePermission(event, 'service_ticket', 'edit')
  const dataAccessQuery = await resolveCurrentAltocDataAccessQuery(event, 'service_ticket', 'edit')
  const ticket = await callAltocRuntime<RuntimeRow>(
    event,
    `/v1/altoc/service-tickets/${encodeURIComponent(ticketCode)}/dispatch-context`,
    'altoc.read altoc:service_ticket:view',
    dataAccessQuery
  )
  const existingDocumentUuid = existingOpsKnowledgeDocument(ticket)
  if (existingDocumentUuid && existingDocumentUuid !== documentUuid) {
    throw createError({ statusCode: 409, statusMessage: 'service_ticket_ops_knowledge_conflict', message: 'Service ticket is already bound to another ops knowledge document.' })
  }

  const { context, missing } = resolveServiceTicketOpsKnowledgeContext(ticketCode, documentUuid, ticket)
  if (missing.length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'ops_knowledge_context_incomplete',
      message: `Trusted service ticket context is incomplete: ${missing.join(', ')}`,
      data: { code: 'ops_knowledge_context_incomplete', missing }
    })
  }

  const idempotencyKey = serviceTicketOpsKnowledgeIdempotencyKey(ticketCode, documentUuid)
  const requestedIdempotencyKey = text(getHeader(event, 'idempotency-key'))
  if (requestedIdempotencyKey && requestedIdempotencyKey !== idempotencyKey) {
    throw createError({
      statusCode: 409,
      statusMessage: 'idempotency_key_conflict',
      message: 'Idempotency-Key must match the canonical service ticket operation key.'
    })
  }
  const actorUid = getRequestUid(event) || 'system'
  const reservation = await callAltocRuntime<RuntimeRow>(
    event,
    `/v1/altoc/service-tickets/${encodeURIComponent(ticketCode)}/ops-knowledge:reserve`,
    'altoc.write altoc:service_ticket:edit',
    dataAccessQuery,
    { documentUuid, operatorUid: actorUid, idempotencyKey }
  )
  const operationIO = createRequestOpsKnowledgeOperationIO(event, dataAccessQuery)
  const codocsOperationKey = `${idempotencyKey}:codocs-link`
  const codocsClaim = await claimOpsKnowledgeOperation(operationIO, codocsOperationKey)
  let codocs: RuntimeRow | undefined
  let codocsOperation: RuntimeRow | undefined
  if (codocsClaim) {
    const executed = await executeClaimedOpsKnowledgeOperation(codocsClaim, operationIO)
    if (!executed.succeeded) {
      return acceptedOperationResponse(event, ticketCode, documentUuid, idempotencyKey, reservation, executed.checkpoint)
    }
    codocs = executed.result
    codocsOperation = executed.checkpoint
  }

  const assetsOperationKey = `${idempotencyKey}:assets-link`
  const assetsClaim = await claimOpsKnowledgeOperation(operationIO, assetsOperationKey)
  if (!assetsClaim) {
    return acceptedOperationResponse(event, ticketCode, documentUuid, idempotencyKey, reservation, null, { codocs, codocsOperation })
  }
  const executedAssets = await executeClaimedOpsKnowledgeOperation(assetsClaim, operationIO)
  if (!executedAssets.succeeded) {
    return acceptedOperationResponse(event, ticketCode, documentUuid, idempotencyKey, reservation, executedAssets.checkpoint, { codocs, codocsOperation })
  }
  const assets = executedAssets.result
  const binding = executedAssets.checkpoint

  return {
    code: 0,
    message: 'ok',
    data: {
      ticketCode,
      documentUuid,
      idempotencyKey,
      context,
      reservation,
      codocs,
      codocsOperation,
      assets,
      binding
    }
  }
})
