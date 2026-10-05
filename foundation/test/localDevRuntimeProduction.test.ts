import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { isProductionPlatformEnvironment } from '../shared/utils/productionEnvironment'
import { loadHzyLocalDevRuntimeMode } from '../server/utils/localDevRuntime'

const globals = globalThis as { useRuntimeConfig?: () => unknown }
const keys = ['HZY_PLATFORM_ENVIRONMENT', 'HZY_APP_RUN_MODE', 'NODE_ENV', 'HZY_DEV_RUNTIME_BYPASS', 'HZY_DEV_APPLICATIONS_ENABLED'] as const

function withEnv(values: Partial<Record<typeof keys[number], string>>, run: () => void) {
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const previousConfig = globals.useRuntimeConfig
  globals.useRuntimeConfig = () => ({ hzy: {}, public: {} })
  const assign = (key: typeof keys[number], value: string | undefined) => {
    if (value === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = value
  }
  for (const key of keys) assign(key, values[key])
  try {
    run()
  } finally {
    for (const key of keys) assign(key, previous[key])
    globals.useRuntimeConfig = previousConfig
  }
}

test('production platform environment is recognized strictly', () => {
  for (const value of ['prod', 'production', ' PROD ', 'Production']) assert.equal(isProductionPlatformEnvironment(value), true, value)
  for (const value of ['', 'test', 'dev', 'staging', 'prod-like', undefined, null]) assert.equal(isProductionPlatformEnvironment(value), false, String(value))
})

test('a declared production environment never enables local dev applications or the Runtime bypass', () => {
  for (const environment of ['prod', 'production']) {
    withEnv({ HZY_PLATFORM_ENVIRONMENT: environment, HZY_APP_RUN_MODE: 'dev', NODE_ENV: 'development', HZY_DEV_RUNTIME_BYPASS: 'true', HZY_DEV_APPLICATIONS_ENABLED: 'true' }, () => {
      const mode = loadHzyLocalDevRuntimeMode()
      assert.equal(mode.isDevMode, false)
      assert.equal(mode.devApplicationsEnabled, false)
      assert.equal(mode.runtimeBypassEnabled, false)
    })
  }
})

test('explicit local development and the hzy0 test profile keep their existing behaviour', () => {
  withEnv({ HZY_APP_RUN_MODE: 'dev', NODE_ENV: 'development' }, () => {
    const mode = loadHzyLocalDevRuntimeMode()
    assert.equal(mode.isDevMode, true)
    assert.equal(mode.runtimeBypassEnabled, true)
  })
  // hzy0: NODE_ENV=development, run mode test, bypass switches explicitly false.
  withEnv({ HZY_PLATFORM_ENVIRONMENT: 'test', HZY_APP_RUN_MODE: 'test', NODE_ENV: 'development', HZY_DEV_RUNTIME_BYPASS: 'false' }, () => {
    const mode = loadHzyLocalDevRuntimeMode()
    assert.equal(mode.isDevMode, false)
    assert.equal(mode.runtimeBypassEnabled, false)
  })
})

test('Console development policy bypass is also refused in a declared production environment', () => {
  const source = readFileSync(new URL('../../console/server/utils/platformRuntime.ts', import.meta.url), 'utf8')
  assert.match(source, /const devPolicyBypassEnabled = isDevMode && !runtimeEnabled\s*&& !isProductionPlatformEnvironment\(runtimeEnvValueForEvent\(runtimeEvent, 'HZY_PLATFORM_ENVIRONMENT'\)\)/)
})
