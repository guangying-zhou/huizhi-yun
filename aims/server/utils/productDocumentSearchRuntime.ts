import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { productModelPageInput } from './productModelInput'
import { crossDependencyProductCode } from './productCrossDependencyInput'
import { searchProductDocuments } from './productDocumentCodocs'

export async function handleProductDocumentSearch(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'GET') throw createError({ statusCode: 405, message: '文档搜索须使用 GET' })
  const productCode = getRouterParam(event, 'productCode') || ''
  const { search = '', ...query } = getQuery(event)
  const page = productModelPageInput(query)
  if (!crossDependencyProductCode(productCode) || !page || typeof search !== 'string') throw createError({ statusCode: 400, message: '文档搜索条件无效' })
  const data = await searchProductDocuments(event, productCode, search.trim(), page.page, page.page_size)
  return { code: 0, data }
}
