import { createError, getHeader, getQuery, readBody, type H3Event } from 'h3'
import { consoleDirectoryReadParam } from './consoleDirectoryRead'
import { fetchConsoleUserApi } from '@hzy/foundation/server/utils/consoleUserApi'

const safeCode = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value) && value !== '.' && value !== '..'
export async function consoleDepartmentWrite(event: H3Event, action: 'create' | 'update' | 'delete') {
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: 'Unsupported query' })
  const key = getHeader(event, 'idempotency-key') || ''
  if (!/^[A-Za-z0-9:_-]{8,128}$/.test(key)) throw createError({ statusCode: 400, message: 'Idempotency-Key is required' })
  const params: Record<string, string> = action === 'create' ? {} : { deptCode: consoleDirectoryReadParam(event, 'deptCode') }
  const size = Number(getHeader(event, 'content-length') || 0)
  if (size > 16384) throw createError({ statusCode: 413, message: 'Department request too large' })
  const raw: unknown = await readBody(event)
  if (raw === null || (raw !== undefined && (typeof raw !== 'object' || Array.isArray(raw)))) throw createError({ statusCode: 400, message: 'Invalid department body' })
  const body = (raw || {}) as Record<string, unknown>
  if (Buffer.byteLength(JSON.stringify(body)) > 16384) throw createError({ statusCode: 413, message: 'Department request too large' })
  const allowed = action === 'create' ? ['deptCode', 'name', 'parentDeptCode', 'managerId', 'leaderId', 'orgType', 'deptCategory', 'description', 'sortOrder'] : action === 'update' ? ['name', 'parentDeptCode', 'managerId', 'leaderId', 'orgType', 'deptCategory', 'description', 'sortOrder'] : []
  if (Object.keys(body).some(field => !allowed.includes(field))) throw createError({ statusCode: 400, message: 'Unsupported department field' })
  if (action === 'create' && (!safeCode(body.deptCode) || typeof body.name !== 'string' || !body.name.trim())) throw createError({ statusCode: 400, message: 'Department code and name required' })
  if (action === 'update' && !Object.keys(body).length) throw createError({ statusCode: 400, message: 'Department changes required' })
  for (const [field, value] of Object.entries(body)) {
    let valid = false
    if (field === 'deptCode') valid = safeCode(value)
    else if (field === 'name') valid = typeof value === 'string' && Boolean(value.trim()) && value.length <= 255
    else if (['parentDeptCode', 'managerId', 'leaderId'].includes(field)) valid = value === null || safeCode(value)
    else if (field === 'orgType') valid = ['department', 'committee', 'virtual'].includes(String(value)) && typeof value === 'string'
    else if (field === 'deptCategory') valid = value === null || (['1', '2', '3', '4'].includes(String(value)) && typeof value === 'string')
    else if (field === 'description') valid = value === null || (typeof value === 'string' && value.length <= 4000)
    else if (field === 'sortOrder') valid = typeof value === 'number' && Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647
    if (!valid) throw createError({ statusCode: 400, message: 'Invalid department field' })
  }
  return fetchConsoleUserApi(event, `directory.departments.${action}`, { params, body })
}
