import { createError, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface RuntimeProductPage {
  items?: Array<Record<string, unknown>>
  total?: number
  page?: number
  pageSize?: number
}

function normalize(value: unknown) {
  return String(value || '').trim()
}

function normalizeCodes(codes: unknown) {
  if (Array.isArray(codes)) {
    return [...new Set(codes.map(normalize).filter(Boolean))]
  }
  return [...new Set(normalize(codes).split(',').map(item => item.trim()).filter(Boolean))]
}

function mapProduct(row: Record<string, unknown>) {
  return {
    id: row.id,
    productCode: row.product_code,
    productName: row.product_name,
    productLine: row.product_line,
    customerDomain: row.customer_domain ?? null,
    businessDomain: row.business_domain ?? null,
    productLevel: row.product_level ?? null,
    assetLevel: row.asset_level ?? null,
    productizationValueLevel: row.productization_value_level ?? null,
    status: row.status,
    buildStage: row.build_stage ?? null,
    projectCode: row.project_code ?? null,
    currentVersion: row.current_version ?? null,
    targetVersion: row.target_version ?? null,
    supportedTerminals: row.supported_terminals ?? null,
    coveredLegacySystems: row.covered_legacy_systems ?? null,
    summary: row.summary ?? null,
    businessOwnerUid: row.business_owner_uid ?? null,
    technicalOwnerUid: row.technical_owner_uid ?? null,
    notes: row.notes ?? null,
    assetCount: row.asset_count ?? 0,
    baseCount: row.base_count ?? 0,
    builtAt: row.built_at ?? null
  }
}

async function fetchProductPage(event: H3Event, query: Record<string, unknown>) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<RuntimeProductPage>>(event, '/v1/assets/products', {
    appCode: 'assets',
    scope: 'assets.read',
    method: 'GET',
    query
  })

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Assets tenant-runtime is required for product service API.'
    })
  }

  const envelope = runtime.data
  if (envelope.code !== undefined && envelope.code !== 0) {
    throw createError({
      statusCode: 502,
      message: envelope.message || 'Assets tenant-runtime returned an error.'
    })
  }

  return envelope.data || { items: [], total: 0, page: 1, pageSize: 0 }
}

export async function resolveServiceProducts(event: H3Event, input: { keyword?: unknown, codes?: unknown }) {
  const codes = normalizeCodes(input.codes)
  if (codes.length > 0) {
    const items: Array<ReturnType<typeof mapProduct>> = []
    for (const code of codes) {
      const page = await fetchProductPage(event, { product_code: code, pageSize: 1 })
      for (const row of page.items || []) {
        items.push(mapProduct(row))
      }
    }
    return { items, total: items.length, page: 1, pageSize: items.length }
  }

  const keyword = normalize(input.keyword)
  const page = await fetchProductPage(event, {
    ...(keyword ? { keyword } : {}),
    pageSize: 100
  })
  const items = (page.items || []).map(mapProduct)
  return {
    items,
    total: page.total ?? items.length,
    page: page.page ?? 1,
    pageSize: page.pageSize ?? items.length
  }
}
