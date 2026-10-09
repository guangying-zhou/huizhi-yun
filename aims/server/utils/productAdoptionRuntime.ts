import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { productModelPageInput } from './productModelInput'
import { crossDependencyProductCode } from './productCrossDependencyInput'
import { readProductAdoptionFromAssets } from './productAdoptionAssets'

export async function handleProductAdoption(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'GET') throw createError({ statusCode: 405, message: '采用查询须使用 GET' })
  const productCode = getRouterParam(event, 'productCode') || ''
  const page = productModelPageInput(getQuery(event))
  if (!crossDependencyProductCode(productCode) || !page) throw createError({ statusCode: 400, message: '产品采用查询参数无效' })
  return { code: 0, data: await readProductAdoptionFromAssets(event, productCode, page.page, page.page_size) }
}
