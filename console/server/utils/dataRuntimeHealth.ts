export const DATA_RUNTIME_PRODUCT = 'hzy-data-runtime'

export interface NormalizedDataRuntimeHealth {
  reachable: boolean
  healthPath: string | null
  runtimeProduct: string | null
  status: string
  version: string | null
  commit: string | null
  builtAt: string | null
  tenant: string | null
  deployment: string | null
  apps: Record<string, unknown>
  raw: Record<string, unknown> | null
  error: string | null
  checkedAt: string
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function normalizeDataRuntimeHealth(value: unknown, healthPath: string): NormalizedDataRuntimeHealth {
  const item = objectValue(value)
  const runtimeProduct = stringValue(item.runtimeProduct)
  const apps = objectValue(item.apps)
  const legacyDataRuntime = !runtimeProduct
    && stringValue(item.status) !== ''
    && Object.keys(apps).length > 0

  if (runtimeProduct !== DATA_RUNTIME_PRODUCT && !legacyDataRuntime) {
    throw new Error('configured endpoint is not hzy-data-runtime')
  }

  return {
    reachable: true,
    healthPath,
    runtimeProduct: runtimeProduct || 'hzy-data-runtime-legacy',
    status: stringValue(item.status) || 'unknown',
    version: stringValue(item.version) || null,
    commit: stringValue(item.commit) || null,
    builtAt: stringValue(item.builtAt) || null,
    tenant: stringValue(item.tenant) || null,
    deployment: stringValue(item.deployment) || null,
    apps,
    raw: item,
    error: null,
    checkedAt: new Date().toISOString()
  }
}
