import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  buildProfileAvatarPath,
  PROFILE_AVATAR_MAX_BYTES,
  validateProfileAvatar
} from '../server/utils/profileAvatar.ts'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)
  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

describe('Console self-service profile avatar', () => {
  test('validates supported image signatures and creates a tenant-isolated immutable path', () => {
    const png = Buffer.from('89504e470d0a1a0a00000000', 'hex')
    const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex')
    const webp = Buffer.from('524946460400000057454250', 'hex')

    assert.deepEqual(validateProfileAvatar('image/png', png), { contentType: 'image/png', extension: 'png' })
    assert.deepEqual(validateProfileAvatar('image/jpeg', jpeg), { contentType: 'image/jpeg', extension: 'jpg' })
    assert.deepEqual(validateProfileAvatar('image/webp', webp), { contentType: 'image/webp', extension: 'webp' })

    const path = buildProfileAvatarPath('C000001', 'zhou/guangying', 'png', png)
    assert.match(path, /^C000001\/zhou_guangying\/[a-f0-9]{32}\.png$/)
    assert.equal(path, buildProfileAvatarPath('C000001', 'zhou/guangying', 'png', png))
  })

  test('rejects unsupported, spoofed, empty, and oversized uploads', () => {
    assert.throws(() => validateProfileAvatar('image/svg+xml', Buffer.from('<svg/>')))
    assert.throws(() => validateProfileAvatar('image/png', Buffer.from('not a png')))
    assert.throws(() => validateProfileAvatar('image/jpeg', Buffer.alloc(0)))
    assert.throws(() => validateProfileAvatar('image/webp', Buffer.alloc(PROFILE_AVATAR_MAX_BYTES + 1)))
  })

  test('authenticates before parsing multipart data and writes only the current user avatar', () => {
    const route = source('server/api/v1/console/directory/me/avatar.put.ts')
    const profile = source('app/pages/profile.vue')
    const userMenu = source('../foundation/app/components/UserMenu.vue')

    assertBefore(route, 'resolveConsoleSession(event', 'readMultipartFormData(event)')
    assertBefore(route, 'getHeader(event, \'content-length\')', 'readMultipartFormData(event)')
    assert.match(route, /allowLegacyFallback: false/)
    assert.match(route, /resolveConsoleRuntimeBinding\(event\)/)
    assert.match(route, /const objectKey = `avatars\/\$\{avatarPath\}`/)
    assert.match(route, /putConsoleOSSAvatar\(event/)
    assert.match(route, /contentBase64: avatar\.data\.toString\('base64'\)/)
    assert.match(route, /updateConsoleDirectoryOwnAvatar\(event/)
    assert.doesNotMatch(route, /ali-oss|resolveVaultSecret|accessKeySecret|resolveConsoleOssRuntimeConfig/)
    assert.doesNotMatch(route, /from ['"]~~\/server\/utils\/db['"]/)
    assert.doesNotMatch(route, /directory_users/)
    assert.doesNotMatch(route, /operation_logs/)
    assert.match(route, /shouldWriteLegacyAuthCookies\(event\)/)
    assert.match(route, /writeLegacyAuthCookies\(event, session\.sessionId/)
    assert.doesNotMatch(route, /readBody/)

    assert.match(profile, /accept="image\/png,image\/jpeg,image\/webp"/)
    assert.match(profile, /formData\.append\('avatar', file, file\.name\)/)
    assert.match(profile, /method: 'PUT'/)
    assert.match(profile, /'Idempotency-Key': crypto\.randomUUID\(\)/)
    assert.match(profile, /resolveAvatarSrc\(currentDirectoryProfile\.value\?\.avatar\)/)
    assert.match(profile, /hzy:directory-profile-updated/)
    assert.match(userMenu, /hzy:directory-profile-updated/)
  })

  test('unmigrated provider sync cannot fall back to Console SQL and overwrite avatars', () => {
    const route = source('server/api/v1/console/directory/sync-jobs/index.post.ts')
    assert.throws(() => source('server/utils/directoryProviderRunners.ts'), /ENOENT/)
    assert.match(route, /statusCode: 503/)
    assert.match(route, /尚未迁入客户侧 Runtime，已禁止回退 Console 数据库执行/)
    assert.doesNotMatch(route, /server\/utils\/db|directoryProviderRunners|directorySyncJobs/)
  })
})
