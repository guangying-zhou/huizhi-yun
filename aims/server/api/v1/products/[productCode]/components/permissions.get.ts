import type { ProductAuthorizationSource } from '../../../../../utils/productAuthorization'
import { createError, getRouterParam, setHeader, type H3Event } from 'h3'
import { checkProductPermission, requireProductPermission } from '../../../../../utils/productAuthorization'
import { hasProductControlCharacter } from '../../../../../utils/productWorkspaceInput'

export async function handleProductComponentPermissions(event: H3Event, source?: ProductAuthorizationSource) {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || [...code].length > 64 || code.includes('/') || hasProductControlCharacter(code)) throw createError({ statusCode: 400, message: '产品编码无效' })
  const facts = await requireProductPermission(event, code, 'product_components', 'view', source)
  const edit = await checkProductPermission(event, code, 'product_components', 'edit', source)
  const deletion = await checkProductPermission(event, code, 'product_components', 'delete', source)
  return { code: 0, data: { product_code: code, status: facts.status, revision: facts.revision, edit: edit.allowed, delete: deletion.allowed } }
}

export default defineEventHandler(event => handleProductComponentPermissions(event))
