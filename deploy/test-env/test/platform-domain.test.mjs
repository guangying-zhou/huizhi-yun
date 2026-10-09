import assert from 'node:assert/strict'
import test from 'node:test'
import { updateDevelopmentUrls, updateDevelopmentRouting, platformDevOrigin, previousDevOrigin } from '../platform-domain.mjs'

const server = (domain, port) => `server {\n    server_name ${domain};\n    listen 443 ssl;\n    location / {\n        proxy_pass http://127.0.0.1:${port};\n    }\n}\n`
test('domain cutover touches only the two approved HTTPS virtual hosts', () => {
  const unrelated = server('platform.wiztek.cn', 3080) + server('huizhi.yun', 3010)
  const before = server('hzy.wiztek.cn', 3010) + unrelated + server('platform-dev.wiztek.cn', 3011)
  const after = updateDevelopmentRouting(before)
  assert.ok(after.includes(unrelated))
  assert.ok(after.startsWith(server('hzy.wiztek.cn', 3011)))
  assert.match(after, /return 308 https:\/\/hzy\.wiztek\.cn\$request_uri;/)
  assert.throws(() => updateDevelopmentRouting(after))
  assert.throws(() => updateDevelopmentRouting(server('hzy.wiztek.cn', 3030) + server('platform-dev.wiztek.cn', 3011)))
})
test('only explicit development public URLs change; credentials and DB stay unchanged', () => {
  const keys = ['PLATFORM_SERVICE_URL', 'PLATFORM_AUTH_ACTIVATION_BASE_URL', 'GOOGLE_OAUTH_REDIRECT_URI', 'WECOM_OAUTH_REDIRECT_URI',
    'NUXT_PUBLIC_SERVICE_URL', 'NUXT_AUTH_ACTIVATION_BASE_URL', 'NUXT_AUTH_GOOGLE_REDIRECT_URI', 'NUXT_AUTH_WECOM_REDIRECT_URI']
  const env = { DB_NAME: 'hzy_platform_dev', PORT: '3011', WECOM_CORPSECRET: 'synthetic-fixture', PLATFORM_INTERNAL_SERVICE_TOKENS: 'synthetic-token',
    ...Object.fromEntries(keys.map(k => [k, previousDevOrigin + '/callback'])) }
  const after = updateDevelopmentUrls(env)
  for (const k of keys) assert.equal(after[k], platformDevOrigin + '/callback')
  for (const k of ['DB_NAME', 'PORT', 'WECOM_CORPSECRET', 'PLATFORM_INTERNAL_SERVICE_TOKENS']) assert.equal(after[k], env[k])
  assert.throws(() => updateDevelopmentUrls({ ...env, DB_NAME: 'hzy_platform' }))
  assert.throws(() => updateDevelopmentUrls({ ...env, PLATFORM_SERVICE_URL: 'https://platform-dev.wiztek.cn.attacker.example' }))
})
