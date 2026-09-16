import { createError, getQuery, setHeader } from 'h3'
import { requireProductOnboardPermission } from '../../utils/productGlobalAuthorization'
import { productLineCode } from '../../utils/productLineInput'
import { fetchProductLineCatalog } from '../../utils/productLineCatalog'
import { fetchProductCatalog } from '../../utils/productCatalog'

export default defineEventHandler(async (event) => {
  await requireProductOnboardPermission(event)
  setHeader(event, 'Cache-Control', 'no-store')
  const raw = getQuery(event)
  if (raw.mode === 'line') {
    if (Object.keys(raw).some(key => !['mode', 'productLine'].includes(key)) || !productLineCode(raw.productLine)) throw createError({ statusCode: 400, message: '产品线无效' })
    const source = await fetchProductLineCatalog(event, raw.productLine)
    return { code: 0, data: { ...source, items: source.items.map(i => ({ product_code: i.product_code, product_name: i.product_name, onboardable: i.onboardable })) } }
  }
  const fields = ['keyword', 'page', 'pageSize', 'productLine', 'watermark']
  if (Object.keys(raw).some(key => !fields.includes(key)) || Object.values(raw).some(value => typeof value !== 'string')) throw createError({ statusCode: 400, message: '产品目录筛选参数无效' })
  const query = raw as Record<string, string>
  if ((query.keyword?.length || 0) > 200 || (query.productLine?.length || 0) > 64
    || (query.page && (!/^[1-9]\d*$/.test(query.page) || Number(query.page) > 1000000))
    || (Number(query.page || '1') > 1 && !query.watermark)
    || (query.watermark?.length || 0) > 191
    || (query.pageSize && (!/^[1-9]\d*$/.test(query.pageSize) || Number(query.pageSize) > 100))) throw createError({ statusCode: 400, message: '产品目录分页或筛选参数无效' })
  return { code: 0, data: await fetchProductCatalog(event, query) }
})
