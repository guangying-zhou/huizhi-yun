import { createError, getHeader, getQuery, readBody, type H3Event } from 'h3'
import { consoleDirectoryReadParam } from './consoleDirectoryRead'
import { fetchConsoleUserApi } from '@hzy/foundation/server/utils/consoleUserApi'

const safeCode = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value) && value !== '.' && value !== '..'
const invalid = () => createError({ statusCode: 400, message: 'Invalid project request' })
export async function consoleProjectWrite(event: H3Event, action: 'create' | 'update' | 'delete' | 'members.replace') {
  if (Object.keys(getQuery(event)).length) throw invalid()
  if (!/^[A-Za-z0-9:_-]{8,128}$/.test(getHeader(event, 'idempotency-key') || '')) throw createError({ statusCode: 400, message: 'Idempotency-Key is required' })
  const params: Record<string, string> = action === 'update' || action === 'delete' ? { projectCode: consoleDirectoryReadParam(event, 'projectCode') } : {}
  if (params.projectCode === 'members') throw invalid()
  if (Number(getHeader(event, 'content-length') || 0) > 32768) throw createError({ statusCode: 413, message: 'Project request too large' })
  const raw: unknown = await readBody(event)
  if (raw === null || (raw !== undefined && (typeof raw !== 'object' || Array.isArray(raw)))) throw invalid()
  const body = (raw || {}) as Record<string, unknown>
  if (Buffer.byteLength(JSON.stringify(body)) > 32768) throw createError({ statusCode: 413, message: 'Project request too large' })
  const fields = ['name', 'parentProjectCode', 'projectType', 'deptCode', 'ownerUid', 'leaderUid', 'repoUrl', 'description', 'status']
  const allowed = action === 'create' ? ['projectCode', ...fields] : action === 'update' ? fields : action === 'members.replace' ? ['projectCode', 'members'] : []
  if (Object.keys(body).some(field => !allowed.includes(field))) throw invalid()
  if (action === 'create' && (body.projectCode === 'members' || !safeCode(body.projectCode) || typeof body.name !== 'string' || !body.name.trim())) throw invalid()
  if (action === 'update' && !Object.keys(body).length) throw invalid()
  if (action === 'members.replace') {
    if (body.projectCode === 'members' || !safeCode(body.projectCode) || !Array.isArray(body.members) || body.members.length > 100) throw invalid()
    const seen = new Set<string>()
    for (const member of body.members) {
      if (!member || typeof member !== 'object' || Array.isArray(member) || Object.keys(member).some(field => !['uid', 'role'].includes(field)) || !safeCode(member.uid) || !['owner', 'admin', 'member', 'viewer'].includes(member.role) || seen.has(member.uid)) throw invalid()
      seen.add(member.uid)
    }
  } else {
    for (const [field, value] of Object.entries(body)) {
      let valid = false
      if (field === 'projectCode') valid = safeCode(value)
      else if (field === 'name') valid = typeof value === 'string' && Boolean(value.trim()) && value.length <= 255
      else if (['parentProjectCode', 'deptCode', 'ownerUid', 'leaderUid'].includes(field)) valid = value === null || safeCode(value)
      else if (field === 'projectType') valid = typeof value === 'string' && ['project', 'group', 'template'].includes(value)
      else if (field === 'status') valid = typeof value === 'string' && ['active', 'inactive', 'archived'].includes(value)
      else if (field === 'repoUrl' || field === 'description') valid = value === null || (typeof value === 'string' && value.length <= (field === 'repoUrl' ? 2048 : 4000))
      if (!valid) throw invalid()
    }
  }
  return fetchConsoleUserApi(event, `directory.projects.${action}`, { params, body })
}
