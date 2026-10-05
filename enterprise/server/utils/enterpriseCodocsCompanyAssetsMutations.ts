import { createError, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createRuntimeOSSClient } from '../../../codocs/server/utils/oss'
import { companyAssetPath, companyAssetPrefix } from './enterpriseCodocsCompanyAssets'

type Action = 'mkdir' | 'delete-directory' | 'move' | 'archive'
type Command = { operationId: string, path?: string, sourcePath?: string, targetPath?: string }

function missing(error: unknown) {
  const value = error as { status?: number, statusCode?: number, code?: string }
  return value.status === 404 || value.statusCode === 404 || value.code === 'NoSuchKey'
}

async function optionalHead(client: Awaited<ReturnType<typeof createRuntimeOSSClient>>, path: string) {
  try {
    return await client.head(path)
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
}

function segment(value: unknown) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || value.includes('/') || value.includes('\\') || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw createError({ statusCode: 400, message: '目录名称无效' })
  return value
}

function commandFor(action: Action, body: Record<string, unknown>): Command {
  const operationId = body.operationId
  if (typeof operationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operationId)) throw createError({ statusCode: 400, message: '操作标识无效' })
  const subdir = String(body.subdir || '')
  const root = companyAssetPrefix(subdir)
  if (action === 'mkdir') {
    const parent = companyAssetPrefix(subdir, String(body.path || ''))
    return { operationId, path: `${parent}${segment(body.name)}/` }
  }
  if (action === 'delete-directory') {
    const path = String(body.dirPath || '')
    if (!path.startsWith(root) || path === root || !path.endsWith('/')) throw createError({ statusCode: 400, message: '目录路径无效' })
    companyAssetPrefix(subdir, path.slice(root.length, -1))
    return { operationId, path }
  }
  const sourcePath = companyAssetPath(String(body.sourcePath || ''))
  if (!sourcePath.startsWith(root)) throw createError({ statusCode: 400, message: '文件类别无效' })
  let targetPath: string
  if (action === 'archive') targetPath = sourcePath.replace(/^codocs\/company\//, 'codocs/archives/company/')
  else targetPath = companyAssetPrefix(subdir, String(body.targetDir || '')) + sourcePath.split('/').at(-1)
  if (!targetPath || targetPath === sourcePath) throw createError({ statusCode: 400, message: '目标路径无效' })
  return { operationId, sourcePath, targetPath }
}

async function requireCompanyAdmin(event: H3Event) {
  const user = await requireEnterpriseUser(event)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'company', 'admin', snapshot.actionPolicies?.company)) throw createError({ statusCode: 403, message: '缺少组织资产管理权限' })
  return user
}

async function receipt(event: H3Event, action: Action, phase: 'prepare' | 'complete', command: Command) {
  const user = await requireCompanyAdmin(event)
  const operation = `codocs.company-asset-${action}-${phase}` as const
  await prepareEnterpriseRuntime(event, operation)
  const response = await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant, deployment: user.deployment,
    payload: phase === 'complete' ? { ...command, evidence: 'verified' } : command,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'company-assets', action: 'admin', expiresAt: enterpriseRuntimePermitExpiresAt() }
  }, { idempotencyKey: `codocs:company-mutation:${action}:${command.operationId}` }) as { success?: boolean, data?: { operationId?: string, action?: string, phase?: string } }
  if (response?.success !== true || response.data?.operationId !== command.operationId || response.data.action !== action || response.data.phase !== phase) throw createError({ statusCode: 503, message: '组织资产操作回执无效' })
}

async function applyStorage(event: H3Event, action: Action, command: Command) {
  const client = await createRuntimeOSSClient({ event })
  const operationId = command.operationId
  if (action === 'mkdir') {
    const path = command.path!
    const existing = await optionalHead(client, path)
    if (existing) {
      if (existing.meta?.['company-mutation-operation'] !== operationId) throw createError({ statusCode: 409, message: '目录已由其他操作创建' })
      return
    }
    try {
      await client.put(path, Buffer.alloc(0), { forbidOverwrite: true, meta: { 'company-mutation-operation': operationId } })
    } catch (error) {
      const created = await optionalHead(client, path)
      if (created?.meta?.['company-mutation-operation'] === operationId) return
      throw error
    }
    return
  }
  if (action === 'delete-directory') {
    const path = command.path!
    const listing = await client.listV2({ 'prefix': path, 'max-keys': 2 })
    if (listing.isTruncated || (listing.prefixes || []).length || (listing.objects || []).some(object => object.name !== path)) throw createError({ statusCode: 409, message: '目录非空，不能删除' })
    if (await optionalHead(client, path)) await client.delete(path)
    return
  }
  const sourcePath = command.sourcePath!
  const targetPath = command.targetPath!
  const targetMatches = (head: NonNullable<Awaited<ReturnType<typeof optionalHead>>>) => head.meta?.['company-mutation-operation'] === operationId
    && head.meta?.['company-mutation-source'] === sourcePath
    && !!head.meta?.['company-mutation-source-etag']
    && !!head.res.headers.etag
  let target = await optionalHead(client, targetPath)
  if (target && !targetMatches(target)) throw createError({ statusCode: 409, message: '目标文件已存在或无法核验' })
  if (!target) {
    const sourceHead = await optionalHead(client, sourcePath)
    if (!sourceHead) throw createError({ statusCode: 409, message: '源文件已变化' })
    const size = Number(sourceHead.res.headers['content-length'])
    if (!Number.isSafeInteger(size) || size < 0 || size > 100 * 1024 * 1024) throw createError({ statusCode: 413, message: '源文件过大或大小无法验证' })
    let source
    try {
      source = await client.get(sourcePath)
    } catch (error) {
      if (missing(error)) throw createError({ statusCode: 409, message: '源文件已变化' })
      throw error
    }
    const etag = source.res.headers.etag
    if (!etag || etag !== sourceHead.res.headers.etag || source.content.length !== size) throw createError({ statusCode: 409, message: '源文件版本已变化' })
    try {
      await client.put(targetPath, source.content, { forbidOverwrite: true, meta: { 'company-mutation-operation': operationId, 'company-mutation-source': sourcePath, 'company-mutation-source-etag': etag } })
    } catch (error) {
      target = await optionalHead(client, targetPath)
      if (!target || target.meta?.['company-mutation-operation'] !== operationId || target.meta?.['company-mutation-source'] !== sourcePath) throw error
    }
    target = await client.head(targetPath)
    if (!targetMatches(target)) throw createError({ statusCode: 409, message: '目标文件无法核验' })
  }
  const source = await optionalHead(client, sourcePath)
  if (!source) return
  if (!target || source.res.headers.etag !== target.meta?.['company-mutation-source-etag']) throw createError({ statusCode: 409, message: '源文件版本已变化' })
  await client.delete(sourcePath)
}

export async function mutateEnterpriseCompanyAsset(event: H3Event, action: Action) {
  setHeader(event, 'Cache-Control', 'no-store')
  await requireCompanyAdmin(event)
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || Array.isArray(body)) throw createError({ statusCode: 400, message: '组织资产操作无效' })
  const command = commandFor(action, body)
  await receipt(event, action, 'prepare', command)
  await applyStorage(event, action, command)
  await receipt(event, action, 'complete', command)
  return { code: 0, data: { ...command } }
}
