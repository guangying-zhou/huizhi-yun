import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { optionalReadPagination } from '@hzy/foundation/shared/utils/optionalReadPagination'
import { readHostProjectOutput, readHostProjectRepoCandidates } from '../../../aims/layer/server/index'
import { enterpriseAimsDocumentReadPermitProvider } from './enterpriseAimsProjectDocumentPermits'

export async function enterpriseAimsProjectOutput(event: H3Event) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const raw = getQuery(event)
  if (Object.keys(raw).some(key => !['page', 'pageSize'].includes(key))) throw createError({ statusCode: 400, message: '成果页分页参数无效' })
  try {
    optionalReadPagination(raw)
  } catch {
    throw createError({ statusCode: 400, message: '成果页分页参数无效' })
  }
  return await readHostProjectOutput(event, enterpriseAimsDocumentReadPermitProvider(event), getRouterParam(event, 'id') || '', Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, String(value)])))
}
export async function enterpriseAimsProjectRepoCandidates(event: H3Event) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '仓库候选不接受查询参数' })
  return await readHostProjectRepoCandidates(event, getRouterParam(event, 'id') || '')
}
