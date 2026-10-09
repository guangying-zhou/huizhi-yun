import { createError, type H3Event } from 'h3'
import { callConsoleTenantRuntime } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { feedbackPermission, type FeedbackOperation } from '@hzy/foundation/server/utils/feedbackPermit'
import { loadPlatformRuntimeConfig } from './platformRuntime'
import { executeFeedbackRequest } from './feedbackHost'
import { requireConsoleRequestUid } from './requestIdentity'
import { loadPolicyScopedAuthorization } from './policyScopedAuthorization'
import { evaluateWithRevisionCheckedConsoleServicePolicy } from './revisionCheckedServicePolicy'

export async function consoleFeedback(event: H3Event, op: FeedbackOperation) {
  const config = loadPlatformRuntimeConfig(event)
  const { resource, action } = feedbackPermission(op)
  return executeFeedbackRequest(event, op, {
    identity: async () => {
      const uid = await requireConsoleRequestUid(event)
      if (!config.tenantCode || !config.deploymentCode) throw createError({ statusCode: 503, message: 'Console 身份暂不可用' })
      return { uid, tenant: config.tenantCode, deployment: config.deploymentCode }
    },
    authorize: (uid, resourceCode, action) => evaluateWithRevisionCheckedConsoleServicePolicy(event, config.tenantCode, () => loadPolicyScopedAuthorization(uid, 'console', event, { resourceCode, action, bypassSnapshotCache: true })),
    call: (body, idempotencyKey) => {
      if (op === 'settings-save') {
        const runtime = useRuntimeConfig(event)
        const publicUrl = String(runtime.public?.deploymentPublicUrl || process.env.HZY_DEPLOYMENT_PUBLIC_URL || '').replace(/\/$/, '')
        if (!publicUrl) throw createError({ statusCode: 503, message: '部署公共入口未配置' })
        const command = JSON.parse(String(body.payload)) as { settings?: { publicUrl?: string } }
        if (command.settings?.publicUrl?.replace(/\/$/, '') !== publicUrl) throw createError({ statusCode: 400, message: '公共入口必须与当前部署配置一致' })
      }
      // Browser list filters have already been normalized into the command.
      // Fixed Runtime POST operations never inherit the inbound GET query.
      return callConsoleTenantRuntime(event, `/v1/console/feedback:${op}`, { method: 'POST', query: {}, scope: `console:${resource}:${action}`, body, idempotencyKey })
    }
  })
}
