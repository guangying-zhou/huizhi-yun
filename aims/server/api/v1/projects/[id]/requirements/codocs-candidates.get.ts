/**
 * 获取可导入的 Codocs 文档候选列表
 * GET /api/v1/projects/:id/requirements/codocs-candidates
 *
 * 复用 decompose-context 的逻辑：通过 portfolio.git_group + aims_project_repos 收集项目组代码，
 * 从 Codocs 拉取每个项目组下的文档列表。
 */
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { listCodocsProjectGroupDocuments } from '~~/server/utils/codocsApi'
import { buildAimsProjectRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface CandidateCodesData {
  sourceProjectCodes: string[]
}

function unwrapRuntimeData<T>(value: RuntimeEnvelope<T>): T {
  if (value.code !== undefined && value.code !== 0) {
    throw createError({ statusCode: 502, message: value.message || 'Aims tenant-runtime returned an error.' })
  }
  return value.data as T
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const projectId = Number(getRouterParam(event, 'id'))
  if (!projectId || Number.isNaN(projectId)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<CandidateCodesData>>(
    event,
    `/v1/aims/projects/${projectId}/requirements/codocs-candidates-data`,
    {
      appCode: 'aims',
      scope: 'aims.read',
      method: 'GET',
      query: await buildAimsProjectRuntimeAccessQuery(event, { projectId, uid })
    }
  )
  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Aims tenant-runtime is required for Codocs candidates.'
    })
  }
  const runtimeData = unwrapRuntimeData(runtime.data)
  const candidateCodes = new Set((runtimeData.sourceProjectCodes || []).map(code => code.trim()).filter(Boolean))

  const docsByUuid = new Map<string, {
    codocsUuid: string
    title: string
    ownerUid: string
    projectCode: string | null
    updatedAt: string
  }>()

  if (candidateCodes.size > 0) {
    const codes = Array.from(candidateCodes)
    const results = await Promise.allSettled(
      codes.map(code => listCodocsProjectGroupDocuments(code, uid))
    )
    results.forEach((res) => {
      if (res.status !== 'fulfilled') return
      const list = res.value?.data || []
      for (const entry of list) {
        const d = entry.data
        if (!d?.uuid || docsByUuid.has(d.uuid)) continue
        docsByUuid.set(d.uuid, {
          codocsUuid: d.uuid,
          title: d.title,
          ownerUid: d.owner_uid,
          projectCode: d.project_code,
          updatedAt: d.updated_at
        })
      }
    })
  }

  const documents = Array.from(docsByUuid.values())
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))

  return {
    code: 0,
    data: { documents }
  }
})
