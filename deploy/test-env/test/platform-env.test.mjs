import assert from 'node:assert/strict'
import test from 'node:test'
import { nuxtPlatformEnv } from '../platform-env.mjs'

test('credential-free builds preserve explicit development DB and login runtime overrides', () => {
  const env = { DB_NAME: 'hzy_platform_dev', DB_PASSWORD: 'fixture-db', DB_PORT: '3306',
    GOOGLE_OAUTH_CLIENT_SECRET: 'fixture-google', GOOGLE_OAUTH_REDIRECT_URI: 'https://platform-dev.example.invalid/callback',
    PLATFORM_SERVICE_URL: 'https://platform-dev.example.invalid', PLATFORM_INTERNAL_SERVICE_TOKENS: 'fixture-internal',
    HZY_PLATFORM_SIGNING_PRIVATE_KEY: 'fixture-signing', PLATFORM_OPS_UIDS: 'fixture-operator' }
  const mapped = nuxtPlatformEnv(env)
  assert.equal(mapped.NUXT_DB_NAME, env.DB_NAME)
  assert.equal(mapped.NUXT_DB_PASSWORD, env.DB_PASSWORD)
  assert.equal(mapped.NUXT_AUTH_GOOGLE_CLIENT_SECRET, env.GOOGLE_OAUTH_CLIENT_SECRET)
  assert.equal(mapped.NUXT_AUTH_GOOGLE_REDIRECT_URI, env.GOOGLE_OAUTH_REDIRECT_URI)
  assert.equal(mapped.NUXT_PUBLIC_SERVICE_URL, env.PLATFORM_SERVICE_URL)
  assert.equal(mapped.NUXT_SECURITY_INTERNAL_SERVICE_TOKENS, env.PLATFORM_INTERNAL_SERVICE_TOKENS)
  assert.equal(mapped.NUXT_SECURITY_OPS_UIDS, env.PLATFORM_OPS_UIDS)
  assert.equal(mapped.HZY_PLATFORM_SIGNING_PRIVATE_KEY, env.HZY_PLATFORM_SIGNING_PRIVATE_KEY)
  assert.equal(env.NUXT_DB_NAME, undefined)
})

test('shared test control plane does not enable development mock login', () => {
  const env = nuxtPlatformEnv({ NUXT_AUTH_DEV_MOCK_ENABLED: 'true', NUXT_PUBLIC_AUTH_DEV_MOCK_ENABLED: 'true' })
  assert.equal(env.NUXT_AUTH_DEV_MOCK_ENABLED, 'false')
  assert.equal(env.NUXT_PUBLIC_AUTH_DEV_MOCK_ENABLED, 'false')
})

test('captured PM2 metadata cannot rename a probe or enable watch', () => {
  const env = nuxtPlatformEnv({ name: 'hzy-platform-dev', pm_id: '4', watch: 'false', pm_exec_path: '/old/server.mjs', PM2_HOME: '/root/.pm2', NODE_APP_INSTANCE: '0', PATH: '/usr/bin' })
  for (const key of ['name', 'pm_id', 'watch', 'pm_exec_path', 'PM2_HOME', 'NODE_APP_INSTANCE']) assert.equal(env[key], undefined)
  assert.equal(env.PATH, '/usr/bin')
})
