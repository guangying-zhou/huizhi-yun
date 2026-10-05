import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildPlatformWecomApiUrl,
  resolvePlatformWecomApiBase,
  WECOM_API_BASE_INVALID_CODE,
  WecomApiBaseError
} from '../server/utils/wecomApiBase.ts'

test('empty or unset WeCom API base keeps the official endpoint', () => {
  for (const value of [undefined, null, '', '   ']) {
    assert.equal(resolvePlatformWecomApiBase(value), 'https://qyapi.weixin.qq.com')
  }
  assert.equal(resolvePlatformWecomApiBase('https://qyapi.weixin.qq.com'), 'https://qyapi.weixin.qq.com')
  assert.equal(resolvePlatformWecomApiBase('https://qyapi.weixin.qq.com/'), 'https://qyapi.weixin.qq.com')
})

test('tailnet http base with explicit port is accepted and normalized', () => {
  assert.equal(resolvePlatformWecomApiBase('http://100.98.120.65:8790'), 'http://100.98.120.65:8790')
  assert.equal(resolvePlatformWecomApiBase(' http://100.98.120.65:8790/ '), 'http://100.98.120.65:8790')
  assert.equal(resolvePlatformWecomApiBase('http://100.64.0.1:1'), 'http://100.64.0.1:1')
  assert.equal(resolvePlatformWecomApiBase('http://100.127.255.254:8790'), 'http://100.127.255.254:8790')
})

test('every other base fails closed with the fixed error code', () => {
  const rejected = [
    'http://qyapi.weixin.qq.com',
    'https://qyapi.weixin.qq.com:8443',
    'https://qyapi.weixin.qq.com/cgi-bin',
    'https://qyapi.weixin.qq.com?x=1',
    'https://qyapi.weixin.qq.com.evil.example',
    'https://evil.example',
    'https://user:pw@qyapi.weixin.qq.com',
    'http://100.98.120.65',
    'http://100.98.120.65:80',
    'http://100.98.120.65:8790/path',
    'http://100.98.120.65:8790/?a=1',
    'http://100.98.120.65:8790?',
    'http://100.98.120.65:8790#x',
    'http://user:pw@100.98.120.65:8790',
    'https://100.98.120.65:8790',
    'http://100.63.255.255:8790',
    'http://100.128.0.1:8790',
    'http://10.0.0.1:8790',
    'http://127.0.0.1:8790',
    'http://localhost:8790',
    'http://8.130.81.31:8790',
    'http://100.98.120.65.evil.example:8790',
    'ftp://100.98.120.65:8790',
    'not a url'
  ]
  for (const value of rejected) {
    assert.throws(
      () => resolvePlatformWecomApiBase(value),
      (error: unknown) => error instanceof WecomApiBaseError && error.code === WECOM_API_BASE_INVALID_CODE,
      value
    )
  }
})

test('API URLs are built on the configured base and keep the official path', () => {
  assert.equal(buildPlatformWecomApiUrl('https://qyapi.weixin.qq.com', '/cgi-bin/gettoken').href, 'https://qyapi.weixin.qq.com/cgi-bin/gettoken')
  assert.equal(buildPlatformWecomApiUrl('http://100.98.120.65:8790', '/cgi-bin/auth/getuserinfo').href, 'http://100.98.120.65:8790/cgi-bin/auth/getuserinfo')
  assert.equal(buildPlatformWecomApiUrl('http://100.98.120.65:8790', '/cgi-bin/user/get').href, 'http://100.98.120.65:8790/cgi-bin/user/get')
})

test('Platform WeCom server calls all use the configured base; OAuth authorize URL is unchanged', async () => {
  const auth = await readFile(new URL('../server/utils/wecomPlatformAuth.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(auth, /qyapi\.weixin\.qq\.com/)
  assert.equal((auth.match(/buildPlatformWecomApiUrl\(config\.apiBase, WECOM_[A-Z_]+_PATH\)/g) || []).length, 3)
  assert.doesNotMatch(auth, /new URL\(/)
  assert.match(auth, /NUXT_AUTH_WECOM_API_BASE/)
  const start = await readFile(new URL('../server/api/platform/auth/wecom/start.get.ts', import.meta.url), 'utf8')
  assert.match(start, /open\.weixin\.qq\.com/)
  assert.doesNotMatch(start, /apiBase/)
  const nuxtConfig = await readFile(new URL('../nuxt.config.ts', import.meta.url), 'utf8')
  assert.match(nuxtConfig, /wecomApiBase: process\.env\.WECOM_API_BASE \|\| ''/)
})
