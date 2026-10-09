export type RuntimeRow = Record<string, unknown>

export interface ServiceTicketOpsKnowledgeContext {
  ticketCode: string
  documentUuid: string
  customerCode: string
  contractCode: string
  maintenanceContractCode: string
  projectCode: string
  deliveryCode: string
  deliveryAssetCode: string
  environmentCode: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function firstText(source: RuntimeRow, ...keys: string[]) {
  for (const key of keys) {
    const value = text(source[key])
    if (value) return value
  }
  return ''
}

export function resolveServiceTicketOpsKnowledgeContext(
  ticketCode: string,
  documentUuid: string,
  ticket: RuntimeRow
) {
  const context: ServiceTicketOpsKnowledgeContext = {
    ticketCode: text(ticketCode),
    documentUuid: text(documentUuid),
    customerCode: firstText(ticket, 'customer_code', 'customerCode'),
    contractCode: firstText(ticket, 'contract_code', 'contractCode'),
    maintenanceContractCode: firstText(ticket, 'maintenance_contract_code', 'maintenanceContractCode'),
    projectCode: firstText(ticket, 'aims_project_code', 'aimsProjectCode', 'project_code', 'projectCode'),
    deliveryCode: firstText(ticket, 'resolved_delivery_code', 'delivery_code', 'deliveryCode'),
    deliveryAssetCode: firstText(ticket, 'delivery_asset_code', 'deliveryAssetCode'),
    environmentCode: firstText(ticket, 'environment_code', 'environmentCode')
  }
  const required: Array<keyof ServiceTicketOpsKnowledgeContext> = [
    'ticketCode',
    'documentUuid',
    'customerCode',
    'contractCode',
    'projectCode',
    'deliveryCode',
    'deliveryAssetCode',
    'environmentCode'
  ]
  return {
    context,
    missing: required.filter(key => !context[key])
  }
}

export function serviceTicketOpsKnowledgeIdempotencyKey(ticketCode: string, documentUuid: string) {
  return `altoc:ticket:${text(ticketCode)}:ops-knowledge:${text(documentUuid)}`
}

export function existingOpsKnowledgeDocument(ticket: RuntimeRow) {
  return firstText(ticket, 'codocs_document_uuid', 'codocsDocumentUuid')
}
