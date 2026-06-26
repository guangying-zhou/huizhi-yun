import { createError, getCookie, getRouterParam, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { hasAimsSystemManageAccess } from '~~/server/utils/aimsAdminAccess'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface VersionPage {
  items?: Array<Record<string, unknown>>
  adminApiAvailable?: boolean
  readonlyFallback?: boolean
}

function text(value: unknown) {
  return String(value || '').trim()
}

function currentSubjectUid(event: H3Event) {
  const consoleAuth = event.context.consoleAuth as { authenticated?: boolean, uid?: string | null } | undefined
  if (consoleAuth?.authenticated) return text(consoleAuth.uid)
  return text(getCookie(event, 'auth_user'))
}

function statusCodeOf(error: unknown) {
  const err = error as { statusCode?: number, status?: number, response?: { status?: number } }
  return Number(err?.statusCode || err?.status || err?.response?.status || 0)
}

function assertRuntimeEnvelope<T>(envelope: RuntimeEnvelope<T>, fallbackMessage: string) {
  if (envelope.code !== undefined && envelope.code !== 0) {
    throw createError({
      statusCode: 502,
      message: envelope.message || fallbackMessage
    })
  }
  return envelope.data
}

export default defineEventHandler(async (event) => {
  const productCode = text(getRouterParam(event, 'productCode'))
  if (!productCode) {
    throw createError({ statusCode: 400, message: 'productCode is required.' })
  }

  const uid = currentSubjectUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: 'current_user is required.' })
  }
  if (!await hasAimsSystemManageAccess(event)) {
    throw createError({ statusCode: 403, message: 'Aims administrator access is required.' })
  }

  try {
    const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<VersionPage>>(
      event,
      `/v1/aims/admin/products/${encodeURIComponent(productCode)}/versions`,
      {
        appCode: 'aims',
        scope: 'aims.read',
        method: 'GET',
        query: {
          current_user: uid,
          current_user_is_project_admin: '1'
        }
      }
    )

    if (!runtime.handled) {
      throw createError({
        statusCode: 503,
        message: 'Aims tenant-runtime is required for product version admin API.'
      })
    }

    return {
      code: 0,
      data: {
        ...(assertRuntimeEnvelope(runtime.data, 'Aims tenant-runtime returned an error.') || { items: [] }),
        adminApiAvailable: true
      }
    }
  } catch (error) {
    if (statusCodeOf(error) !== 404) throw error
  }

  const fallback = await maybeCallTenantRuntime<RuntimeEnvelope<VersionPage>>(
    event,
    `/v1/aims/service/products/${encodeURIComponent(productCode)}/versions`,
    {
      appCode: 'aims',
      scope: 'aims.read',
      method: 'GET',
      query: {
        current_user: uid
      }
    }
  )

  if (!fallback.handled) {
    throw createError({
      statusCode: 503,
      message: 'Aims tenant-runtime is required for product version service API.'
    })
  }

  return {
    code: 0,
    data: {
      ...(assertRuntimeEnvelope(fallback.data, 'Aims tenant-runtime returned an error.') || { items: [] }),
      adminApiAvailable: false,
      readonlyFallback: true
    }
  }
})
