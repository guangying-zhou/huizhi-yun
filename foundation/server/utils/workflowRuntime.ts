import { getRuntimeSetting } from './runtimeSettings'
import { getConsoleRuntimeConfig } from './consoleRuntime'
import {
  resolveServiceAppBaseUrl,
  resolveTenantGatewayServiceAppBaseUrl
} from './serviceAppUrl'
import type { H3Event } from 'h3'

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function getConfigValue(config: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    let current: unknown = config
    for (const part of key.split('.')) {
      if (!current || typeof current !== 'object') {
        current = undefined
        break
      }
      current = (current as Record<string, unknown>)[part]
    }

    if (current !== undefined && current !== null && stringValue(current)) {
      return stringValue(current)
    }
  }

  return ''
}

function normalizeBaseUrl(value: string) {
  const normalized = value.replace(/\/+$/, '')
  try {
    const url = new URL(normalized)
    const isLocalWorkflowDevServer = ['localhost', '127.0.0.1', '::1'].includes(url.hostname) && url.port === '3020'
    if (isLocalWorkflowDevServer && (url.pathname === '' || url.pathname === '/')) {
      url.pathname = '/workflow'
      return url.toString().replace(/\/+$/, '')
    }
  } catch {
    // Keep non-URL values unchanged; callers may provide framework-relative paths.
  }
  return normalized
}

export async function resolveWorkflowApiUrl(event?: H3Event | null) {
  const managedTenantGatewayUrl = resolveTenantGatewayServiceAppBaseUrl(event, 'workflow')
  if (managedTenantGatewayUrl) {
    // A Worker subrequest back to the same tenant host can loop inside the
    // Cloudflare zone without ever reaching Tenant Gateway.  Cross-app server
    // calls therefore use Workflow's tenant-neutral service origin and forward
    // the already verified tenant/runtime context separately in proxy headers.
    const managedServiceUrl = resolveServiceAppBaseUrl(event, 'workflow', { directTarget: true })
    if (/^https:\/\//i.test(managedServiceUrl)) {
      return normalizeBaseUrl(managedServiceUrl)
    }
  }

  const config = useRuntimeConfig() as unknown as Record<string, unknown>
  const configured = getConfigValue(config, [
    'hzy.workflowApiUrl',
    'workflow.apiUrl'
  ]) || ''

  if (configured) {
    return normalizeBaseUrl(configured)
  }

  const fromRuntime = await getConsoleRuntimeConfig(event ? { event } : undefined)
    .then(runtime => stringValue(runtime.workflow?.apiUrl))
    .catch(() => '')
  if (fromRuntime) {
    return normalizeBaseUrl(fromRuntime)
  }

  const fromConsole = await getRuntimeSetting<string>('workflow.apiUrl', '')
  return normalizeBaseUrl(fromConsole || 'http://localhost:3020')
}
