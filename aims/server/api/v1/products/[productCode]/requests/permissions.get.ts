import { createError, defineEventHandler, getRouterParam, setHeader, type H3Event } from 'h3'
import { checkProductPermission, requireProductPermission, type ProductAuthorizationSource } from '../../../../../utils/productAuthorization'
import { hasProductControlCharacter } from '../../../../../utils/productWorkspaceInput'

export async function handleProductRequestPermissions(event: H3Event, source?: ProductAuthorizationSource) {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '产品编码无效' })
  const facts = await requireProductPermission(event, code, 'product_requests', 'view', source)
  const [create, edit, decide, remove] = await Promise.all(['create', 'edit', 'decide', 'delete'].map(action => checkProductPermission(event, code, 'product_requests', action, source)))
  return { code: 0, data: { product_code: code, status: facts.status, revision: facts.revision, create: create!.allowed, edit: edit!.allowed, decide: decide!.allowed, delete: remove!.allowed } }
}

export default defineEventHandler(event => handleProductRequestPermissions(event))
