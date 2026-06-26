export interface FormalCoverageTarget {
  targetType: string
  deliveryAssetCode: string
  environmentCode: string
  requiresValidation: boolean
}

export interface ResolvedCoverageReference {
  code?: string
  found?: boolean
  item?: Record<string, unknown> | null
  delivery_asset_code?: string
  environment_code?: string
}

export interface AssetsReferenceResolution {
  delivery_assets?: ResolvedCoverageReference[]
  environments?: ResolvedCoverageReference[]
  pairs?: ResolvedCoverageReference[]
}

export interface ReferenceIssue {
  statusCode: number
  code: string
  message: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

function objectBody(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function firstText(body: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = text(body[key])
    if (value) return value
  }
  return ''
}

export function coverageFormalTargetFromBody(body: Record<string, unknown>): FormalCoverageTarget {
  let targetType = firstText(body, 'targetType', 'target_type').toLowerCase()
  const deliveryAssetCode = firstText(body, 'deliveryAssetCode', 'delivery_asset_code')
  const environmentCode = firstText(body, 'environmentCode', 'environment_code')
  const sourcePlanCode = firstText(body, 'sourcePlanCode', 'source_plan_code')
  const legacyReference = firstText(body, 'legacyReference', 'legacy_reference')

  if (!targetType) {
    if (deliveryAssetCode && environmentCode) targetType = 'delivery_asset_environment'
    else if (deliveryAssetCode) targetType = 'delivery_asset'
    else if (environmentCode) targetType = 'environment'
    else if (sourcePlanCode) targetType = 'pending_plan'
    else if (legacyReference) targetType = 'legacy'
  }

  return {
    targetType,
    deliveryAssetCode,
    environmentCode,
    requiresValidation: targetType === 'delivery_asset' || targetType === 'environment' || targetType === 'delivery_asset_environment'
  }
}

function resolvedByCode(items: ResolvedCoverageReference[] | undefined, code: string) {
  return (items || []).find(item => text(item.code) === code)
}

function resolvedPair(items: ResolvedCoverageReference[] | undefined, deliveryAssetCode: string, environmentCode: string) {
  return (items || []).find(item =>
    text(item.delivery_asset_code) === deliveryAssetCode
    && text(item.environment_code) === environmentCode
  )
}

function customerCode(item: ResolvedCoverageReference | undefined) {
  return firstText(objectBody(item?.item), 'customer_code', 'customerCode')
}

export function serviceAgreementCoverageReferenceIssue(
  target: FormalCoverageTarget,
  resolution: AssetsReferenceResolution,
  expectedCustomerCode: string
): ReferenceIssue | null {
  const asset = target.deliveryAssetCode ? resolvedByCode(resolution.delivery_assets, target.deliveryAssetCode) : undefined
  const environment = target.environmentCode ? resolvedByCode(resolution.environments, target.environmentCode) : undefined

  if ((target.targetType === 'delivery_asset' || target.targetType === 'delivery_asset_environment') && !asset?.found) {
    return { statusCode: 404, code: 'delivery_asset_not_found', message: 'deliveryAssetCode does not reference a formal Assets delivery asset' }
  }
  if ((target.targetType === 'environment' || target.targetType === 'delivery_asset_environment') && !environment?.found) {
    return { statusCode: 404, code: 'environment_not_found', message: 'environmentCode does not reference a formal Assets environment' }
  }

  const assetCustomer = customerCode(asset)
  const environmentCustomer = customerCode(environment)
  if (expectedCustomerCode && assetCustomer && expectedCustomerCode !== assetCustomer) {
    return { statusCode: 409, code: 'delivery_asset_customer_conflict', message: 'delivery asset belongs to another customer' }
  }
  if (expectedCustomerCode && environmentCustomer && expectedCustomerCode !== environmentCustomer) {
    return { statusCode: 409, code: 'environment_customer_conflict', message: 'environment belongs to another customer' }
  }
  if (assetCustomer && environmentCustomer && assetCustomer !== environmentCustomer) {
    return { statusCode: 409, code: 'delivery_asset_environment_conflict', message: 'delivery asset and environment belong to different customers' }
  }
  if (target.targetType === 'delivery_asset_environment') {
    const pair = resolvedPair(resolution.pairs, target.deliveryAssetCode, target.environmentCode)
    if (!pair?.found) {
      return { statusCode: 409, code: 'delivery_asset_environment_conflict', message: 'delivery asset is not bound to the environment in Assets' }
    }
  }
  return null
}

export function serviceAgreementCoverageRuntimeErrorStatus(code: unknown, explicitStatus?: unknown) {
  const status = Number(explicitStatus || 0)
  if (Number.isInteger(status) && status >= 400 && status < 600) return status

  switch (text(code)) {
    case 'missing_required_field':
    case 'missing_delivery_asset_code':
    case 'missing_environment_code':
    case 'missing_status':
    case 'invalid_coverage_status':
    case 'invalid_resolution_status':
    case 'invalid_delivery_asset_code':
      return 400
    case 'service_agreement_not_found':
    case 'coverage_not_found':
    case 'record_not_found':
    case 'environment_not_found':
    case 'delivery_asset_not_found':
      return 404
    case 'coverage_target_unresolved':
    case 'coverage_target_conflict':
    case 'coverage_already_active':
    case 'environment_customer_conflict':
    case 'delivery_asset_customer_conflict':
    case 'delivery_asset_environment_conflict':
    case 'environment_reference_ambiguous':
    case 'invalid_environment_transition':
    case 'legacy_coverage_needs_review':
    case 'multiple_primary_environments':
      return 409
    case 'assets_sync_failed':
      return 502
    default:
      return 502
  }
}
