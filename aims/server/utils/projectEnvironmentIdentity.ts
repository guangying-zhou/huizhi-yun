export interface EnvironmentUpsertStatusInput {
  requestedEnvironmentCode?: string
  requestedEnvironmentStatus?: string
}

export interface ProjectEnvironmentIdempotencyInput {
  explicitIdempotencyKey?: string
  projectCode: string
  body: Record<string, unknown>
}

export interface AssetsEnvironmentUpsertPayloadInput {
  body: Record<string, unknown>
  requestedEnvironmentCode?: string
  idempotencyKey: string
  customerCode: string
  contractCode?: string
  projectCode: string
  operatorUid: string
}

function cleanText(value: unknown) {
  return String(value || '').trim()
}

function firstText(body: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = cleanText(body[key])
    if (value) return value
  }
  return ''
}

export function normalizeProjectEnvironmentRelationType(value: string) {
  const normalized = cleanText(value) || 'initial_delivery'
  return [
    'initial_delivery',
    'upgrade',
    'migration',
    'maintenance',
    'decommission',
    'verification',
    'other'
  ].includes(normalized)
    ? normalized
    : 'initial_delivery'
}

export function normalizeProjectEnvironmentDeliveryStatus(value: string) {
  const normalized = cleanText(value)
  return [
    'planned',
    'provisioning',
    'deployed',
    'online',
    'accepted',
    'handed_over',
    'suspended',
    'cancelled'
  ].includes(normalized)
    ? normalized
    : ''
}

export function environmentUpsertStatusValue(input: EnvironmentUpsertStatusInput) {
  const explicitStatus = cleanText(input.requestedEnvironmentStatus)
  if (explicitStatus) return explicitStatus
  return cleanText(input.requestedEnvironmentCode) ? undefined : 'planning'
}

export function projectEnvironmentIdempotencyKey(input: ProjectEnvironmentIdempotencyInput) {
  const explicit = cleanText(input.explicitIdempotencyKey)
    || firstText(input.body, 'idempotencyKey', 'idempotency_key')
  if (explicit) return explicit

  const environmentRef = firstText(input.body, 'environmentCode', 'environment_code')
    || firstText(input.body, 'environmentName', 'environment_name')
  const deliveryAssetCode = firstText(input.body, 'deliveryAssetCode', 'delivery_asset_code') || 'no-asset'
  const relationType = normalizeProjectEnvironmentRelationType(firstText(input.body, 'relationType', 'relation_type'))
  return `aims:project-environment:${input.projectCode}:${environmentRef}:${deliveryAssetCode}:${relationType}`
}

export function buildAssetsEnvironmentUpsertPayload(input: AssetsEnvironmentUpsertPayloadInput) {
  const requestedEnvironmentStatus = firstText(input.body, 'environmentStatus', 'environment_status')
  const requestedEnvironmentName = firstText(input.body, 'environmentName', 'environment_name')
  return {
    environmentCode: cleanText(input.requestedEnvironmentCode) || undefined,
    idempotencyKey: input.idempotencyKey,
    customerCode: input.customerCode,
    contractCode: cleanText(input.contractCode) || undefined,
    sourceProjectCode: input.projectCode,
    environmentName: requestedEnvironmentName || undefined,
    environmentType: firstText(input.body, 'environmentType', 'environment_type') || 'customer_prod',
    status: environmentUpsertStatusValue({
      requestedEnvironmentCode: input.requestedEnvironmentCode,
      requestedEnvironmentStatus
    }),
    deploymentMode: firstText(input.body, 'deploymentMode', 'deployment_mode') || undefined,
    region: firstText(input.body, 'region') || undefined,
    description: firstText(input.body, 'description') || undefined,
    operatorUid: input.operatorUid
  }
}
