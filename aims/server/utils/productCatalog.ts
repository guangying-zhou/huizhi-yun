import { createError, type H3Event } from 'h3'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import { productCatalogPage } from './productCatalogData'

// Caller must establish products:onboard before requesting candidate data.
export async function fetchProductCatalog(event: H3Event, query: Record<string, string>) {
  const base = resolveServiceAppBaseUrl(event, 'assets', { directTarget: true })
  if (!base) throw createError({ statusCode: 503, message: 'Assets 产品目录未配置' })
  const root = base.replace(/\/+$/, '').replace(/\/api(?:\/v1)?$/, '')
  const token = await requestServiceAccessToken({ event, audience: 'assets', scope: 'assets:product:read' })
  let response: { code: number, data?: unknown }
  try {
    response = await serviceAppFetch(event, 'assets', `${root}/api/v1/service/products/catalog?${new URLSearchParams(query)}`, {
      headers: { ...trustedServiceRequestHeaders(event, 'assets'), authorization: `Bearer ${token}` }, timeout: 10000
    })
  } catch (error) {
    const status = Number((error as { statusCode?: number, status?: number }).statusCode || (error as { status?: number }).status)
    if (status === 401 || status === 403) throw createError({ statusCode: status, message: 'Assets 产品目录服务认证或授权失败' })
    if (status === 400) throw createError({ statusCode: 400, message: 'Assets 产品目录查询参数无效' })
    if (status === 409) {
      throw createError({ statusCode: 409, data: { code: 'product_catalog_changed' }, message: '产品主档已变化，请重新刷新目录' })
    }
    throw createError({ statusCode: 503, message: 'Assets 产品目录暂不可用' })
  }
  const page = response.code === 0 ? productCatalogPage(response.data) : null
  if (!page) throw createError({ statusCode: 503, message: '产品目录响应不完整或版本不兼容' })
  return page
}
