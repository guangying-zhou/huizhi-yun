import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { readHostProjectDocuments } from '../../../aims/layer/server/index'
import { enterpriseAimsNestedProjectReadPermit } from './enterpriseAimsProjects'

async function read(event: H3Event, detail: boolean) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const projectId = getRouterParam(event, 'id') || ''
  const documentId = detail ? getRouterParam(event, 'documentId') || '' : undefined
  const query: { docCategory?: string } = {}
  for (const [key, value] of Object.entries(getQuery(event))) {
    if (detail || key !== 'docCategory' || typeof value !== 'string') throw createError({ statusCode: 400, message: '项目文档筛选参数无效' })
    query.docCategory = value
  }
  if (!/^[1-9]\d*$/.test(projectId) || !Number.isSafeInteger(Number(projectId))) throw createError({ statusCode: 400, message: '项目标识无效' })
  const scope = await enterpriseAimsNestedProjectReadPermit(event, user, projectId)
  return await readHostProjectDocuments(event, { projectId, documentId, query, projectReadAuthorization: scope.authorization, projectScopeQuery: scope.query })
}

export const enterpriseAimsProjectDocumentList = (event: H3Event) => read(event, false)
export const enterpriseAimsProjectDocumentView = (event: H3Event) => read(event, true)
export async function enterpriseAimsProjectDocumentOpen(event: H3Event) {
  // The Host composes its native Codocs domain; independent Aims open remains
  // unchanged and continues to use its registered Codocs Service API.
  const { openEnterpriseProjectDocument } = await import('./enterpriseAimsProjectDocumentOpen')
  return await openEnterpriseProjectDocument(event, () => read(event, true))
}
