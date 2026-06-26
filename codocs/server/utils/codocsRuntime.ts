import type { H3Event } from 'h3'
import { createError } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'

export interface CodocsCollaborationContext {
  docId: number
  docUuid: string
  docType: string
  ossPath: string
  ownerUid: string
  actorUid: string
  actorName: string
  sharePermission: 'read' | 'write' | null
  readonly: boolean
}

export interface CodocsDocumentMetadata {
  id: number
  uuid: string
  title: string
  doc_type: string
  oss_path: string | null
  owner_uid: string
  dept_code?: string | null
  project_code?: string | null
  folder_id?: number | null
  content_size?: number
  last_editor_uid?: string | null
  status?: number
  star_flag?: number
  home_flag?: number
  readonly_flag?: number
  publish_info?: string | null
  ai_abstract?: string | null
  created_at?: string
  updated_at?: string
  readonly?: boolean
  sharePermission?: 'read' | 'write' | null
}

export interface CreateCodocsDocumentInput {
  title: string
  docType?: string
  ownerUid: string
  operatorUid?: string
  deptCode?: string | null
  projectCode?: string | null
  folderId?: number | null
  folderPath?: string | null
  uuid?: string | null
  ossPath?: string | null
  contentSize?: number
}

interface RuntimeSuccessEnvelope<T> {
  success?: boolean
  data?: T
}

function unwrapRuntimeData<T>(value: unknown): T {
  if (value && typeof value === 'object' && 'data' in value) {
    return (value as RuntimeSuccessEnvelope<T>).data as T
  }
  return value as T
}

export async function maybeCallCodocsTenantRuntime<T>(
  event: H3Event,
  path: string,
  options: {
    method?: string
    query?: Record<string, unknown>
    body?: unknown
    scope?: string
  } = {}
) {
  return await maybeCallTenantRuntime<unknown>(event, path, {
    appCode: 'codocs',
    scope: options.scope || (options.method && options.method !== 'GET' ? 'codocs.write' : 'codocs.read'),
    method: options.method || 'GET',
    query: options.query,
    body: options.body
  }).then(result => result.handled
    ? { handled: true as const, data: unwrapRuntimeData<T>(result.data) }
    : result)
}

export async function callCodocsTenantRuntime<T>(
  event: H3Event,
  path: string,
  options: {
    method?: string
    query?: Record<string, unknown>
    body?: unknown
    scope?: string
  } = {}
) {
  const runtime = await maybeCallCodocsTenantRuntime<T>(event, path, options)
  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Codocs tenant-runtime is required for Codocs data access.'
    })
  }
  return runtime.data
}

export async function getCodocsDocumentMetadata(
  event: H3Event,
  uuid: string,
  query: Record<string, unknown> = {}
) {
  return await callCodocsTenantRuntime<CodocsDocumentMetadata>(
    event,
    `/v1/codocs/documents/${encodeURIComponent(uuid)}`,
    {
      query,
      scope: 'codocs.read'
    }
  )
}

export async function createCodocsDocumentMetadata(
  event: H3Event,
  input: CreateCodocsDocumentInput
) {
  return await callCodocsTenantRuntime<CodocsDocumentMetadata>(
    event,
    '/v1/codocs/documents',
    {
      method: 'POST',
      scope: 'codocs.write',
      body: input
    }
  )
}

export async function updateCodocsDocumentMetadata(
  event: H3Event,
  uuid: string,
  input: Record<string, unknown>
) {
  return await callCodocsTenantRuntime<{ uuid: string, updated?: boolean }>(
    event,
    `/v1/codocs/documents/${encodeURIComponent(uuid)}`,
    {
      method: 'PATCH',
      scope: 'codocs.write',
      body: input
    }
  )
}

export async function createCodocsDocumentVersion(
  event: H3Event,
  uuid: string,
  input: Record<string, unknown>
) {
  return await callCodocsTenantRuntime<{ id: number, documentId: number, versionNum: number }>(
    event,
    `/v1/codocs/documents/${encodeURIComponent(uuid)}/versions`,
    {
      method: 'POST',
      scope: 'codocs.write',
      body: input
    }
  )
}

export async function resolveCodocsCollaborationContext(
  event: H3Event,
  options: {
    documentName: string
    actorUid: string
    actorName?: string
  }
) {
  const documentName = String(options.documentName || '').trim()
  const uuid = documentName.startsWith('doc:') ? documentName.slice(4) : ''

  return await maybeCallCodocsTenantRuntime<CodocsCollaborationContext>(event, `/v1/codocs/collaboration/documents/${uuid}/context`, {
    query: {
      actorUid: options.actorUid,
      actorName: options.actorName
    }
  })
}
