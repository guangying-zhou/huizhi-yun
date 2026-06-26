import type { H3Event } from 'h3'

interface RuntimeConfigShape {
  hzy?: Record<string, unknown>
  public?: Record<string, unknown>
}

export interface HzyLocalDevRuntimeMode {
  runMode: string
  isDevMode: boolean
  devApplicationsEnabled: boolean
  runtimeBypassEnabled: boolean
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function getRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function boolFromValue(value: unknown) {
  const normalized = stringValue(value).toLowerCase()
  if (!normalized) return null
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return null
}

function envValue(...keys: string[]) {
  for (const key of keys) {
    const value = stringValue(process.env[key])
    if (value) return value
  }
  return ''
}

function runtimeBoolean(configuredValue: unknown, envKeys: string[], fallback: boolean) {
  const parsed = boolFromValue(envValue(...envKeys) || configuredValue)
  return parsed ?? fallback
}

export function loadHzyLocalDevRuntimeMode(event?: H3Event): HzyLocalDevRuntimeMode {
  const config = useRuntimeConfig(event) as unknown as RuntimeConfigShape
  const hzy = getRecord(config.hzy) || {}
  const localDev = getRecord(hzy.localDev) || {}
  const publicConfig = getRecord(config.public) || {}
  const configuredRunMode = [
    envValue(
      'HZY_APP_RUN_MODE',
      'HZY_RUN_MODE',
      'HZY_CONSOLE_RUN_MODE',
      'CONSOLE_RUN_MODE'
    ),
    stringValue(localDev.runMode),
    stringValue(hzy.runMode),
    stringValue(publicConfig.deploymentProfile)
  ].find(Boolean) || ''

  const runMode = configuredRunMode || (process.env.NODE_ENV === 'development' ? 'dev' : 'prod')
  const normalizedRunMode = runMode.toLowerCase()
  const isDevMode = normalizedRunMode === 'dev'
    || (process.env.NODE_ENV === 'development' && !['prod', 'production', 'test'].includes(normalizedRunMode))
  const devApplicationsEnabled = isDevMode && runtimeBoolean(
    localDev.devApplicationsEnabled,
    ['HZY_DEV_APPLICATIONS_ENABLED', 'HZY_LOCAL_DEV_APPLICATIONS_ENABLED'],
    true
  )
  const runtimeBypassEnabled = isDevMode && runtimeBoolean(
    localDev.runtimeBypassEnabled,
    [
      'HZY_LOCAL_DEV_RUNTIME_BYPASS',
      'HZY_DEV_RUNTIME_BYPASS',
      'HZY_CONSOLE_DEV_POLICY_BYPASS',
      'CONSOLE_DEV_POLICY_BYPASS'
    ],
    devApplicationsEnabled
  )

  return {
    runMode,
    isDevMode,
    devApplicationsEnabled,
    runtimeBypassEnabled
  }
}
