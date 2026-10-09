import { createHash } from 'node:crypto'
import { createError, getHeader, readMultipartFormData, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { createRuntimeOSSClient } from '../../../codocs/server/utils/oss'
import { departmentCabinetAuthorize, departmentCabinetPermit, departmentCabinetQuery } from './enterpriseCodocsDepartmentCabinet'

const maxSize = 100 * 1024 * 1024
const extensions = new Set('doc docx ppt pptx pdf txt csv rtf zip rar 7z tar gz png jpg jpeg gif bmp webp svg mp4 mp3 wav avi mov json xml yaml yml html css js ts java py go rs c cpp h sql sh bat'.split(' '))
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/
type Facts = { original_name: string, file_ext: string, file_size: number, content_sha256: string, folder_id: number | null }
type Plan = Facts & { uuid: string, owner_uid: string, dept_code: string, oss_path: string, filename: string, id?: number }
function status(error: unknown) {
  const e = error as { statusCode?: number, status?: number, code?: string }
  return e?.statusCode || e?.status || (e?.code === 'NoSuchKey' ? 404 : e?.code === 'FileAlreadyExists' ? 409 : 0)
}
function verifyPlan(result: unknown, facts: Facts, actor: string, department: string): Plan {
  const response = result as { success?: boolean, data?: Plan }, plan = response?.data
  if (response?.success !== true || !plan || !/^[0-9a-f-]{36}$/.test(plan.uuid) || plan.owner_uid !== actor || plan.dept_code !== department
    || Object.entries(facts).some(([key, value]) => plan[key as keyof Facts] !== value)
    || typeof plan.oss_path !== 'string' || !plan.oss_path.startsWith(`codocs/departments/${department}/cabinet/${plan.uuid}/`)
    || !new RegExp(`^[0-9a-f]{64}\\.${facts.file_ext}$`).test(plan.oss_path.split('/').at(-1) || ''))
    throw createError({ statusCode: 503, message: '部门柜上传计划无效' })
  return plan
}
export async function uploadEnterpriseDepartmentCabinet(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const q = departmentCabinetQuery(event, ['dept_code'])
  const department = q.dept_code || ''
  const requestKey = getHeader(event, 'idempotency-key') || ''
  if (!keyPattern.test(requestKey))
    throw createError({ statusCode: 400, message: '上传需要有效的 Idempotency-Key' })
  const user = await departmentCabinetAuthorize(event, department, 'edit', true)
  if (Number(getHeader(event, 'content-length') || 0) > maxSize + 1024 * 1024)
    throw createError({ statusCode: 413, message: '上传请求超过 100 MiB' })
  const parts = await readMultipartFormData(event)
  if (!parts?.length || parts.reduce((n, part) => n + part.data.length, 0) > maxSize + 1024 * 1024)
    throw createError({ statusCode: 400, message: '上传内容无效或过大' })
  const fields: Record<string, string> = {}, files = []
  for (const part of parts) {
    if (part.filename !== undefined) {
      if (part.name !== 'files')
        throw createError({ statusCode: 400, message: '文件字段无效' })
      files.push(part)
    } else {
      if (!part.name || part.name !== 'folder_id' || part.name in fields)
        throw createError({ statusCode: 400, message: '上传字段无效' })
      fields[part.name] = part.data.toString('utf8')
    }
  }
  const folder = !fields.folder_id || fields.folder_id === 'null' ? null : Number(fields.folder_id)
  if (folder !== null && (!/^[1-9]\d*$/.test(fields.folder_id || '') || !Number.isSafeInteger(folder)))
    throw createError({ statusCode: 400, message: '目录标识无效' })
  if (!files.length || files.length > 30 || files.reduce((n, file) => n + file.data.length, 0) > maxSize)
    throw createError({ statusCode: 413, message: '每次上传最多 30 个文件和 100 MiB' })
  const output = { success: 0, failed: 0, items: [] as Array<{ filename: string, status: 'success' | 'error', uuid?: string, message?: string }> }
  for (const [index, file] of files.entries()) {
    const name = file.filename || '', ext = name.split('.').at(-1)?.toLowerCase() || ''
    try {
      if (!name.trim() || [...name].length > 255 || Array.from(name).some(char => char.charCodeAt(0) <= 0x1f || char === '/' || char === '\\' || char.charCodeAt(0) === 0x7f) || !extensions.has(ext))
        throw createError({ statusCode: 400, message: '文件名或类型无效' })
      const key = `dept-cabinet:upload:${createHash('sha256').update(JSON.stringify([user.uid, department, requestKey, index])).digest('hex')}`
      const facts: Facts = { original_name: name, file_ext: ext, file_size: file.data.length, content_sha256: createHash('sha256').update(file.data).digest('hex'), folder_id: folder }
      const command = () => ({ tenant: user.tenant, deployment: user.deployment, code: department, payload: facts, authorization: departmentCabinetPermit(user, 'edit') })
      await prepareEnterpriseRuntime(event, 'codocs.department-cabinet-upload-plan')
      const plan = verifyPlan(await callEnterpriseRuntime(event, 'codocs.department-cabinet-upload-plan', command(), { idempotencyKey: key }), facts, user.uid, department)
      const client = await createRuntimeOSSClient({ event, timeout: 300000 })
      const verify = (head: Awaited<ReturnType<typeof client.head>>) => {
        if (head.meta?.['hzy-content-sha256'] !== facts.content_sha256 || Number(head.res?.headers?.['content-length']) !== file.data.length)
          throw createError({ statusCode: 409, message: '上传对象与文件内容不一致' })
      }
      let missing = false
      try {
        verify(await client.head(plan.oss_path))
      } catch (error) {
        if (status(error) !== 404)
          throw error
        missing = true
      }
      if (missing) {
        try {
          await client.put(plan.oss_path, file.data, { forbidOverwrite: true, meta: { 'hzy-content-sha256': facts.content_sha256 } })
        } catch (error) {
          if (![409, 412].includes(status(error)))
            throw error
          verify(await client.head(plan.oss_path))
        }
      }
      await departmentCabinetAuthorize(event, department, 'edit', true)
      await prepareEnterpriseRuntime(event, 'codocs.department-cabinet-upload')
      const committed = verifyPlan(await callEnterpriseRuntime(event, 'codocs.department-cabinet-upload', command(), { idempotencyKey: key }), facts, user.uid, department)
      if (committed.uuid !== plan.uuid || committed.oss_path !== plan.oss_path || !Number.isSafeInteger(committed.id))
        throw createError({ statusCode: 503, message: '上传提交结果无效' })
      output.success++
      output.items.push({ filename: name, status: 'success', uuid: committed.uuid })
    } catch (error) {
      if ([401, 403].includes(status(error)))
        throw error
      output.failed++
      output.items.push({ filename: name, status: 'error', message: status(error) === 409 ? '文件或请求已变更，请重新上传' : '上传暂未完成，请以同一请求重试' })
    }
  }
  return output
}
