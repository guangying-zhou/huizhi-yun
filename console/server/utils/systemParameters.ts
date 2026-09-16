import type { H3Event } from 'h3'
import { useEvent } from 'nitropack/runtime'
import {
  getConsoleSettingValues,
  updateConsoleManagedSettingValue
} from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'

const TENANT_SCOPE = '__tenant__'

interface RuntimeSettingValue {
  settingKey: string
  value: unknown
  revision: number
}

function requestEvent(event?: H3Event) {
  return event || useEvent()
}

function assertSettingKey(value: unknown) {
  const key = String(value || '').trim()
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/i.test(key) || key.length > 128) {
    throw createError({ statusCode: 400, message: 'invalid settingKey' })
  }
  return key
}

async function runtimeSettingValues(keys: string[], event?: H3Event) {
  const normalized = [...new Set(keys.map(assertSettingKey))]
  if (!normalized.length) return []
  const response = await getConsoleSettingValues(requestEvent(event), {
    keys: normalized.join(','),
    scopeKey: TENANT_SCOPE
  })
  return response.data.items as RuntimeSettingValue[]
}

export async function getSystemParameter(key: string, event?: H3Event): Promise<string | null> {
  const item = (await runtimeSettingValues([key], event))[0]
  if (item?.value === undefined || item.value === null) return null
  return typeof item.value === 'string' ? item.value : JSON.stringify(item.value)
}

export async function getSystemParameters(keys: string[], event?: H3Event): Promise<Record<string, string>> {
  const items = await runtimeSettingValues(keys, event)
  return items.reduce<Record<string, string>>((result, item) => {
    if (item.value !== undefined && item.value !== null) {
      result[item.settingKey] = typeof item.value === 'string'
        ? item.value
        : JSON.stringify(item.value)
    }
    return result
  }, {})
}

/**
 * Server-owned settings use a separate Runtime capability. The current
 * revision is read immediately before the CAS mutation; a concurrent change
 * fails with 409 and is never overwritten.
 */
export async function updateManagedSettingValue(input: {
  event: H3Event
  settingKey: unknown
  scopeKey?: unknown
  value: unknown
  updatedBy?: string | null
}) {
  const settingKey = assertSettingKey(input.settingKey)
  const scopeKey = String(input.scopeKey || TENANT_SCOPE).trim()
  if (scopeKey !== TENANT_SCOPE) {
    throw createError({ statusCode: 400, message: 'managed settings only support tenant scope' })
  }
  const current = (await runtimeSettingValues([settingKey], input.event))[0]
  if (!current) {
    throw createError({ statusCode: 404, message: 'setting not found' })
  }
  const response = await updateConsoleManagedSettingValue(input.event, settingKey, {
    scopeKey,
    value: input.value,
    expectedRevision: current.revision
  })
  return response.data
}
