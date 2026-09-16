import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Console profile directory data', () => {
  test('mutable profile fields prefer the live Console Directory session profile over OIDC claims', () => {
    const profile = source('app/pages/profile.vue')

    assert.match(profile, /useFetch<ApiResponse<CurrentDirectoryProfile>>\(\s*'\/api\/directory\/me'/)
    assert.match(profile, /currentDirectoryProfile\.value\?\.realName[\s\S]*currentDirectoryProfile\.value\?\.displayName[\s\S]*userRealname\.value/)
    assert.match(profile, /currentDirectoryProfile\.value\?\.email \|\| userEmail\.value/)
    assert.match(profile, /currentDirectoryProfile\.value\?\.deptName \|\| userDepartment\.value/)
    assert.match(profile, /currentDirectoryProfile\.value\?\.deptCode \|\| userDeptCode\.value/)
    assert.match(profile, /\{\{ profileRealName \|\| '-' \}\}/)
  })

  test('workspace greeting uses the live real name and the browser-local time period', () => {
    const workspace = source('app/pages/index.vue')

    assert.match(workspace, /useFetch<ApiResponse<CurrentDirectoryProfile>>\(\s*'\/api\/directory\/me'/)
    assert.match(workspace, /currentDirectoryProfile\.value\?\.realName[\s\S]*currentDirectoryProfile\.value\?\.displayName[\s\S]*userRealname\.value/)
    assert.match(workspace, /const hour = new Date\(\)\.getHours\(\)/)
    assert.match(workspace, /hour >= 5 && hour < 12[\s\S]*'早上好'[\s\S]*hour >= 12 && hour < 18[\s\S]*'下午好'[\s\S]*'晚上好'/)
    assert.match(workspace, /onMounted\(\(\) => \{\s*updateGreeting\(\)/)
    assert.match(workspace, /\{\{ greeting \}\}，\{\{ workspaceRealName \}\}/)
  })
})
