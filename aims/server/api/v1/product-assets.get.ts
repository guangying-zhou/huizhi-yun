import { createError, type H3Event } from 'h3'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import { requirePermission } from '~~/server/utils/checkPermission'

interface ServiceEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface ServiceProductPage {
  items?: Array<Record<string, unknown>>
  total?: number
  page?: number
  pageSize?: number
}

function text(value: unknown) {
  return String(value || '').trim()
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function appendPath(baseUrl: string, path: string) {
  const base = trimTrailingSlash(baseUrl)
  const normalizedPath = path.replace(/^\/+/, '')
  if (base.endsWith('/api/v1') && normalizedPath.startsWith('api/v1/')) {
    return `${base}/${normalizedPath.slice('api/v1/'.length)}`
  }
  if (base.endsWith('/api') && normalizedPath.startsWith('api/')) {
    return `${base}/${normalizedPath.slice('api/'.length)}`
  }
  return `${base}/${normalizedPath}`
}

function resolveAssetsBaseUrl(event: H3Event) {
  const configured = resolveServiceAppBaseUrl(event, 'assets', { directTarget: true })
  if (!configured) {
    throw createError({
      statusCode: 503,
      message: 'Assets service API base URL is not configured.'
    })
  }
  return configured
}

function mapProduct(row: Record<string, unknown>) {
  return {
    id: row.id ?? null,
    productCode: row.productCode ?? row.product_code,
    productName: row.productName ?? row.product_name,
    productLine: row.productLine ?? row.product_line,
    productLineLabel: row.productLineLabel ?? row.product_line_label ?? row.productLine ?? row.product_line ?? null,
    productLineSortOrder: row.productLineSortOrder ?? row.product_line_sort_order ?? null,
    customerDomain: row.customerDomain ?? row.customer_domain ?? null,
    businessDomain: row.businessDomain ?? row.business_domain ?? null,
    productLevel: row.productLevel ?? row.product_level ?? null,
    assetLevel: row.assetLevel ?? row.asset_level ?? null,
    productizationValueLevel: row.productizationValueLevel ?? row.productization_value_level ?? null,
    status: row.status,
    buildStage: row.buildStage ?? row.build_stage ?? null,
    projectCode: row.projectCode ?? row.project_code ?? null,
    currentVersion: row.currentVersion ?? row.current_version ?? null,
    targetVersion: row.targetVersion ?? row.target_version ?? null,
    supportedTerminals: row.supportedTerminals ?? row.supported_terminals ?? null,
    coveredLegacySystems: row.coveredLegacySystems ?? row.covered_legacy_systems ?? null,
    summary: row.summary ?? null,
    businessOwnerUid: row.businessOwnerUid ?? row.business_owner_uid ?? null,
    technicalOwnerUid: row.technicalOwnerUid ?? row.technical_owner_uid ?? null,
    notes: row.notes ?? null,
    assetCount: row.assetCount ?? row.asset_count ?? 0,
    baseCount: row.baseCount ?? row.base_count ?? 0,
    builtAt: row.builtAt ?? row.built_at ?? null
  }
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'projects', 'view', '需要 AIMS 项目查看权限才可以查询产品资产')

  const query = getQuery(event)
  const keyword = text(query.keyword || query.search || query.q)
  const token = await requestServiceAccessToken({
    audience: 'assets',
    scope: 'assets:read',
    event
  })
  const assetsBaseUrl = resolveAssetsBaseUrl(event)
  const params = new URLSearchParams()
  if (keyword) params.set('keyword', keyword)
  params.set('pageSize', text(query.pageSize) || '50')

  let response: ServiceEnvelope<ServiceProductPage>
  try {
    response = await serviceAppFetch<ServiceEnvelope<ServiceProductPage>>(
      event,
      'assets',
      `${appendPath(assetsBaseUrl, '/api/v1/service/products')}?${params.toString()}`,
      {
        headers: {
          ...trustedServiceRequestHeaders(event, 'assets'),
          authorization: `Bearer ${token}`
        },
        timeout: 10000
      }
    )
  } catch {
    throw createError({
      statusCode: 503,
      message: 'Assets service API is unavailable.'
    })
  }

  if (response.code !== undefined && response.code !== 0) {
    throw createError({
      statusCode: 502,
      message: response.message || 'Assets service API returned an error.'
    })
  }

  const data = response.data || { items: [], total: 0, page: 1, pageSize: 0 }
  const items = (data.items || []).map(mapProduct)
  return {
    code: 0,
    data: {
      items,
      total: data.total ?? items.length,
      page: data.page ?? 1,
      pageSize: data.pageSize ?? items.length
    }
  }
})
