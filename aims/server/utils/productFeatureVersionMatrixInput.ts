import { productModelPageInput } from './productModelInput'
import { productVersionID } from './productVersionInput'

export function productFeatureVersionMatrixInput(raw: Record<string, unknown>) {
  if (Object.keys(raw).some(key => !['versionIds', 'page', 'pageSize'].includes(key)) || typeof raw.versionIds !== 'string') return null
  const values = raw.versionIds.split(',')
  if (values.length < 1 || values.length > 10) return null
  const ids = values.map(productVersionID)
  const page = productModelPageInput({ page: raw.page, pageSize: raw.pageSize })
  if (!page || ids.some(id => id === null) || new Set(ids).size !== ids.length) return null
  return { version_ids: ids as number[], ...page }
}
