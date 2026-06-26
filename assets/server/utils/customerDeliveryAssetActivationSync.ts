export interface CustomerDeliveryAssetStatusSyncPayload {
  deliveryAssetCode: string
  externalAssetCode: string
  sourcePlanCode: string
  contractCode: string
  contractLineCode: string
  environmentCode: string
  projectCode: string
  status: string
  occurredAt: string
  deliveredAt: string
  goLiveAt: string
  acceptedAt: string
  assetItemCode: string
  deliveryViewCode: string
  operatorUid: string
  sourceApp: 'assets'
  asset: Record<string, unknown>
}

function text(value: unknown) {
  return String(value || '').trim()
}

function firstText(asset: Record<string, unknown>, body: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = text(asset[key] ?? body[key])
    if (value) return value
  }
  return ''
}

export function buildCustomerDeliveryAssetStatusSyncPayload(input: {
  pathDeliveryAssetCode: string
  asset: Record<string, unknown>
  body: Record<string, unknown>
}): CustomerDeliveryAssetStatusSyncPayload {
  const { pathDeliveryAssetCode, asset, body } = input
  const status = firstText(asset, body, 'status') || 'delivered'
  const deliveredAt = firstText(asset, body, 'deliveredAt', 'delivered_at')
  const goLiveAt = firstText(asset, body, 'goLiveAt', 'go_live_at')
  const acceptedAt = firstText(asset, body, 'acceptedAt', 'accepted_at')
  const occurredAt = firstText(asset, body, 'occurredAt', 'occurred_at')
    || acceptedAt
    || goLiveAt
    || deliveredAt

  const formalDeliveryAssetCode = firstText(asset, body, 'deliveryAssetCode', 'delivery_asset_code')
    || text(pathDeliveryAssetCode)

  return {
    deliveryAssetCode: formalDeliveryAssetCode,
    externalAssetCode: formalDeliveryAssetCode,
    sourcePlanCode: firstText(asset, body, 'sourcePlanCode', 'source_plan_code', 'sourceAssetPlanCode', 'source_asset_plan_code'),
    contractCode: firstText(asset, body, 'contractCode', 'contract_code'),
    contractLineCode: firstText(asset, body, 'contractLineCode', 'contract_line_code'),
    environmentCode: firstText(asset, body, 'environmentCode', 'environment_code'),
    projectCode: firstText(asset, body, 'projectCode', 'project_code'),
    status,
    occurredAt,
    deliveredAt,
    goLiveAt,
    acceptedAt,
    assetItemCode: firstText(asset, body, 'assetItemCode', 'asset_item_code'),
    deliveryViewCode: firstText(asset, body, 'deliveryViewCode', 'delivery_view_code'),
    operatorUid: text(body.operatorUid || body.operator_uid || body.updatedBy || body.updated_by || body.current_user),
    sourceApp: 'assets',
    asset
  }
}
