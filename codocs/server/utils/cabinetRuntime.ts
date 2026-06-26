import type { H3Event } from 'h3'
import { createError } from 'h3'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export type CabinetScope = 'personal' | 'department'

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
  folder_id?: number | null
  converted_doc_uuid?: string | null
}

function cabinetBasePath(scope: CabinetScope) {
  return scope === 'department' ? '/v1/codocs/dept-cabinet' : '/v1/codocs/cabinet'
}

export async function getCabinetFileMetadata(event: H3Event, scope: CabinetScope, uuid: string) {
  const file = await callCodocsTenantRuntime<CabinetFileMetadata>(
    event,
    `${cabinetBasePath(scope)}/${encodeURIComponent(uuid)}`,
    { scope: 'codocs.read' }
  )

  if (scope === 'department' && !file.dept_code) {
    throw createError({ statusCode: 404, message: '文件不存在' })
  }

  return file
}

export async function createCabinetFileMetadata(
  event: H3Event,
  scope: CabinetScope,
  input: Record<string, unknown>
) {
  return await callCodocsTenantRuntime<CabinetFileMetadata>(event, cabinetBasePath(scope), {
    method: 'POST',
    scope: 'codocs.write',
    body: input
  })
}

export async function updateCabinetFileMetadata(
  event: H3Event,
  scope: CabinetScope,
  uuid: string,
  input: Record<string, unknown>
) {
  return await callCodocsTenantRuntime<CabinetFileMetadata>(
    event,
    `${cabinetBasePath(scope)}/${encodeURIComponent(uuid)}`,
    {
      method: 'PATCH',
      scope: 'codocs.write',
      body: input
    }
  )
}

export async function deleteCabinetFileMetadata(event: H3Event, scope: CabinetScope, uuid: string) {
  return await callCodocsTenantRuntime(event, `${cabinetBasePath(scope)}/${encodeURIComponent(uuid)}`, {
    method: 'DELETE',
    scope: 'codocs.write'
  })
}
