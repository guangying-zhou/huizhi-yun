import type { H3Event } from 'h3'
import { createError } from 'h3'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'
import { requireDepartmentReadAccess } from '~~/server/utils/departmentAccess'

export type CabinetScope = 'personal' | 'department' | 'project'

export interface CabinetFileMetadata {
  id?: number
  uuid: string
  filename: string
  original_name: string
  file_ext: string
  file_size: number
  oss_path: string
  owner_uid: string
  dept_code?: string | null
  project_code?: string | null
  folder_id?: number | null
  converted_doc_uuid?: string | null
}

export const CODOCS_TRUSTED_CABINET_DEPARTMENT_QUERY_KEY = 'codocs_trusted_cabinet_department_dept_code'
export const CODOCS_TRUSTED_CABINET_DEPARTMENT_MANAGER_QUERY_KEY = 'codocs_trusted_cabinet_department_manager_dept_code'
export const CODOCS_TRUSTED_PROJECT_CABINET_QUERY_KEY = 'codocs_trusted_project_cabinet_project_code'

type BrowserCabinetScope = Exclude<CabinetScope, 'project'>

function queryText(value: unknown) {
  return String(value || '').trim()
}

async function trustedBrowserCabinetReadQuery(
  event: H3Event,
  scope: BrowserCabinetScope,
  departmentCode = ''
) {
  const actorUid = requireRequestUid(event)
  await requirePermission(event, 'documents', 'view', '缺少文档查看权限')

  if (scope === 'personal') return {}

  const deptCode = queryText(departmentCode)
  if (!deptCode) {
    throw createError({ statusCode: 400, message: 'dept_code 不能为空' })
  }
  await requireDepartmentReadAccess(event, actorUid, deptCode)

  // Foundation signs the entire tenant-runtime request target together with
  // actor delegation. The marker therefore cannot be changed after this BFF
  // has verified the department, and browser-supplied copies are discarded.
  return { [CODOCS_TRUSTED_CABINET_DEPARTMENT_QUERY_KEY]: deptCode }
}

function browserCabinetListQuery(source: Record<string, unknown>, scope: BrowserCabinetScope) {
  const result: Record<string, unknown> = { ...source }
  for (const key of [
    'owner_uid', 'ownerUid', 'dept_code', 'deptCode',
    'current_user', 'currentUser', 'operator_uid', 'operatorUid', 'actor_uid', 'actorUid',
    CODOCS_TRUSTED_CABINET_DEPARTMENT_QUERY_KEY,
    CODOCS_TRUSTED_CABINET_DEPARTMENT_MANAGER_QUERY_KEY
  ]) {
    Reflect.deleteProperty(result, key)
  }
  if (scope === 'department') {
    Reflect.deleteProperty(result, 'project_code')
    Reflect.deleteProperty(result, 'projectCode')
  }
  return result
}

function trustedCabinetMutationQuery(
  scope: CabinetScope,
  options: { departmentManagerCode?: string, projectCode?: string } = {}
) {
  if (scope === 'project') {
    const projectCode = queryText(options.projectCode)
    if (!projectCode) throw createError({ statusCode: 403, message: '项目文件柜写入需要已验证的项目范围' })
    return { [CODOCS_TRUSTED_PROJECT_CABINET_QUERY_KEY]: projectCode }
  }
  if (scope !== 'department') return undefined
  const deptCode = queryText(options.departmentManagerCode)
  if (!deptCode) {
    throw createError({ statusCode: 403, message: '部门文件柜写入需要已验证的部门经理范围' })
  }
  // The caller must have already completed requireDepartmentManagerAccess.
  // This marker is signed with the full runtime request target by Foundation;
  // runtime deliberately ignores body/query dept_code and uses it as the
  // mutation predicate instead.
  return { [CODOCS_TRUSTED_CABINET_DEPARTMENT_MANAGER_QUERY_KEY]: deptCode }
}

