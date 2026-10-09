import { createError, getHeader, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { createRuntimeOSSClient } from '../../../codocs/server/utils/oss'
import { departmentCabinetAuthorize, departmentCabinetPermit, departmentCabinetQuery } from './enterpriseCodocsDepartmentCabinet'

const categories = new Set(['rules', 'notices', 'culture', 'legal', 'tech-specs', 'knowledge', 'templates'])
export async function publishEnterpriseDepartmentCabinetPdf(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const deptCode = departmentCabinetQuery(event, ['dept_code']).dept_code || ''
  const key = getHeader(event, 'idempotency-key') || ''
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/.test(key))
    throw createError({ statusCode: 400, message: '发布需要有效的 Idempotency-Key' })
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || Array.isArray(body) || Object.keys(body).some(field => !['fileUuid', 'targetCategory'].includes(field))
    || typeof body.fileUuid !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(body.fileUuid)
    || typeof body.targetCategory !== 'string' || !categories.has(body.targetCategory))
    throw createError({ statusCode: 400, message: 'PDF 发布请求无效' })
  const user = await departmentCabinetAuthorize(event, deptCode, 'publish')
  await prepareEnterpriseRuntime(event, 'codocs.department-cabinet-view')
  const source = await callEnterpriseRuntime(event, 'codocs.department-cabinet-view', {
    tenant: user.tenant, deployment: user.deployment, code: deptCode, query: { uuid: body.fileUuid },
    authorization: departmentCabinetPermit(user, 'read')
  }) as { success?: boolean, data?: unknown }
  if (source?.success !== true)
    throw createError({ statusCode: 503, message: '源 PDF 暂不可用' })
  const file = source.data as { uuid?: string, dept_code?: string, file_ext?: string, oss_path?: string }
  if (file?.uuid !== body.fileUuid || file?.dept_code !== deptCode || file?.file_ext?.toLowerCase() !== 'pdf'
    || typeof file.oss_path !== 'string' || !file.oss_path.startsWith(`codocs/departments/${deptCode}/cabinet/`))
    throw createError({ statusCode: 409, message: '部门柜 PDF 已变更' })
  const targetPath = `codocs/company/${body.targetCategory}/${body.fileUuid}.pdf`
  const client = await createRuntimeOSSClient({ event, timeout: 300000 })
  let sourceEtag: string, targetEtag: string
  try {
    const head = await client.head(file.oss_path)
    sourceEtag = String(head.res.headers.etag || '')
    if (!sourceEtag)
      throw new Error('source etag missing')
    const object = await client.get(file.oss_path)
    if (object.res.headers.etag !== sourceEtag || object.content.length > 100 * 1024 * 1024)
      throw createError({ statusCode: 409, message: '源 PDF 已变化或过大' })
    try {
      await client.put(targetPath, object.content, { forbidOverwrite: true, headers: { 'Content-Type': 'application/pdf' }, meta: { 'department-cabinet-publish-source': file.oss_path, 'department-cabinet-publish-key': key } })
    } catch (error) {
      const status = (error as { status?: number, statusCode?: number }).status || (error as { statusCode?: number }).statusCode
      if (status !== 409 && status !== 412)
        throw error
      const existing = await client.head(targetPath)
      if (existing.meta?.['department-cabinet-publish-source'] !== file.oss_path || existing.meta?.['department-cabinet-publish-key'] !== key)
        throw createError({ statusCode: 409, message: '发布目标已存在' })
    }
    const target = await client.head(targetPath)
    if (target.meta?.['department-cabinet-publish-source'] !== file.oss_path || target.meta?.['department-cabinet-publish-key'] !== key)
      throw createError({ statusCode: 409, message: '发布目标已存在' })
    targetEtag = String(target.res.headers.etag || '')
    if (!targetEtag)
      throw new Error('target etag missing')
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 409)
      throw error
    throw createError({ statusCode: 503, message: 'PDF 复制未完成，请使用同一请求重试' })
  }
  const currentSource = await client.head(file.oss_path)
  if (String(currentSource.res.headers.etag || '') !== sourceEtag)
    throw createError({ statusCode: 409, message: '源 PDF 已变化' })
  await departmentCabinetAuthorize(event, deptCode, 'publish')
  await prepareEnterpriseRuntime(event, 'codocs.department-cabinet-publish-record')
  const result = await callEnterpriseRuntime(event, 'codocs.department-cabinet-publish-record', {
    tenant: user.tenant, deployment: user.deployment, code: deptCode,
    payload: { uuid: body.fileUuid, category: body.targetCategory, source_etag: sourceEtag, target_etag: targetEtag },
    authorization: departmentCabinetPermit(user, 'publish')
  }, { idempotencyKey: key }) as { success?: boolean, data?: { targetPath?: string } }
  if (result?.success !== true || result.data?.targetPath !== targetPath)
    throw createError({ statusCode: 503, message: '发布记录暂不可用，请使用同一请求重试' })
  return { success: true, data: { targetPath } }
}
