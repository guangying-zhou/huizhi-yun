import { createError, getRouterParam, setHeader } from 'h3'
import { hasProductControlCharacter } from '../../../../utils/productWorkspaceInput'
import { checkProductPermission, requireProductPermission } from '../../../../utils/productAuthorization'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const code = getRouterParam(event, 'productCode') || ''
  if (!code || code !== code.trim() || [...code].length > 64 || hasProductControlCharacter(code) || code.includes('/')) {
    throw createError({ statusCode: 400, message: '无效的产品编码' })
  }
  await requireProductPermission(event, code, 'products', 'view')
  const [edit, archive, restore, admin] = await Promise.all(['edit', 'archive', 'restore', 'admin'].map(action => checkProductPermission(event, code, 'products', action)))
  // UI hints only; each command independently reauthorizes current facts.
  return { code: 0, data: { edit: edit!.allowed, archive: archive!.allowed, restore: restore!.allowed, admin: admin!.allowed } }
})
