export type ServiceTicketProjectResolutionSource
  = | 'explicit'
    | 'ticket'
    | 'service_agreement_default'
    | 'legacy_contract_resolution'

export interface ServiceTicketProjectResolution {
  projectCode: string
  source: ServiceTicketProjectResolutionSource
}

export interface LegacyProjectSelection {
  resolution?: ServiceTicketProjectResolution
  errorCode?: 'project_resolution_ambiguous'
  candidateProjectCodes?: string[]
}

type RuntimeRow = Record<string, unknown>

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

function unique(values: string[]) {
  return Array.from(new Set(values.map(item => item.trim()).filter(Boolean)))
}

export function isExplicitProjectEligible(
  projectCode: string,
  customerCode: string,
  contractCode: string,
  items: RuntimeRow[]
) {
  const expectedProjectCode = text(projectCode)
  const expectedCustomerCode = text(customerCode)
  const expectedContractCode = text(contractCode)
  if (!expectedProjectCode || (!expectedCustomerCode && !expectedContractCode)) return false

  return items.some((item) => {
    if (firstText(item, 'project_code', 'projectCode') !== expectedProjectCode) return false

    const itemCustomerCode = firstText(item, 'customer_code', 'customerCode')
    if (expectedCustomerCode && itemCustomerCode !== expectedCustomerCode) return false

    const itemContractCode = firstText(item, 'contract_code', 'contractCode')
    if (expectedContractCode && itemContractCode && itemContractCode !== expectedContractCode) return false

    // An unlinked project is only a safe candidate when the scoped ticket supplies
    // the customer boundary. A contract code alone cannot scope an unlinked project.
    if (expectedContractCode && !itemContractCode && !expectedCustomerCode) return false
    return true
  })
}

export function selectLegacyContractProject(contractCode: string, items: RuntimeRow[]): LegacyProjectSelection {
  const sameContractProjects = items.filter(item =>
    firstText(item, 'contract_code', 'contractCode') === contractCode
    && firstText(item, 'project_code', 'projectCode')
  )
  const projectCodes = unique(sameContractProjects.map(item => firstText(item, 'project_code', 'projectCode')))

  if (projectCodes.length === 1) {
    return {
      resolution: {
        projectCode: projectCodes[0] || '',
        source: 'legacy_contract_resolution'
      }
    }
  }
  if (projectCodes.length > 1) {
    return {
      errorCode: 'project_resolution_ambiguous',
      candidateProjectCodes: projectCodes
    }
  }
  return {}
}

export function altocRuntimeErrorCode(envelope: RuntimeRow) {
  const nested = envelope.error
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return firstText(nested as RuntimeRow, 'code', 'errorCode')
  }
  const code = envelope.code
  if (typeof code === 'string') {
    const normalized = text(code)
    return normalized === '0' ? '' : normalized
  }
  return firstText(envelope, 'errorCode')
}

export function altocRuntimeErrorStatus(envelope: RuntimeRow) {
  const explicit = Number(envelope.statusCode || envelope.status || envelope.upstreamStatus || 0)
  if (Number.isInteger(explicit) && explicit >= 400 && explicit < 600) return explicit

  const code = altocRuntimeErrorCode(envelope)
  switch (code) {
    case 'multiple_default_service_projects':
    case 'project_resolution_ambiguous':
    case 'relation_ambiguous':
      return 409
    case 'no_default_project':
    case 'service_agreement_not_found':
    case 'service_agreement_project_not_found':
      return 404
    case 'invalid_contract_project_line_refs':
    case 'invalid_contract_project_obligation_refs':
    case 'invalid_contract_project_allocation':
      return 400
    default:
      return 502
  }
}
