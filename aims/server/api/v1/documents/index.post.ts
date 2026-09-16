import { createCodocsDocument } from '~~/server/utils/codocsApi'
import { buildAimsProjectListRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'
import { callAimsRuntime } from '~~/server/utils/projectDocumentAccess'

interface CreateDocumentBody {
  uuid?: string
  title?: string
  isFolder?: boolean | number
  is_folder?: boolean | number
  projectCode?: string | null
  project_code?: string | null
  documentSource?: string | null
  document_source?: string | null
  codocsUuid?: string | null
  codocs_uuid?: string | null
  repoProjectCode?: string | null
  repo_project_code?: string | null
  repoFilePath?: string | null
  repo_file_path?: string | null
  ossPath?: string | null
  oss_path?: string | null
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const body = await readBody<CreateDocumentBody>(event)
  const title = stringValue(body.title)

  if (!title) {
    throw createError({ statusCode: 400, message: '标题不能为空' })
  }

  const uuid = stringValue(body.uuid) || crypto.randomUUID()
  const runtimeQuery = await buildAimsProjectListRuntimeAccessQuery(event, {
    uid,
    baseQuery: { operator_uid: uid }
  })
  const indexed = await callAimsRuntime<Record<string, unknown>>(
    event,
    '/v1/aims/documents',
    {
      method: 'POST',
      query: runtimeQuery,
      scope: 'aims.write',
      body: {
        ...body,
        uuid,
        title
      }
    }
  )

  if (!documentIsFolder(indexed, body) && !hasExistingDocumentBacking(body)) {
    try {
      await createCodocsDocument({
        event,
        uuid,
        title,
        ownerUid: uid,
        content: '',
        docType: 'project',
        projectCode: stringValue(indexed.projectCode ?? indexed.project_code ?? body.projectCode ?? body.project_code),
        folderPath: stringValue(indexed.folderPath) || undefined
      })
    } catch (err: unknown) {
      const e = err as { message?: string }
      console.error('[Documents] Failed to create Codocs document:', e.message || err)
    }
  }

  return {
    code: 0,
    data: indexed
  }
})

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function booleanValue(value: unknown) {
  return value === true || value === 1 || stringValue(value) === '1'
}

function documentIsFolder(indexed: Record<string, unknown>, body: CreateDocumentBody) {
  return booleanValue(indexed.isFolder ?? indexed.is_folder ?? body.isFolder ?? body.is_folder)
}

function hasExistingDocumentBacking(body: CreateDocumentBody) {
  return Boolean(
    stringValue(body.documentSource ?? body.document_source)
    || stringValue(body.codocsUuid ?? body.codocs_uuid)
    || stringValue(body.repoProjectCode ?? body.repo_project_code)
    || stringValue(body.repoFilePath ?? body.repo_file_path)
    || stringValue(body.ossPath ?? body.oss_path)
  )
}
