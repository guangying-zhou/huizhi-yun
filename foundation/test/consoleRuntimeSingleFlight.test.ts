import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { getConsoleRuntimeConfig } from '../server/utils/consoleRuntime.ts'

const originalFetch = (globalThis as { $fetch?: unknown }).$fetch
const originalRuntimeConfig = (globalThis as { useRuntimeConfig?: unknown }).useRuntimeConfig

afterEach(() => {
  ;(globalThis as { $fetch?: unknown }).$fetch = originalFetch
  ;(globalThis as { useRuntimeConfig?: unknown }).useRuntimeConfig = originalRuntimeConfig
})

test('coalesces concurrent Console Runtime cache misses for the same tenant and app', async () => {
  const consoleUrl = 'https://console-single-flight.example.test'
  const appCode = 'single-flight-app'
  let fetchCalls = 0
  let releaseFetch: (() => void) | null = null
  const fetchGate = new Promise<void>((resolve) => {
    releaseFetch = resolve
  })

  ;(globalThis as { useRuntimeConfig?: () => Record<string, unknown> }).useRuntimeConfig = () => ({})
  ;(globalThis as { $fetch?: unknown }).$fetch = async () => {
    fetchCalls += 1
    await fetchGate
    return {
      code: 0,
      data: {
        schemaVersion: 'console-runtime.v1',
        app: { appCode, appName: 'Single Flight App' },
        console: {
          baseUrl: consoleUrl,
          issuer: consoleUrl,
          tokenUrl: `${consoleUrl}/oauth/token`,
          bootstrapTokenUrl: `${consoleUrl}/api/v1/console/bootstrap/token`,
          authMeUrl: `${consoleUrl}/api/v1/console/auth/me`,
          directoryApiUrl: `${consoleUrl}/api/v1/console/directory`,
          settingsApiUrl: `${consoleUrl}/api/v1/console/settings`,
          integrationsApiUrl: `${consoleUrl}/api/v1/console/integrations`,
          userApplicationsUrl: `${consoleUrl}/api/user/applications`
        },
        fetchedAt: '2026-07-19T00:00:00.000Z'
      }
    }
  }

  const event = {
    context: {
      cloudflare: {
        env: {
          HZY_APP_CODE: appCode,
          HZY_CONSOLE_RUNTIME_API_URL: consoleUrl
        }
      }
    },
    node: {
      req: {
        headers: { host: 'single-flight.example.test' },
        url: '/api/test',
        originalUrl: '/api/test'
      }
    },
    path: '/api/test'
  } as never

  const first = getConsoleRuntimeConfig({ event, allowFallback: false })
  const second = getConsoleRuntimeConfig({ event, allowFallback: false })
  await Promise.resolve()
  try {
    assert.equal(fetchCalls, 1)
  } finally {
    releaseFetch?.()
  }

  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.equal(firstResult, secondResult)
  assert.equal(firstResult.app.appCode, appCode)
  assert.equal(fetchCalls, 1)
})

test('does not share an in-flight Console Runtime request across Worker requests', async () => {
  const consoleUrl = 'https://console-request-isolation.example.test'
  const appCode = 'request-isolation-app'
  let fetchCalls = 0
  let releaseFetch: (() => void) | null = null
  const fetchGate = new Promise<void>((resolve) => {
    releaseFetch = resolve
  })

  ;(globalThis as { useRuntimeConfig?: () => Record<string, unknown> }).useRuntimeConfig = () => ({})
  ;(globalThis as { $fetch?: unknown }).$fetch = async () => {
    fetchCalls += 1
    await fetchGate
    return {
      code: 0,
      data: {
        schemaVersion: 'console-runtime.v1',
        app: { appCode, appName: 'Request Isolation App' },
        console: {
          baseUrl: consoleUrl,
          issuer: consoleUrl,
          tokenUrl: `${consoleUrl}/oauth/token`,
          bootstrapTokenUrl: `${consoleUrl}/api/v1/console/bootstrap/token`,
          authMeUrl: `${consoleUrl}/api/v1/console/auth/me`,
          directoryApiUrl: `${consoleUrl}/api/v1/console/directory`,
          settingsApiUrl: `${consoleUrl}/api/v1/console/settings`,
          integrationsApiUrl: `${consoleUrl}/api/v1/console/integrations`,
          userApplicationsUrl: `${consoleUrl}/api/user/applications`
        },
        fetchedAt: '2026-08-23T00:00:00.000Z'
      }
    }
  }

  const makeEvent = () => ({
    context: {
      cloudflare: {
        env: {
          HZY_APP_CODE: appCode,
          HZY_CONSOLE_RUNTIME_API_URL: consoleUrl
        }
      }
    },
    node: {
      req: {
        headers: { host: 'request-isolation.example.test' },
        url: '/api/test',
        originalUrl: '/api/test'
      }
    },
    path: '/api/test'
  }) as never

  const first = getConsoleRuntimeConfig({ event: makeEvent(), allowFallback: false })
  const second = getConsoleRuntimeConfig({ event: makeEvent(), allowFallback: false })
  await Promise.resolve()
  try {
    assert.equal(fetchCalls, 2)
  } finally {
    releaseFetch?.()
  }

  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.equal(firstResult.app.appCode, appCode)
  assert.equal(secondResult.app.appCode, appCode)
  assert.equal(fetchCalls, 2)
})
