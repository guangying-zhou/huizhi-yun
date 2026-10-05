import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const peopleRoot = resolve(import.meta.dirname, '..')
const renderer = join(peopleRoot, 'scripts/render-cloudflare-config.mjs')

function render(overrides: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), 'hzy-people-wrangler-'))
  const output = join(directory, 'wrangler.json')
  const environment = {
    ...process.env,
    HZY_PEOPLE_WRANGLER_OUTPUT: output,
    HZY_PEOPLE_OFFBOARDING_NOTIFICATIONS_ENABLED: 'false',
    HZY_PEOPLE_INTEGRATION_OPERATION_DEAD_LETTER_NOTIFICATIONS_ENABLED: 'false',
    HZY_PEOPLE_ASSETS_OFFBOARDING_SYNC_ENABLED: 'false',
    HZY_PEOPLE_DIRECTORY_LIFECYCLE_SYNC_ENABLED: 'false',
    HZY_TENANT_RUNTIME_URL: ' ',
    HZY_TENANT_RUNTIME_TENANT: ' ',
    HZY_TENANT_RUNTIME_DEPLOYMENT: ' ',
    HZY_CONSOLE_TARGET_DEPLOYMENT: ' ',
    HZY_PEOPLE_SERVICE_CLIENT_ID: ' ',
    ...overrides
  }
  const result = spawnSync(process.execPath, [renderer], { cwd: peopleRoot, env: environment, encoding: 'utf8' })
  return {
    result,
    read: () => JSON.parse(readFileSync(output, 'utf8')) as {
      vars?: Record<string, string>
      triggers?: { crons?: string[] }
      services?: Array<{ binding: string, service: string }>
    },
    cleanup: () => rmSync(directory, { recursive: true, force: true })
  }
}

test('People lifecycle Cloudflare renderer is default-off without a cron', () => {
  const rendered = render({})
  try {
    assert.equal(rendered.result.status, 0, rendered.result.stderr)
    const config = rendered.read()
    assert.equal(config.vars?.HZY_PEOPLE_DIRECTORY_LIFECYCLE_SYNC_ENABLED, 'false')
    assert.equal(config.vars?.HZY_PEOPLE_INTEGRATION_OPERATION_DEAD_LETTER_NOTIFICATIONS_ENABLED, 'false')
    assert.match(readFileSync(join(peopleRoot, 'nuxt.config.ts'), 'utf8'), /directoryLifecycleEnabled: process\.env\.HZY_PEOPLE_DIRECTORY_LIFECYCLE_SYNC_ENABLED \|\| 'false'/)
    assert.deepEqual(config.services, [{
      binding: 'HZY_CONSOLE_SERVICE',
      service: 'hzy-console-prod'
    }])
    assert.equal(config.triggers, undefined)
  } finally {
    rendered.cleanup()
  }
})

test('People application identity uses the HR name and branded logo', () => {
  const rendered = render({})
  try {
    assert.equal(rendered.result.status, 0, rendered.result.stderr)
    const config = rendered.read()
    assert.equal(config.vars?.NUXT_PUBLIC_APP_NAME, '汇智云HR')
    assert.equal(config.vars?.NUXT_PUBLIC_APP_DISPLAY_NAME, '汇智云HR')

    const nuxtConfig = readFileSync(join(peopleRoot, 'nuxt.config.ts'), 'utf8')
    assert.match(nuxtConfig, /appDisplayName: process\.env\.NUXT_PUBLIC_APP_DISPLAY_NAME \|\| '汇智云HR'/)
    assert.match(nuxtConfig, /appLogo: process\.env\.NUXT_PUBLIC_APP_LOGO \|\| withAppBase\('\/logo\.png'\)/)
  } finally {
    rendered.cleanup()
  }
})

test('People lifecycle Cloudflare renderer emits cron and true flag with complete binding', () => {
  const rendered = render({
    HZY_PEOPLE_DIRECTORY_LIFECYCLE_SYNC_ENABLED: 'true',
    HZY_TENANT_RUNTIME_URL: 'https://runtime.example.test',
    HZY_TENANT_RUNTIME_TENANT: 'tenant-1',
    HZY_TENANT_RUNTIME_DEPLOYMENT: 'people-prod',
    HZY_CONSOLE_TARGET_DEPLOYMENT: 'console-prod',
    HZY_PEOPLE_SERVICE_CLIENT_ID: 'people-client'
  })
  try {
    assert.equal(rendered.result.status, 0, rendered.result.stderr)
    const config = rendered.read()
    assert.equal(config.vars?.HZY_PEOPLE_DIRECTORY_LIFECYCLE_SYNC_ENABLED, 'true')
    assert.equal(config.vars?.HZY_CONSOLE_TARGET_DEPLOYMENT, 'console-prod')
    assert.deepEqual(config.triggers?.crons, ['*/15 * * * *'])
  } finally {
    rendered.cleanup()
  }
})

test('People due notification worker does not require a Console target deployment', () => {
  const rendered = render({
    HZY_PEOPLE_OFFBOARDING_NOTIFICATIONS_ENABLED: 'true',
    HZY_TENANT_RUNTIME_URL: 'https://runtime.example.test',
    HZY_TENANT_RUNTIME_TENANT: 'tenant-1',
    HZY_TENANT_RUNTIME_DEPLOYMENT: 'people-prod',
    HZY_PEOPLE_SERVICE_CLIENT_ID: 'people.runtime'
  })
  try {
    assert.equal(rendered.result.status, 0, rendered.result.stderr)
    assert.deepEqual(rendered.read().triggers?.crons, ['*/15 * * * *'])
  } finally {
    rendered.cleanup()
  }
})

test('People dead-letter actionable drain independently enables the bounded cron', () => {
  const rendered = render({
    HZY_PEOPLE_INTEGRATION_OPERATION_DEAD_LETTER_NOTIFICATIONS_ENABLED: 'true',
    HZY_TENANT_RUNTIME_URL: 'https://runtime.example.test',
    HZY_TENANT_RUNTIME_TENANT: 'tenant-1',
    HZY_TENANT_RUNTIME_DEPLOYMENT: 'people-prod',
    HZY_PEOPLE_SERVICE_CLIENT_ID: 'people-client'
  })
  try {
    assert.equal(rendered.result.status, 0, rendered.result.stderr)
    const config = rendered.read()
    assert.equal(config.vars?.HZY_PEOPLE_INTEGRATION_OPERATION_DEAD_LETTER_NOTIFICATIONS_ENABLED, 'true')
    assert.deepEqual(config.triggers?.crons, ['*/15 * * * *'])
  } finally {
    rendered.cleanup()
  }
})

test('People lifecycle Cloudflare renderer fails closed when binding is incomplete', () => {
  const rendered = render({
    HZY_PEOPLE_DIRECTORY_LIFECYCLE_SYNC_ENABLED: 'true',
    HZY_TENANT_RUNTIME_URL: 'https://runtime.example.test',
    HZY_TENANT_RUNTIME_TENANT: 'tenant-1',
    HZY_TENANT_RUNTIME_DEPLOYMENT: 'people-prod',
    HZY_CONSOLE_TARGET_DEPLOYMENT: 'console-prod'
  })
  try {
    assert.notEqual(rendered.result.status, 0)
    assert.match(rendered.result.stderr, /People scheduled lifecycle delivery requires explicit binding vars: HZY_PEOPLE_SERVICE_CLIENT_ID/)
  } finally {
    rendered.cleanup()
  }
})
