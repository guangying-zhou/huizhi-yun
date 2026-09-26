import type { H3Event } from 'h3'
import type { RuntimeNotification } from './runtimeNotifications'

export interface RuntimeActionableLifecycle {
  effectId?: number
  actionableKey?: string
  expectedVersion?: string
  nextVersion?: string
  state?: 'resolved' | 'cancelled'
  recipients?: string[]
  prerequisiteNotifications?: RuntimeNotification[]
}

export interface ActionableLifecycleDependencies {
  requestAccessToken: (options: {
    audience: string
    scope: string
    event: H3Event
    forceRefresh?: boolean
  }) => Promise<string>
  request: (url: string, options: {
    method: 'POST'
    headers: Record<string, string>
    body: Record<string, unknown>
    timeout: number
  }) => Promise<unknown>
  resolveConsoleBaseUrl: (event: H3Event) => string
  checkpoint: (event: H3Event, effectId: number, outcome: 'ack' | 'fail') => Promise<unknown>
  publishNotifications: (event: H3Event, notifications: RuntimeNotification[]) => Promise<Array<{ status: string }>>
  error?: (message: string, error: unknown) => void
}

function responseStatusCode(error: unknown) {
  const value = error as {
    statusCode?: number
    response?: { status?: number, statusCode?: number }
  }
  return Number(value?.response?.status || value?.response?.statusCode || value?.statusCode || 0)
}

export async function deliverWorkflowActionableLifecyclesWithDependencies(
  event: H3Event,
  lifecycles: RuntimeActionableLifecycle[],
  dependencies: ActionableLifecycleDependencies,
  publishPrerequisites = true
) {
  const results: Array<{
    effect: RuntimeActionableLifecycle
    status: 'delivered' | 'pending' | 'invalid'
    code?: string
  }> = []
  for (const effect of lifecycles) {
    const effectId = Number(effect.effectId || 0)
    const actionableKey = String(effect.actionableKey || '').trim()
    const expectedVersion = String(effect.expectedVersion || '').trim()
    const nextVersion = String(effect.nextVersion || '').trim()
    const recipients = [...new Set((effect.recipients || []).map(uid => String(uid).trim()).filter(Boolean))].sort()
    if (!effectId || !actionableKey || !expectedVersion || !nextVersion || expectedVersion === nextVersion || !effect.state || recipients.length === 0) {
      results.push({ effect, status: 'invalid', code: 'workflow_actionable_lifecycle_invalid' })
      continue
    }
    if (publishPrerequisites && (effect.prerequisiteNotifications?.length || 0) > 0) {
      const prerequisiteResults = await dependencies.publishNotifications(event, effect.prerequisiteNotifications || [])
      if (!prerequisiteResults.every(result => result.status === 'published')) {
        try {
          await dependencies.checkpoint(event, effectId, 'fail')
        } catch (checkpointError) {
          dependencies.error?.('[WorkflowRuntime] 待办生命周期通知屏障检查点写入失败:', checkpointError)
        }
        results.push({ effect: { ...effect, recipients }, status: 'pending', code: 'notification_publish_incomplete' })
        continue
      }
    }
    try {
      const requestWithToken = async (forceRefresh: boolean) => {
        const accessToken = await dependencies.requestAccessToken({
          audience: 'notifications',
          scope: 'notifications:publish',
          event,
          ...(forceRefresh ? { forceRefresh: true } : {})
        })
        const consoleBaseUrl = dependencies.resolveConsoleBaseUrl(event)
        return await dependencies.request(new URL('/api/v1/console/notifications/actionable-lifecycle', consoleBaseUrl).toString(), {
          method: 'POST',
          headers: {
            'authorization': `Bearer ${accessToken}`,
            'content-type': 'application/json'
          },
          body: {
            sourceAppCode: 'workflow',
            actionableKey,
            expectedVersion,
            nextVersion,
            state: effect.state,
            recipients
          },
          timeout: 10000
        })
      }
      try {
        await requestWithToken(false)
      } catch (error) {
        if (responseStatusCode(error) !== 401) throw error
        await requestWithToken(true)
      }
      await dependencies.checkpoint(event, effectId, 'ack')
      results.push({ effect: { ...effect, recipients }, status: 'delivered' })
    } catch (error) {
      dependencies.error?.('[WorkflowRuntime] 待办生命周期投影失败:', error)
      try {
        await dependencies.checkpoint(event, effectId, 'fail')
      } catch (checkpointError) {
        dependencies.error?.('[WorkflowRuntime] 待办生命周期失败检查点写入失败:', checkpointError)
      }
      results.push({ effect: { ...effect, recipients }, status: 'pending', code: 'console_actionable_lifecycle_failed' })
    }
  }
  return results
}
