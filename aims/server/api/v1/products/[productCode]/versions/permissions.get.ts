import { createError, getRouterParam, setHeader } from 'h3'
import { checkProductPermission, requireProductPermission } from '../../../../../utils/productAuthorization'
import { hasProductControlCharacter } from '../../../../../utils/productWorkspaceInput'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '产品编码无效' })
  const facts = await requireProductPermission(event, code, 'product_versions', 'view')
  const edit = await checkProductPermission(event, code, 'product_versions', 'edit')
  const accept = await checkProductPermission(event, code, 'product_versions', 'accept')
  const publish = await checkProductPermission(event, code, 'product_versions', 'publish')
  const deletion = await checkProductPermission(event, code, 'product_versions', 'delete')
  const archive = await checkProductPermission(event, code, 'product_versions', 'archive')
  const reopen = await checkProductPermission(event, code, 'product_versions', 'reopen')
  const prioritize = await checkProductPermission(event, code, 'product_priorities', 'prioritize')
  return { code: 0, data: { product_code: code, actor_uid: facts.actor_uid, status: facts.status, revision: facts.revision, edit: edit.allowed, scope_create: edit.allowed && prioritize.allowed, accept: accept.allowed, publish: publish.allowed, reopen: reopen.allowed, archive: archive.allowed, delete: deletion.allowed } }
})
