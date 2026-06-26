import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { useEvent } from 'nitropack/runtime'

interface RuntimeConfigShape {
  hzy?: unknown
  platform?: unknown
}

export interface LicenseBootstrapConfig {
  consoleUrl: string
  tokenUrl: string
  accessKey: string
  appCode: string
  deploymentCode: string
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function resolvePath(path: string) {
  return isAbsolute(path) ? path : resolve(process.cwd(), path)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function getCloudflareEnvValue(name: string) {
  try {
    const event = useEvent()
    const env = (event?.context as { cloudflare?: { env?: Record<string, unknown> } } | undefined)?.cloudflare?.env
    return stringValue(env?.[name])
  } catch {
    return ''
  }
}

function getNestedValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    let current: unknown = record
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

export function resolveLicensePath(config?: RuntimeConfigShape) {
  const hzy = asRecord(config?.hzy)
  const serviceClient = asRecord(hzy.serviceClient)
  const hzyPlatform = asRecord(hzy.platform)
  const platform = asRecord(config?.platform)

  const configuredPath = stringValue(
    serviceClient.licensePath
    || hzyPlatform.licensePath
    || platform.licensePath
    || hzy.platformLicensePath
    || process.env.HZY_PLATFORM_LICENSE_PATH
    || process.env.PLATFORM_LICENSE_PATH
  )

  return configuredPath ? resolvePath(configuredPath) : ''
}

export function readLicenseTokenRaw(config?: RuntimeConfigShape) {
  const inlineToken = stringValue(
    process.env.HZY_PLATFORM_LICENSE_TOKEN
    || process.env.PLATFORM_LICENSE_TOKEN
    || getCloudflareEnvValue('HZY_PLATFORM_LICENSE_TOKEN')
    || getCloudflareEnvValue('PLATFORM_LICENSE_TOKEN')
  )

  if (inlineToken) {
    return inlineToken
  }

  const licensePath = resolveLicensePath(config)
  if (!licensePath) {
    throw new Error('Platform license token is not configured; set HZY_PLATFORM_LICENSE_TOKEN or an explicit HZY_PLATFORM_LICENSE_PATH')
  }

  return readFileSync(licensePath, 'utf8')
}

export function readLicenseBootstrapConfig(config?: RuntimeConfigShape): LicenseBootstrapConfig | null {
  try {
    const token = JSON.parse(readLicenseTokenRaw(config)) as Record<string, unknown>
    const consoleUrl = getNestedValue(token, [
      'bootstrap.consoleUrl',
      'runtimeBootstrap.consoleUrl',
      'payload.consoleUrl',
      'payload.consoleApiUrl'
    ])
    const tokenUrl = getNestedValue(token, [
      'bootstrap.tokenUrl',
      'runtimeBootstrap.tokenUrl'
    ])
    const accessKey = getNestedValue(token, [
      'bootstrap.accessKey',
      'runtimeBootstrap.accessKey',
      'payload.bootstrapAccessKey'
    ])
    const appCode = getNestedValue(token, ['payload.appCode'])
    const deploymentCode = getNestedValue(token, ['payload.deploymentCode'])

    if (!consoleUrl && !tokenUrl && !accessKey) {
      return null
    }

    return {
      consoleUrl,
      tokenUrl,
      accessKey,
      appCode,
      deploymentCode
    }
  } catch {
    return null
  }
}
