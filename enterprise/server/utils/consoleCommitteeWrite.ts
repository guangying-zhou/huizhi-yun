import { createError, getHeader, getQuery, readBody, type H3Event } from 'h3'
import { consoleDirectoryReadParam } from './consoleDirectoryRead'
import { fetchConsoleUserApi } from '@hzy/foundation/server/utils/consoleUserApi'

const safeCode = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value) && value !== '.' && value !== '..'
const roles = ['leader', 'manager', 'member', 'observer']
const invalid = () => createError({ statusCode: 400, message: 'Invalid committee request' })
export async function consoleCommitteeWrite(event: H3Event, action: 'create' | 'update' | 'delete' | 'members.save' | 'members.update' | 'members.remove') {
  if (Object.keys(getQuery(event)).length) throw invalid()
  if (!/^[A-Za-z0-9:_-]{8,128}$/.test(getHeader(event, 'idempotency-key') || '')) throw createError({ statusCode: 400, message: 'Idempotency-Key is required' })
  const params: Record<string, string> = action === 'create' ? {} : { committeeCode: consoleDirectoryReadParam(event, 'committeeCode') }
  if (action === 'members.update' || action === 'members.remove') params.uid = consoleDirectoryReadParam(event, 'uid')
  if (Number(getHeader(event, 'content-length') || 0) > 32768) throw createError({ statusCode: 413, message: 'Committee request too large' })
  const raw: unknown = await readBody(event)
  if (raw === null || (raw !== undefined && (typeof raw !== 'object' || Array.isArray(raw)))) throw invalid()
  const body = (raw || {}) as Record<string, unknown>
  if (Buffer.byteLength(JSON.stringify(body)) > 32768) throw createError({ statusCode: 413, message: 'Committee request too large' })
  const fields = ['name', 'parentDeptCode', 'description', 'sortOrder', 'status']
  const allowed = action === 'create' ? ['committeeCode', ...fields] : action === 'update' ? fields : action === 'members.save' ? ['members'] : action === 'members.update' ? ['role'] : []
  if (Object.keys(body).some(field => !allowed.includes(field))) throw invalid()
  if (action === 'create' && (!safeCode(body.committeeCode) || typeof body.name !== 'string' || !body.name.trim())) throw invalid()
  if (action === 'update' && !Object.keys(body).length) throw invalid()
  if (action === 'members.save') {
    if (!Array.isArray(body.members) || !body.members.length || body.members.length > 100) throw invalid()
    const seen = new Set<string>()
    let leaders = 0
    let managers = 0
    for (const member of body.members) {
      if (!member || typeof member !== 'object' || Array.isArray(member) || Object.keys(member).some(field => !['uid', 'role'].includes(field)) || !safeCode(member.uid) || !roles.includes(member.role) || seen.has(member.uid)) throw invalid()
      seen.add(member.uid)
      if (member.role === 'leader') leaders++
      if (member.role === 'manager') managers++
    }
    if (leaders > 1 || managers > 1) throw invalid()
  } else if (action === 'members.update') {
    if (typeof body.role !== 'string' || !roles.includes(body.role)) throw invalid()
  } else {
    for (const [field, value] of Object.entries(body)) {
      let valid = false
      if (field === 'committeeCode') valid = safeCode(value)
      else if (field === 'name') valid = typeof value === 'string' && Boolean(value.trim()) && value.length <= 255
      else if (field === 'parentDeptCode') valid = value === null || safeCode(value)
      else if (field === 'description') valid = value === null || (typeof value === 'string' && value.length <= 4000)
      else if (field === 'sortOrder') valid = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2147483647
      else if (field === 'status') valid = typeof value === 'string' && ['active', 'inactive'].includes(value)
      if (!valid) throw invalid()
    }
  }
  return fetchConsoleUserApi(event, `directory.committees.${action}`, { params, body })
}
