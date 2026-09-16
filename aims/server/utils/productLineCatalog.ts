import { createError, type H3Event } from 'h3'
import { fetchProductCatalog } from './productCatalog'

export async function fetchProductLineCatalog(event: H3Event, line: string, expectedWatermark?: string) {
  const first = await fetchProductCatalog(event, { productLine: line, page: '1', pageSize: '100', ...(expectedWatermark ? { watermark: expectedWatermark } : {}) })
  if (!first.total || first.total > 1000) throw createError({ statusCode: 409, message: '产品线为空或超过单次统一管理上限（1000 个产品）' })
  const items = [...first.items]
  let next = first.nextPage
  while (next !== null) {
    const page = await fetchProductCatalog(event, { productLine: line, page: String(next), pageSize: '100', watermark: first.watermark })
    if (page.watermark !== first.watermark || page.total !== first.total || page.page !== next) throw createError({ statusCode: 409, message: '产品线目录已变化，请重新确认' })
    items.push(...page.items)
    next = page.nextPage
  }
  if (items.length !== first.total || new Set(items.map(i => i.product_code)).size !== items.length || items.some(i => i.product_line !== line || i.product_code.startsWith('~line-'))) throw createError({ statusCode: 503, message: '产品线目录响应不完整' })
  return { line_code: line, label: items[0]?.product_line_label || line, watermark: first.watermark, items }
}
