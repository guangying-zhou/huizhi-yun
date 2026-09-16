import { createError, getRouterParam, setHeader } from 'h3'
import { checkProductPermission, requireProductPermission } from '../../../../../utils/productAuthorization'
import { hasProductControlCharacter } from '../../../../../utils/productWorkspaceInput'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '产品编码无效' })
  const facts = await requireProductPermission(event, code, 'product_priorities', 'view')
  const edit = await checkProductPermission(event, code, 'product_priorities', 'edit')
  const handoff = await checkProductPermission(event, code, 'product_priorities', 'handoff')
  const comment = await checkProductPermission(event, code, 'product_priorities', 'comment')
  return { code: 0, data: { product_code: code, status: facts.status, revision: facts.revision, actor_uid: facts.actor_uid, comment: comment.allowed, edit: edit.allowed, handoff: handoff.allowed } }
})
