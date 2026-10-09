import { productModelPageInput } from './productModelInput'
import { productVersionID } from './productVersionInput'

export function productReleaseDiffInput(raw: Record<string, unknown>) {
  if (Object.keys(raw).some(key => !['beforeVersionId', 'beforeRecordId', 'afterVersionId', 'afterRecordId', 'page', 'pageSize'].includes(key))) return null
  const beforeVersion = productVersionID(raw.beforeVersionId), beforeRecord = productVersionID(raw.beforeRecordId)
  const afterVersion = productVersionID(raw.afterVersionId), afterRecord = productVersionID(raw.afterRecordId)
  const page = productModelPageInput({ page: raw.page, pageSize: raw.pageSize })
  if (!beforeVersion || !beforeRecord || !afterVersion || !afterRecord || !page) return null
  return { before_version_id: beforeVersion, before_record_id: beforeRecord, after_version_id: afterVersion, after_record_id: afterRecord, ...page }
}
