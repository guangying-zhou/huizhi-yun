import { createError, getHeader, readMultipartFormData } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { appCode } from '~~/app/config/permissions'
import { requirePeopleGlobalEmployeeScope } from '~~/server/utils/peopleGlobalScope'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'
import {
  EMPLOYEE_ARCHIVE_MAX_BYTES,
  parseEmployeeArchiveCsv
} from '~~/server/utils/employeeArchiveCsv'

interface RuntimeResponse {
  code?: number
  message?: string
  data?: Record<string, unknown>
}

const text = (value: unknown) => String(value || '').trim()

export default defineEventHandler(async (event) => {
  // 必须先鉴权和限制 Content-Length，再读取包含身份证号的 multipart 正文。
  const snapshot = await assertPeoplePermission(event, 'employees', 'admin')
  const actorUid = text(snapshot.uid)
  if (!actorUid) throw createError({ statusCode: 403, message: '需要已验证的操作人身份。' })
  const scopeQuery = await requirePeopleGlobalEmployeeScope(event, actorUid)

  const contentLength = Number(getHeader(event, 'content-length') || 0)
  if (contentLength > EMPLOYEE_ARCHIVE_MAX_BYTES) {
    throw createError({ statusCode: 413, message: 'CSV 文件不能超过 2 MB。' })
  }
  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.name === 'file' && part.data?.length)
  if (!file) throw createError({ statusCode: 400, message: '请选择 employee.csv 文件。' })
  if (file.data.length > EMPLOYEE_ARCHIVE_MAX_BYTES) {
    throw createError({ statusCode: 413, message: 'CSV 文件不能超过 2 MB。' })
  }
  let content = ''
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(file.data)
  } catch {
    throw createError({ statusCode: 400, message: 'CSV 必须使用 UTF-8 编码。' })
  }
  const dryRunPart = parts?.find(part => part.name === 'dryRun')
  const dryRun = text(dryRunPart ? new TextDecoder().decode(dryRunPart.data) : '') !== 'false'
  const items = parseEmployeeArchiveCsv(content)

  const runtime = await maybeCallTenantRuntime<RuntimeResponse>(
    event,
    '/v1/people/employee-private-profiles:import',
    {
      appCode,
      scope: 'people.write',
      method: 'POST',
      query: { ...scopeQuery, current_user: actorUid },
      body: { dry_run: dryRun, items }
    }
  )
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'People tenant-runtime is not configured' })
  }
  return runtime.data
})
