import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { readHostProjectRequirements, type RequirementReadAction } from '../../../aims/layer/server/index'
import { enterpriseAimsDocumentReadPermitProvider } from './enterpriseAimsProjectDocumentPermits'

type Operation = 'aims.project-requirement-list' | 'aims.project-requirement-view'
const numericID = /^[1-9]\d*$/
const allowed = new Set(['page', 'pageSize', 'search', 'type', 'status', 'priority', 'milestone_id', 'source', 'work_item_id', 'sort', 'order'])
function id(event: H3Event, name: string) {
  const value = String(getRouterParam(event, name) || '').trim()
  if (!numericID.test(value) || !Number.isSafeInteger(Number(value)))
    throw createError({ statusCode: 400, message: '需求或项目标识无效' })
  return value
}
function listQuery(event: H3Event) {
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(getQuery(event))) {
    if (!allowed.has(key) || Array.isArray(raw))
      throw createError({ statusCode: 400, message: '需求筛选参数无效' })
    const value = String(raw ?? '').trim()
    if (!value || value.length > 1000)
      throw createError({ statusCode: 400, message: '需求筛选参数无效' })
    result[key] = value
  } ;
  return result
}
async function read(event: H3Event, operation: Operation, projectId: string, query: Record<string, string>, requirementId = '') {
  setHeader(event, 'Cache-Control', 'no-store')
  return await readHostProjectRequirements(event, enterpriseAimsDocumentReadPermitProvider(event), operation === 'aims.project-requirement-list' ? 'list' : 'view', projectId, requirementId, query)
}

export const enterpriseAimsProjectRequirementList = (event: H3Event) => read(event, 'aims.project-requirement-list', id(event, 'id'), listQuery(event))
export function enterpriseAimsProjectRequirementView(event: H3Event) {
  if (Object.keys(getQuery(event)).length)
    throw createError({ statusCode: 400, message: '需求详情不接受筛选参数' })
  return read(event, 'aims.project-requirement-view', id(event, 'id'), {}, id(event, 'requirementId'))
}

export async function enterpriseAimsRequirementSpec(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const raw = getQuery(event)
  if (Object.keys(raw).some(key => key !== 'include_deleted') || (raw.include_deleted !== undefined && !['0', '1'].includes(String(raw.include_deleted))) || Array.isArray(raw.include_deleted)) throw createError({ statusCode: 400, message: '规格书参数无效' })
  return await readHostProjectRequirements(event, enterpriseAimsDocumentReadPermitProvider(event), 'spec', id(event, 'id'), '', raw.include_deleted === undefined ? {} : { include_deleted: String(raw.include_deleted) })
}
export async function enterpriseAimsRequirementTargets(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const raw = getQuery(event)
  if (Object.keys(raw).some(key => !['type', 'status'].includes(key)) || Object.values(raw).some(v => Array.isArray(v) || typeof v !== 'string' || v.length > 100)) throw createError({ statusCode: 400, message: '需求目标参数无效' })
  return await readHostProjectRequirements(event, enterpriseAimsDocumentReadPermitProvider(event), 'targets', id(event, 'id'), '', raw as Record<string, string>)
}

export async function enterpriseAimsRequirementExtendedRead(event: H3Event, action: RequirementReadAction) {
  setHeader(event, 'Cache-Control', 'no-store')
  const query = getQuery(event)
  const projectLevel = action === 'review-list'
  if (Object.keys(query).some(key => key !== 'projectId') || Array.isArray(query.projectId)) throw createError({ statusCode: 400, message: '需求读取参数无效' })
  const projectId = projectLevel ? id(event, 'id') : String(query.projectId || '')
  if (projectLevel && query.projectId !== undefined && String(query.projectId) !== projectId) throw createError({ statusCode: 400, message: '项目标识不一致' })
  const objectId = projectLevel ? '' : id(event, action === 'review-resolve' ? 'batchId' : 'reqId')
  return await readHostProjectRequirements(event, enterpriseAimsDocumentReadPermitProvider(event), action, projectId, objectId)
}
