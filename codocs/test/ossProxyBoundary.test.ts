import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

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

describe('Codocs OSS proxy boundary', () => {
  test('avatar proxy normalizes query path before reading OSS', () => {
    const content = source('server/api/oss/avatar.ts')

    assert.match(content, /function normalizeAvatarObjectPath/)
    assert.match(content, /rawPath\.startsWith\('\/'\)/)
    assert.match(content, /rawPath\.includes\('\\\\'\)/)
    assert.match(content, /segment === '\.\.'/)
    assert.match(content, /AVATAR_SEGMENT_PATTERN\.test\(segment\)/)
    assert.match(content, /ALLOWED_AVATAR_EXTENSIONS\.has\(extension\)/)
    assert.match(content, /const normalizedAvatarPath = normalizeAvatarObjectPath\(query\.path\)/)
    assert.match(content, /const objectPath = `avatars\/\$\{normalizedAvatarPath\}`/)
    assert.match(content, /contentType\.toLowerCase\(\)\.startsWith\('image\/'\)/)
    assert.match(content, /X-Content-Type-Options/)
    assertBefore(content, 'normalizeAvatarObjectPath(query.path)', 'await client.get(objectPath)')
  })

  test('image proxy normalizes image object path before downloading', () => {
    const content = source('server/api/oss/image.ts')
    const helper = source('server/utils/ossImagePath.ts')

    assert.match(content, /import \{ normalizeImageObjectPath \} from '..\/..\/utils\/ossImagePath'/)
    assert.match(content, /const imagePath = normalizeImageObjectPath\(query\.path\)/)
    assert.match(content, /downloadImageBuffer\(imagePath,\s*\{ event \}\)/)
    assert.match(content, /getImageContentTypeForPath\(imagePath\)/)
    assert.match(content, /X-Content-Type-Options/)
    assert.match(helper, /export function normalizeImageObjectPath/)
    assert.match(helper, /rawPath\.startsWith\('\/'\)/)
    assert.match(helper, /rawPath\.includes\('\\\\'\)/)
    assert.match(helper, /segment === '\.\.'/)
    assert.match(helper, /IMAGE_SEGMENT_PATTERN\.test\(segment\)/)
    assert.match(helper, /ALLOWED_IMAGE_EXTENSIONS\.has\(extension\)/)
    assert.match(helper, /export function normalizeCodocsUserImageObjectPath/)
    assert.match(helper, /USER_IMAGE_PATH_PATTERN\.test\(path\)/)
    assertBefore(content, 'normalizeImageObjectPath(query.path)', 'downloadImageBuffer(imagePath, { event })')
  })

  test('request-scoped OSS clients refresh integration configuration before use', () => {
    const content = source('server/utils/oss.ts')

    assert.match(content, /await loadCodocsOssRuntimeConfigFromConsole\(runtimeIntegrationCode\(\), options\.event\)/)
    assert.match(content, /options\.event\s*\?\s*await createRuntimeImagesOSSClient\(options\)/)
    assertBefore(
      content,
      'await loadCodocsOssRuntimeConfigFromConsole(runtimeIntegrationCode(), options.event)',
      'return factory(clientOptions)'
    )
  })

  test('admin image preview and deletion normalize Codocs user image paths before OSS access', () => {
    const preview = source('server/api/admin/images/preview.get.ts')
    const deleteRoute = source('server/api/admin/images.delete.ts')

    assert.match(preview, /requirePermission\(event,\s*'admin',\s*'admin'/)
    assert.match(preview, /normalizeCodocsUserImageObjectPath\(getQuery\(event\)\.path\)/)
    assert.match(preview, /downloadImageBuffer\(path\)/)
    assertBefore(preview, 'requirePermission(event, \'admin\', \'admin\'', 'normalizeCodocsUserImageObjectPath(getQuery(event).path)')
    assertBefore(preview, 'normalizeCodocsUserImageObjectPath(getQuery(event).path)', 'downloadImageBuffer(path)')

    assert.match(deleteRoute, /requirePermission\(event,\s*'admin',\s*'admin'/)
    assert.match(deleteRoute, /const normalizedPaths = paths\.map\(path => normalizeCodocsUserImageObjectPath\(path\)\)/)
    assert.match(deleteRoute, /getImageMetadata\(path\)/)
    assert.match(deleteRoute, /deleteImage\(normalizedPaths\[0\]!\)/)
    assert.match(deleteRoute, /deleteImages\(normalizedPaths\)/)
    assert.doesNotMatch(deleteRoute, /path\.startsWith\('codocs\/users\/'\)/)
    assert.doesNotMatch(deleteRoute, /path\.includes\('\/images\/'\)/)
    assertBefore(deleteRoute, 'const normalizedPaths = paths.map(path => normalizeCodocsUserImageObjectPath(path))', 'getImageMetadata(path)')
    assertBefore(deleteRoute, 'const normalizedPaths = paths.map(path => normalizeCodocsUserImageObjectPath(path))', 'deleteImage(normalizedPaths[0]!)')
  })
})
