import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const homepage = readFileSync(
  new URL('../app/pages/index.vue', import.meta.url),
  'utf8'
)

test('Codocs 首页欢迎信息优先显示当前用户的目录真实姓名', () => {
  assert.match(homepage, /useFetch<ApiResponse<CurrentDirectoryProfile>>\(\s*'\/api\/directory\/me'/)

  const realName = homepage.indexOf('currentDirectoryProfile.value?.realName')
  const directoryDisplayName = homepage.indexOf('currentDirectoryProfile.value?.displayName')
  const authRealName = homepage.indexOf('userRealname.value', realName)
  const uidFallback = homepage.indexOf('user.value', authRealName)

  assert.ok(realName >= 0)
  assert.ok(realName < directoryDisplayName)
  assert.ok(directoryDisplayName < authRealName)
  assert.ok(authRealName < uidFallback)
})
