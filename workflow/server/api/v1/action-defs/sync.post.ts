/**
 * POST /api/v1/action-defs/sync
 * 应用审批动作批量同步接口
 *
 * Workflow Nuxt server 只负责校验调用方服务令牌并转发到 tenant-runtime。
 */
import { createError, defineEventHandler, readBody, type H3Event } from 'h3'
import { resolveConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { maybeCallWorkflowDataRuntime } from '~~/server/utils/dataRuntime'

interface SyncAction {
  resourceCode: string
  actionCode: string
  name: string
  description?: string
  formSchemaCode?: string
  icon?: string
  embedUrlPattern?: string
  sortOrder?: number
  enabled?: boolean
}

interface SyncActionDefsResponse {
  code: number
  data: {
    created: number
    updated: number
    deprecated: number
    errors: string[]
  }
}

type ConsoleServiceAuthContext = {
  authenticated?: boolean
  tokenUse?: string
  subjectType?: string
  appCode?: string
  scopes?: string[]
  claims?: {
    scope?: unknown
  }
}

function claimScopes(auth: ConsoleServiceAuthContext) {
  const contextScopes = Array.isArray(auth.scopes) ? auth.scopes : []
  const rawScope = String(auth.claims?.scope || '')
    .split(/\s+/)
    .map(item => item.trim())
    .filter(Boolean)
  return new Set([...contextScopes, ...rawScope])
}

async function requireServiceScope(event: H3Event, requiredScope: string) {
  const auth = await resolveConsoleAuthContext(event) as ConsoleServiceAuthContext
  if (!auth?.authenticated) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }
  if (auth.tokenUse !== 'service' || auth.subjectType !== 'service') {
    throw createError({ statusCode: 403, message: '需要服务访问令牌' })
  }
  if (!claimScopes(auth).has(requiredScope)) {
    throw createError({ statusCode: 403, message: `缺少服务授权: ${requiredScope}` })
  }
  return auth
}

export default defineEventHandler(async (event): Promise<SyncActionDefsResponse> => {
  const serviceAuth = await requireServiceScope(event, 'workflow:action_defs:sync')

  const body = await readBody<{ appCode?: string, actions?: SyncAction[] }>(event)
  const { appCode, actions } = body

  if (!appCode || !Array.isArray(actions)) {
    throw createError({ statusCode: 400, message: 'appCode 和 actions 必填' })
  }
  if (serviceAuth.appCode && serviceAuth.appCode !== appCode) {
    throw createError({ statusCode: 403, message: `服务令牌不能同步其他应用: ${appCode}` })
  }

  const runtime = await maybeCallWorkflowDataRuntime<SyncActionDefsResponse>(event, '/v1/workflow/action-defs/sync', {
    scope: 'workflow.write',
    method: 'POST',
    body
  })
  if (runtime.handled) return runtime.data

  throw createError({
    statusCode: 503,
    message: 'Workflow tenant-runtime is required for action definition sync.'
  })
})
