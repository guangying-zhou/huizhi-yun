import { createError, readBody, setResponseStatus } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { dispatchDirectoryLifecycleOperation } from '~~/server/utils/directoryLifecycleOperation'
import { requireServiceScope } from '~~/server/utils/serviceAuth'
import {
  normalizePeopleWorkflowCallbackBody
} from '~~/server/utils/peopleWorkflowCallbackProjection'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

type RuntimeObject = Record<string, unknown>

function text(value: unknown) {
  return String(value || '').trim()
}

function okEnvelope<T>(envelope: RuntimeEnvelope<T>, fallbackMessage: string) {
  if (envelope.code !== undefined && envelope.code !== 0) {
    throw createError({ statusCode: 502, message: envelope.message || fallbackMessage })
  }
  return envelope.data
}

async function callPeopleWorkflowCallbackRuntime(event: Parameters<typeof maybeCallTenantRuntime>[0], body: RuntimeObject) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<RuntimeObject>>(
    event,
    '/v1/people/service/workflow/callback',
    {
      appCode: 'people',
      scope: 'people.write',
      method: 'POST',
      body
    }
  )
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'People tenant-runtime is required for workflow callback.' })
  }
  return okEnvelope(runtime.data, 'People workflow callback runtime returned an error.') || {}
}

export default defineEventHandler(async (event) => {
  await requireServiceScope(event, { scope: 'workflow:callback', allowedApps: ['workflow'] })

  const rawBody = await readBody<Record<string, unknown>>(event).catch(() => ({} as Record<string, unknown>))
  const callback = normalizePeopleWorkflowCallbackBody(rawBody)
  const runtimeData = await callPeopleWorkflowCallbackRuntime(event, callback.body)

  const lifecycle = (runtimeData.directoryLifecycle || {}) as RuntimeObject
  const operationKey = text(lifecycle.operationKey)
  const delivery = operationKey ? await dispatchDirectoryLifecycleOperation(event, operationKey) : null
  if (delivery?.pending) setResponseStatus(event, 202)

  return {
    code: 0,
    message: 'ok',
    data: {
      ...runtimeData,
      directoryLifecycleDelivery: delivery
    }
  }
})
