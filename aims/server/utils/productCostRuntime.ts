import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { crossDependencyProductCode } from './productCrossDependencyInput'
import { readProductCostFromFinance } from './productCostFinance'

export async function handleProductCost(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'GET') throw createError({ statusCode: 405, message: '经营查询须使用 GET' })
  const productCode = getRouterParam(event, 'productCode') || ''
  const query = getQuery(event)
  const { projectCode, periodMonth } = query
  if (Object.keys(query).length !== 2 || typeof projectCode !== 'string' || typeof periodMonth !== 'string'
    || !crossDependencyProductCode(productCode) || !crossDependencyProductCode(projectCode) || [...projectCode].length > 50
    || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(periodMonth) || periodMonth.startsWith('0000')) {
    throw createError({ statusCode: 400, message: '请选择有效项目和经营期间' })
  }
  return { code: 0, data: await readProductCostFromFinance(event, productCode, projectCode, periodMonth) }
}
