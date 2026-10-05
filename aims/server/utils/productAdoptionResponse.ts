import type { ProductAdoptionInstance, ProductAdoptionPage, ProductAdoptionSummary } from '../../app/types/productAdoption'

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.isWellFormed() && value.length > 0 && value === value.trim() && [...value].length <= max && !/[\p{Cc}]/u.test(value)
const strings = (value: unknown, max: number): value is string[] => Array.isArray(value) && value.every(item => text(item, max)) && new Set(value).size === value.length
const summaryFields = ['instances', 'environments', 'customers', 'productionInstances', 'unknownVersionInstances', 'conflictingVersionInstances'] as const
const roles = new Set(['primary', 'test', 'production', 'backup', 'disaster_recovery', 'training', 'other'])
const statuses = new Set(['planned', 'provisioning', 'deployed', 'online', 'accepted', 'suspended', 'removed'])

export function parseProductAdoptionResponse(raw: unknown, productCode: string, page: number, pageSize: number): ProductAdoptionPage | null {
  if (!object(raw) || raw.productCode !== productCode || raw.page !== page || raw.pageSize !== pageSize || !count(raw.total)
    || !text(raw.queriedAt, 64) || !/^\d{4}-\d{2}-\d{2}T/.test(raw.queriedAt) || !Number.isFinite(Date.parse(raw.queriedAt))
    || !object(raw.summary) || !Array.isArray(raw.items)
    || raw.items.length !== Math.min(pageSize, Math.max(0, raw.total - (page - 1) * pageSize))) return null
  const summary = {} as ProductAdoptionSummary
  for (const key of summaryFields) {
    if (!count(raw.summary[key])) return null
    summary[key] = raw.summary[key]
  }
  if (summary.instances > raw.total || summaryFields.slice(1).some(key => summary[key] > summary.instances)) return null
  const pairs = new Set<string>()
  const items: ProductAdoptionInstance[] = []
  for (const row of raw.items) {
    if (!object(row) || !text(row.deliveryAssetCode, 64) || !text(row.environmentCode, 64) || !(row.customerCode === '' || text(row.customerCode, 100))
      || !strings(row.roles, 32) || !row.roles.length || row.roles.some(role => !roles.has(role))
      || !strings(row.deploymentStatuses, 32) || !row.deploymentStatuses.length || row.deploymentStatuses.some(status => !statuses.has(status))
      || !strings(row.versions, 100) || ['versionUnknown', 'versionConflict', 'adopted', 'production'].some(key => typeof row[key] !== 'boolean')) return null
    const adopted = row.deploymentStatuses.some(status => ['deployed', 'online', 'accepted'].includes(status))
    if (row.adopted !== adopted || row.versionConflict !== (row.versions.length > 1)
      || (row.production && (!adopted || !row.roles.includes('production')))
      || (!adopted && (row.versionUnknown || row.versions.length)) || (adopted && !row.versions.length && !row.versionUnknown)) return null
    const pair = JSON.stringify([row.deliveryAssetCode, row.environmentCode])
    if (pairs.has(pair)) return null
    pairs.add(pair)
    items.push({ deliveryAssetCode: row.deliveryAssetCode, environmentCode: row.environmentCode, customerCode: row.customerCode,
      roles: row.roles, deploymentStatuses: row.deploymentStatuses, versions: row.versions,
      versionUnknown: row.versionUnknown as boolean, versionConflict: row.versionConflict as boolean, adopted, production: row.production as boolean })
  }
  if (items.filter(row => row.adopted).length > summary.instances
    || items.filter(row => row.production).length > summary.productionInstances
    || items.filter(row => row.versionUnknown).length > summary.unknownVersionInstances
    || items.filter(row => row.versionConflict).length > summary.conflictingVersionInstances) return null
  return { productCode, queriedAt: raw.queriedAt, summary, items, total: raw.total, page, pageSize }
}
