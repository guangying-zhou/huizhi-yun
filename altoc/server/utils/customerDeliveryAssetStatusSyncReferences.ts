import type { FormalCoverageTarget, ReferenceIssue } from './serviceAgreementCoverageReferences'

function text(value: unknown) {
  return String(value || '').trim()
}

function firstText(body: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = text(body[key])
    if (value) return value
  }
  return ''
}

function planCodeLike(value: string) {
  const normalized = value.trim().toUpperCase()
  return normalized.startsWith('DAP-') || normalized.startsWith('CDAP-')
}

export function deliveryAssetStatusSyncFormalTarget(
  pathDeliveryAssetCode: string,
  body: Record<string, unknown>
): { target: FormalCoverageTarget, issue: ReferenceIssue | null } {
  let deliveryAssetCode = firstText(body, 'externalAssetCode', 'external_asset_code', 'deliveryAssetCode', 'delivery_asset_code', 'code')
  if (planCodeLike(deliveryAssetCode)) {
    return {
      target: {
        targetType: '',
        deliveryAssetCode: '',
        environmentCode: '',
        requiresValidation: false
      },
      issue: {
        statusCode: 400,
        code: 'invalid_delivery_asset_code',
        message: 'deliveryAssetCode must be an Assets formal delivery asset code.'
      }
    }
  }
  if (!deliveryAssetCode && !planCodeLike(pathDeliveryAssetCode)) {
    deliveryAssetCode = text(pathDeliveryAssetCode)
  }

  const environmentCode = firstText(body, 'environmentCode', 'environment_code')
  let targetType = ''
  if (deliveryAssetCode && environmentCode) targetType = 'delivery_asset_environment'
  else if (deliveryAssetCode) targetType = 'delivery_asset'
  else if (environmentCode) targetType = 'environment'

  return {
    target: {
      targetType,
      deliveryAssetCode,
      environmentCode,
      requiresValidation: Boolean(targetType)
    },
    issue: null
  }
}