function cabinetBasePath(scope: CabinetScope) {
  if (scope === 'department') return '/v1/codocs/dept-cabinet'
  if (scope === 'project') return '/v1/codocs/project-cabinet'
  return '/v1/codocs/cabinet'
}

export async function getCabinetFileMetadata(
  event: H3Event,
  scope: CabinetScope,
  uuid: string,
  options: { departmentCode?: string, projectCode?: string } = {}
) {
  const browserScope = scope === 'project' ? null : scope
  const query = browserScope
    ? await trustedBrowserCabinetReadQuery(event, browserScope, options.departmentCode)
    : scope === 'project'
      ? trustedCabinetMutationQuery('project', { projectCode: options.projectCode })
      : undefined
  const file = await callCodocsTenantRuntime<CabinetFileMetadata>(
    event,
    `${cabinetBasePath(scope)}/${encodeURIComponent(uuid)}`,
    { query, scope: 'codocs.read' }
  )

  if (scope === 'department' && !file.dept_code) {
    throw createError({ statusCode: 404, message: '文件不存在' })
  }
  if (scope === 'project' && !file.project_code) {
    throw createError({ statusCode: 404, message: '项目文件不存在' })
  }

  return file
}

export async function listCabinetFileMetadata(
  event: H3Event,
  scope: BrowserCabinetScope,
  source: Record<string, unknown>,
  options: { departmentCode?: string } = {}
) {
  const trustedQuery = await trustedBrowserCabinetReadQuery(event, scope, options.departmentCode)
  return await callCodocsTenantRuntime<{ items?: unknown[], total?: number, page?: number, pageSize?: number }>(
    event,
    cabinetBasePath(scope),
    {
      query: { ...browserCabinetListQuery(source, scope), ...trustedQuery },
      scope: 'codocs.read'
    }
  )
}

export async function createCabinetFileMetadata(
  event: H3Event,
  scope: CabinetScope,
  input: Record<string, unknown>,
  options: { departmentManagerCode?: string, projectCode?: string } = {}
) {
  return await callCodocsTenantRuntime<CabinetFileMetadata>(event, cabinetBasePath(scope), {
    method: 'POST',
    scope: 'codocs.write',
    query: trustedCabinetMutationQuery(scope, options),
    body: input
  })
}

export async function updateCabinetFileMetadata(
  event: H3Event,
  scope: CabinetScope,
  uuid: string,
  input: Record<string, unknown>,
  options: { departmentManagerCode?: string, projectCode?: string } = {}
) {
  return await callCodocsTenantRuntime<CabinetFileMetadata>(
    event,
    `${cabinetBasePath(scope)}/${encodeURIComponent(uuid)}`,
    {
      method: 'PATCH',
      scope: 'codocs.write',
      query: trustedCabinetMutationQuery(scope, options),
      body: input
    }
  )
}

export async function deleteCabinetFileMetadata(
  event: H3Event,
  scope: CabinetScope,
  uuid: string,
  options: { departmentManagerCode?: string, projectCode?: string, expectedOssPath?: string } = {}
) {
  return await callCodocsTenantRuntime(event, `${cabinetBasePath(scope)}/${encodeURIComponent(uuid)}`, {
    method: 'DELETE',
    scope: 'codocs.write',
    query: trustedCabinetMutationQuery(scope, options),
    body: scope === 'project' ? { expected_oss_path: options.expectedOssPath } : undefined
  })
}

export async function markCabinetFileConverted(
  event: H3Event,
  scope: BrowserCabinetScope,
  uuid: string,
  convertedDocumentUuid: string,
  options: { departmentManagerCode?: string } = {}
) {
  return await callCodocsTenantRuntime<CabinetFileMetadata>(
    event,
    `${cabinetBasePath(scope)}/${encodeURIComponent(uuid)}/converted-document`,
    {
      method: 'POST',
      scope: 'codocs.write',
      query: trustedCabinetMutationQuery(scope, options),
      body: { converted_doc_uuid: convertedDocumentUuid }
    }
  )
}
