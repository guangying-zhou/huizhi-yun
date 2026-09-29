import { createError, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { createRuntimeOSSClient } from '../../../codocs/server/utils/oss'
import { departmentAssetPath, requireDepartmentAsset } from './enterpriseCodocsDepartmentAssets'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
type Command = { operationId: string, action: 'archive', sourcePath: string, targetPath: string }
async function head(client: Awaited<ReturnType<typeof createRuntimeOSSClient>>, path: string) {
  try { return await client.head(path) } catch (error) {
    const value = error as { status?: number, statusCode?: number, code?: string }
    if (value.status === 404 || value.statusCode === 404 || value.code === 'NoSuchKey') return null
    throw error
  }
}
async function receipt(event: H3Event, user: { uid: string, tenant: string, deployment: string }, phase: 'prepare' | 'complete', command: Command) {
  const operation = `codocs.company-asset-archive-${phase}` as const
  await prepareEnterpriseRuntime(event, operation)
  const response = await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant, deployment: user.deployment,
    payload: phase === 'complete' ? { ...command, evidence: 'verified' } : command,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'company-assets', action: 'admin', expiresAt: enterpriseRuntimePermitExpiresAt() }
  }, { idempotencyKey: `codocs:department-archive:${command.operationId}` }) as { success?: boolean, data?: { operationId?: string, action?: string, phase?: string } }
  if (response?.success !== true || response.data?.operationId !== command.operationId || response.data.action !== 'archive' || response.data.phase !== phase) throw createError({ statusCode: 503, message: '部门资产归档回执无效' })
}
export async function archiveEnterpriseDepartmentAsset(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || Array.isArray(body) || Object.keys(body).some(key => !['deptCode', 'subdir', 'sourcePath', 'operationId'].includes(key))
    || typeof body.sourcePath !== 'string' || typeof body.operationId !== 'string' || !uuid.test(body.operationId)) throw createError({ statusCode: 400, message: '归档请求无效' })
  if (typeof body.deptCode !== 'string' || typeof body.subdir !== 'string') throw createError({ statusCode: 400, message: '部门归档范围无效' })
  const asset = departmentAssetPath(body.sourcePath, body.deptCode)
  if (asset.subdir !== body.subdir) throw createError({ statusCode: 400, message: '部门归档类别不一致' })
  const user = await requireDepartmentAsset(event, asset.deptCode, 'admin')
  const command: Command = { operationId: body.operationId, action: 'archive', sourcePath: asset.path,
    targetPath: asset.path.replace(/^codocs\/departments\//, 'codocs/archives/departments/') }
  await receipt(event, user, 'prepare', command)
  await requireDepartmentAsset(event, asset.deptCode, 'admin')
  const client = await createRuntimeOSSClient({ event })
  const targetMatches = (value: NonNullable<Awaited<ReturnType<typeof head>>>) => value.meta?.['department-archive-operation'] === command.operationId
    && value.meta?.['department-archive-source'] === command.sourcePath && !!value.meta?.['department-archive-source-etag']
  let target = await head(client, command.targetPath)
  if (target && !targetMatches(target)) throw createError({ statusCode: 409, message: '归档目标文件已存在' })
  if (!target) {
    const source = await head(client, command.sourcePath)
    if (!source) throw createError({ statusCode: 409, message: '源文件已变化' })
    const size = Number(source.res.headers['content-length'])
    if (!Number.isSafeInteger(size) || size < 0 || size > 100 * 1024 * 1024) throw createError({ statusCode: 413, message: '源文件过大或大小无法验证' })
    const object = await client.get(command.sourcePath)
    const etag = object.res.headers.etag
    if (!etag || etag !== source.res.headers.etag || object.content.length !== size) throw createError({ statusCode: 409, message: '源文件版本已变化' })
    try {
      await client.put(command.targetPath, object.content, { forbidOverwrite: true, meta: {
        'department-archive-operation': command.operationId,
        'department-archive-source': command.sourcePath,
        'department-archive-source-etag': etag
      } })
    } catch (error) {
      target = await head(client, command.targetPath)
      if (!target || !targetMatches(target)) throw error
    }
    target = await head(client, command.targetPath)
    if (!target || !targetMatches(target)) throw createError({ statusCode: 409, message: '归档目标无法核验' })
  }
  const source = await head(client, command.sourcePath)
  if (source) {
    if (source.res.headers.etag !== target?.meta?.['department-archive-source-etag']) throw createError({ statusCode: 409, message: '源文件版本已变化' })
    await client.delete(command.sourcePath)
  }
  await requireDepartmentAsset(event, asset.deptCode, 'admin')
  await receipt(event, user, 'complete', command)
  return { code: 0, data: { archivePath: command.targetPath } }
}
