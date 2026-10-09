import { createError, getQuery, setHeader, type H3Event } from 'h3'
import { readProductCostRulesFromFinance } from './productCostRulesFinance'

export async function handleProductCostRulesRead(event: H3Event, projectId: string) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'GET') throw createError({ statusCode: 405, message: '读取规则须使用 GET' })
  const query = getQuery(event)
  if (Object.keys(query).length !== 2 || typeof query.projectCode !== 'string' || typeof query.periodMonth !== 'string') {
    throw createError({ statusCode: 400, message: '须指定项目编码和月份' })
  }
  return { code: 0, data: await readProductCostRulesFromFinance(event, projectId, query.projectCode, query.periodMonth) }
}
