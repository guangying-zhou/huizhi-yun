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
    assert.match(profile, /<DirectorySelfProfileDetails/)
    assert.match(profile, /realName: profileRealName/)
    const details = source('../foundation/app/components/DirectorySelfProfileDetails.vue')
    assert.match(details, /props\.profile\.realName \|\| props\.profile\.displayName/)
    assert.match(details, /\{\{ value \|\| '—' \}\}/)
  })
})
