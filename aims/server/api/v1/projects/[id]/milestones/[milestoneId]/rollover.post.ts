import { createError, getHeader, getRouterParam, readBody, type H3Event } from 'h3'
import { buildAimsProjectListRuntimeAccessQuery, buildAimsProjectRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'
import { forwardAimsRuntimeGet, forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'

interface RuntimeProject {
  id?: number | string
  projectCode?: string
  project_code?: string
  currentUserRole?: string
  current_user_role?: string
  currentUserIsProjectAdmin?: boolean | string | number
  current_user_is_project_admin?: boolean | string | number
}

type RequestBody = Record<string, unknown>

function text(value: unknown) {
  return String(value || '').trim()
}

function objectBody(value: unknown): RequestBody {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as RequestBody
  return {}
}

function firstText(body: RequestBody, ...keys: string[]) {
  for (const key of keys) {
    const value = text(body[key])
    if (value) return value
  }
  return ''
}

function boolFromAny(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const normalized = text(value).toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function projectField(project: RuntimeProject, camel: keyof RuntimeProject, snake: keyof RuntimeProject) {
  return text(project[camel] ?? project[snake])
}

function assertRolloverWriteAccess(project: RuntimeProject) {
  const role = projectField(project, 'currentUserRole', 'current_user_role')
  const isScopedAdmin = boolFromAny(project.currentUserIsProjectAdmin ?? project.current_user_is_project_admin)
  if (role === 'manager' || isScopedAdmin) return

  throw createError({
    statusCode: 403,
    message: '仅项目经理或具备该项目范围管理权限的用户可以开启下一周期。'
  })
}

async function loadProject(event: H3Event, projectId: number, uid: string) {
  const query = await buildAimsProjectRuntimeAccessQuery(event, { projectId, uid })
  const project = await forwardAimsRuntimeGet<RuntimeProject>(
    event,
    `/v1/aims/projects/${projectId}`,
    { uid, query }
  )
  if (!project || !projectField(project, 'projectCode', 'project_code')) {
    throw createError({ statusCode: 404, message: '项目不存在或无权访问' })
  }
  return project
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
  const milestoneId = Number(getRouterParam(event, 'milestoneId'))
  if (!milestoneId || Number.isNaN(milestoneId)) {
    throw createError({ statusCode: 400, message: '无效的里程碑ID' })
  }

  const body = objectBody(await readBody(event).catch(() => ({})))
  const carryover = firstText(body, 'carryover', 'carryoverMode', 'carryover_mode') || 'auto'
  if (carryover !== 'auto' && carryover !== 'manual') {
    throw createError({ statusCode: 400, message: 'carryover must be auto or manual.' })
  }

  const project = await loadProject(event, projectId, uid)
  assertRolloverWriteAccess(project)
  const runtimeQuery = await buildAimsProjectListRuntimeAccessQuery(event, { uid })
  const projectCode = projectField(project, 'projectCode', 'project_code')
  const data = await forwardAimsRuntimePost<Record<string, unknown>>(
    event,
    `/v1/aims/service/projects/${encodeURIComponent(projectCode)}/milestones/${milestoneId}:rollover`,
    {
      uid,
      query: runtimeQuery,
      body: {
        manualConfirmed: true,
        carryover,
        periodStart: firstText(body, 'periodStart', 'period_start') || undefined,
        periodEnd: firstText(body, 'periodEnd', 'period_end') || undefined,
        idempotencyKey: text(getHeader(event, 'idempotency-key')) || undefined,
        requestId: text(getHeader(event, 'x-request-id') || getHeader(event, 'x-correlation-id')) || undefined,
        operator_uid: uid
      }
    }
  )

  return { code: 0, data }
})
