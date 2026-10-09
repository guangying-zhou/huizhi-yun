import { readHostProjectDocumentSource, isValidHostGitRepositoryPath } from '../../../aims/layer/server/index'
import { enterpriseAimsDocumentReadPermitProvider } from './enterpriseAimsProjectDocumentPermits'
import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'

type Action = 'dept-documents' | 'project-documents' | 'repo-tree' | 'repo-doc'
// 四个动作都是候选来源的只读查询，服务端按操作者本人的部门／项目／仓库访问权
// 重新判定，因此共用一个 capability。
const numericID = /^[1-9]\d*$/
const code = /^[A-Za-z0-9._-]{1,120}$/
const ref = /^[A-Za-z0-9._/-]{1,200}$/
function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function queryText(event: H3Event, keys: string[]) {
  const query = getQuery(event)
  for (const key of keys) {
    const raw = query[key]
    if (Array.isArray(raw)) throw createError({ statusCode: 400, message: '项目文档来源参数无效' })
    const value = text(raw)
    if (value) return value
  }
  return ''
}

async function proxy(event: H3Event, action: Action, command: Record<string, string>) {
  setHeader(event, 'Cache-Control', 'no-store')
  return await readHostProjectDocumentSource(event, enterpriseAimsDocumentReadPermitProvider(event), action, command)
}

function requireProjectId(event: H3Event) {
  const projectId = queryText(event, ['aimsProjectId', 'aims_project_id'])
  if (!numericID.test(projectId) || !Number.isSafeInteger(Number(projectId))) throw createError({ statusCode: 400, message: 'aimsProjectId 无效' })
  return projectId
}

function repoCode(event: H3Event) {
  const value = text(getRouterParam(event, 'projectCode', { decode: true }))
  if (!isValidHostGitRepositoryPath(value)) throw createError({ statusCode: 400, message: '仓库标识无效' })
  return value
}

function gitRef(event: H3Event): Record<string, string> {
  const value = queryText(event, ['ref'])
  if (value && !ref.test(value)) throw createError({ statusCode: 400, message: 'ref 无效' })
  return value ? { ref: value } : {}
}

export function enterpriseAimsDepartmentDocuments(event: H3Event) {
  const deptCode = queryText(event, ['deptCode', 'dept_code'])
  if (!code.test(deptCode)) throw createError({ statusCode: 400, message: 'deptCode 不能为空' })
  return proxy(event, 'dept-documents', { deptCode })
}

export function enterpriseAimsPortfolioDocuments(event: H3Event) {
  return proxy(event, 'project-documents', { projectId: requireProjectId(event) })
}

export function enterpriseAimsRepoDocsTree(event: H3Event) {
  return proxy(event, 'repo-tree', { projectId: requireProjectId(event), repoProjectCode: repoCode(event), ...gitRef(event) })
}

export function enterpriseAimsRepoDoc(event: H3Event) {
  const path = queryText(event, ['path'])
  if (!path || path.length > 400) throw createError({ statusCode: 400, message: 'path 无效' })
  const commitId = queryText(event, ['commit_id', 'commitId'])
  if (commitId && !code.test(commitId)) throw createError({ statusCode: 400, message: 'commit_id 无效' })
  const command: Record<string, string> = { projectId: requireProjectId(event), repoProjectCode: repoCode(event), path, ...gitRef(event) }
  const documentId = queryText(event, ['documentId'])
  if (documentId && (!numericID.test(documentId) || !Number.isSafeInteger(Number(documentId)))) throw createError({ statusCode: 400, message: 'documentId 无效' })
  if (documentId) command.documentId = documentId
  if (commitId) command.commitId = commitId
  return proxy(event, 'repo-doc', command)
}
