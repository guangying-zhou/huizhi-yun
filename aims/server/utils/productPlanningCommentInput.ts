import { productRequestPageInput } from './productRequestInput'

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
export function productPlanningCommentListInput(raw: Record<string, unknown>, itemID: string) {
  if (!uuid(itemID) || Object.keys(raw).some(key => !['page', 'pageSize'].includes(key))) return null
  const page = productRequestPageInput(raw)
  return page ? { item_biz_id: itemID, page: page.page, page_size: page.page_size } : null
}
export function productPlanningCommentWriteInput(raw: unknown, itemID: string, action: 'create' | 'edit' | 'delete', commentID?: string) {
  if (!uuid(itemID) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const keys = ['expectedRevision', ...(action === 'create' ? [] : ['expectedCommentRevision']), ...(action === 'delete' ? [] : ['body'])]
  if (Object.keys(value).some(key => !keys.includes(key))) return null
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 1) return null
  const id = commentID && /^[1-9]\d*$/.test(commentID) ? Number(commentID) : NaN
  if (action !== 'create' && (!Number.isSafeInteger(id) || !Number.isSafeInteger(value.expectedCommentRevision) || Number(value.expectedCommentRevision) < 1)) return null
  if (action === 'create' && commentID !== undefined) return null
  const body = action === 'delete' ? '' : value.body
  if (typeof body !== 'string' || (action !== 'delete' && !body.trim()) || !body.isWellFormed() || body.includes('\0') || [...body].length > 10000) return null
  return { item_biz_id: itemID, expected_revision: Number(value.expectedRevision), body, ...(action === 'create' ? {} : { comment_id: id, expected_comment_revision: Number(value.expectedCommentRevision) }) }
}

export function productPlanningCommentHistoryInput(raw: Record<string, unknown>, itemID: string, commentID: string) {
  const list = productPlanningCommentListInput(raw, itemID)
  const id = /^[1-9]\d*$/.test(commentID) ? Number(commentID) : NaN
  return list && Number.isSafeInteger(id) ? { ...list, comment_id: id } : null
}
