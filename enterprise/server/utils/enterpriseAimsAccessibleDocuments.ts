import { readHostAccessibleProjectDocuments } from '../../../aims/layer/server/index'
import { enterpriseAimsDocumentReadPermitProvider } from './enterpriseAimsProjectDocumentPermits'
import { createError, getQuery, setHeader, type H3Event } from 'h3'

export async function enterpriseAimsAccessibleProjectDocuments(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const query = getQuery(event)
  if (Object.keys(query).some(key => !['projectId', 'project_id'].includes(key)) || (query.projectId !== undefined && query.project_id !== undefined)) throw createError({ statusCode: 400, message: '项目文档筛选参数无效' })
  const projectId = query.projectId ?? query.project_id
  if (typeof projectId !== 'string' || !/^[1-9][0-9]{0,17}$/.test(projectId) || !Number.isSafeInteger(Number(projectId))) throw createError({ statusCode: 400, message: '请选择项目' })
  return await readHostAccessibleProjectDocuments(event, enterpriseAimsDocumentReadPermitProvider(event), projectId)
}
