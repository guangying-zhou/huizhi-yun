import { createError, defineEventHandler, getRouterParam, setHeader, type H3Event } from 'h3'
import { checkProductPermission, requireProductPermission, type ProductAuthorizationSource } from '../../../../../utils/productAuthorization'
import { hasProductControlCharacter } from '../../../../../utils/productWorkspaceInput'

export async function handleProductVersionPermissions(event: H3Event, source?: ProductAuthorizationSource) {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '产品编码无效' })
  const facts = await requireProductPermission(event, code, 'product_versions', 'view', source)
  const edit = await checkProductPermission(event, code, 'product_versions', 'edit', source)
  const accept = await checkProductPermission(event, code, 'product_versions', 'accept', source)
  const publish = await checkProductPermission(event, code, 'product_versions', 'publish', source)
  const deletion = await checkProductPermission(event, code, 'product_versions', 'delete', source)
  const archive = await checkProductPermission(event, code, 'product_versions', 'archive', source)
  const reopen = await checkProductPermission(event, code, 'product_versions', 'reopen', source)
  const prioritize = await checkProductPermission(event, code, 'product_priorities', 'prioritize', source)
  return { code: 0, data: { product_code: code, actor_uid: facts.actor_uid, status: facts.status, revision: facts.revision, edit: edit.allowed, scope_create: edit.allowed && prioritize.allowed, accept: accept.allowed, publish: publish.allowed, reopen: reopen.allowed, archive: archive.allowed, delete: deletion.allowed } }
}

export default defineEventHandler(event => handleProductVersionPermissions(event))
