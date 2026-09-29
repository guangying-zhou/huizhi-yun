import assert from 'node:assert/strict'
import test from 'node:test'
import OSS from 'ali-oss'
import { createAliOssCompatibleClient } from '../server/utils/objectStorage'
import { objectStorageVersionId } from '../server/utils/objectStorageVersion'
import type { ObjectStoragePutOptions } from '../server/utils/objectStorage'

test('write version receipt accepts either provider header and rejects ambiguity', () => {
  assert.equal(objectStorageVersionId({ 'x-oss-version-id': 'oss-v1' }), 'oss-v1')
  assert.equal(objectStorageVersionId({ 'X-Amz-Version-Id': 's3-v1' }), 's3-v1')
  assert.equal(objectStorageVersionId({ 'x-oss-version-id': 'same', 'x-amz-version-id': 'same' }), 'same')
  assert.equal(objectStorageVersionId({}), undefined)
  assert.throws(() => objectStorageVersionId({ 'x-oss-version-id': 'oss-v1', 'x-amz-version-id': 's3-v2' }), /invalid version/)
  assert.throws(() => objectStorageVersionId({ 'x-amz-version-id': 'bad\nvalue' }), /invalid version/)
})

test('Aliyun S3 compatibility normalizes the endpoint and signing region', async () => {
  const originalFetch = globalThis.fetch
  let requestUrl = ''
  let authorization = ''

  globalThis.fetch = async (input, init) => {
    requestUrl = String(input)
    authorization = new Headers(init?.headers).get('authorization') || ''
    return new Response('image-content', {
      status: 200,
      headers: { 'content-type': 'image/jpeg' }
    })
  }

  try {
    const client = createAliOssCompatibleClient({
      provider: 'aliyun-oss-s3',
      bucket: 'example-bucket',
      endpoint: 'oss-cn-qingdao.aliyuncs.com',
      region: 'oss-cn-qingdao',
      accessKeyId: 'test-access-key',
      accessKeySecret: 'test-access-secret'
    })

    await client.get('codocs/info/images/cover.jpg')

    assert.equal(
      new URL(requestUrl).host,
      'example-bucket.s3.oss-cn-qingdao.aliyuncs.com'
    )
    assert.match(
      authorization,
      /^AWS4-HMAC-SHA256 Credential=test-access-key\/\d{8}\/cn-qingdao\/s3\/aws4_request,/
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

for (const provider of ['aliyun-oss-s3', 's3']) {
  test(`${provider} signs the exact version query and rejects a different response version`, async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input))
      assert.equal(url.searchParams.get('versionId'), 'v+1/2=')
      assert.equal(init?.method, 'GET')
      assert.match(new Headers(init?.headers).get('authorization') || '', /SignedHeaders=/)
      return new Response('versioned-content', { status: 200, headers: { 'x-amz-version-id': 'v+1/2=' } })
    })
    const client = createAliOssCompatibleClient({ ...storageConfig, provider })
    const result = await client.get('docs/report.md', { versionId: 'v+1/2=' })
    assert.equal(result.content.toString(), 'versioned-content')
    assert.equal(fetchMock.mock.callCount(), 1)

    fetchMock.mock.mockImplementation(async () => new Response('latest-content', { status: 200, headers: { 'x-amz-version-id': 'latest' } }))
    await assert.rejects(client.get('docs/report.md', { versionId: 'v+1/2=' }), /different version/)
    fetchMock.mock.mockImplementation(async () => new Response('unknown-version', { status: 200 }))
    await assert.rejects(client.get('docs/report.md', { versionId: 'v+1/2=' }), /different version/)
    fetchMock.mock.mockImplementation(async () => new Response('versioned-content', { status: 200, headers: { 'x-oss-version-id': 'v+1/2=' } }))
    assert.equal((await client.get('docs/report.md', { versionId: 'v+1/2=' })).content.toString(), 'versioned-content')
    assert.equal(fetchMock.mock.callCount(), 4)
  })
}

test('native OSS exact version reads pass the version to the SDK and reject mismatched responses', async (t) => {
  const get = t.mock.method(OSS.prototype, 'get', async (_name: string, options?: Record<string, unknown>) => {
    assert.equal(options?.versionId, 'native-v1')
    return { content: Buffer.from('versioned-content'), res: { status: 200, headers: { 'x-oss-version-id': 'native-v1' } } }
  })
  const client = createAliOssCompatibleClient({ ...storageConfig, provider: 'aliyun-oss-native' })
  assert.equal((await client.get('docs/report.md', { versionId: 'native-v1' })).content.toString(), 'versioned-content')
  assert.equal(get.mock.callCount(), 1)
  get.mock.mockImplementation(async () => ({ content: Buffer.from('latest'), res: { status: 200, headers: {} } }))
  await assert.rejects(client.get('docs/report.md', { versionId: 'native-v1' }), /different version/)
})

test('invalid object version is rejected before storage access', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('unexpected'))
  const client = createAliOssCompatibleClient({ ...storageConfig, provider: 's3' })
  for (const versionId of ['', ' v1 ', 'v1\n', 123]) {
    await assert.rejects(client.get('docs/report.md', { versionId }), /Invalid object storage version ID/)
  }
  assert.equal(fetchMock.mock.callCount(), 0)
})

test('legacy null object version remains readable without implying immutable v2 storage', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    assert.equal(new URL(String(input)).searchParams.get('versionId'), 'null')
    return new Response('legacy', { status: 200, headers: { 'x-amz-version-id': 'null' } })
  })
  const client = createAliOssCompatibleClient({ ...storageConfig, provider: 's3' })
  assert.equal((await client.get('docs/legacy.md', { versionId: 'null' })).content.toString(), 'legacy')
  assert.equal(fetchMock.mock.callCount(), 1)
})

test('Aliyun S3 signed URLs use the S3-compatible endpoint and AWS V4 query', async () => {
  const client = createAliOssCompatibleClient({
    provider: 'aliyun-oss-s3',
    bucket: 'example-bucket',
    endpoint: 'https://s3.oss-cn-qingdao.aliyuncs.com',
    region: 'cn-qingdao',
    accessKeyId: 'test-access-key',
    accessKeySecret: 'test-access-secret'
  })

  const signedUrl = new URL(await client.createSignedGetUrl('docs/report.md'))

  assert.equal(signedUrl.host, 'example-bucket.s3.oss-cn-qingdao.aliyuncs.com')
  assert.equal(signedUrl.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256')
  assert.match(
    signedUrl.searchParams.get('X-Amz-Credential') || '',
    /^test-access-key\/\d{8}\/cn-qingdao\/s3\/aws4_request$/
  )
  assert.equal(signedUrl.searchParams.has('x-oss-signature-version'), false)
})

const storageConfig = {
  bucket: 'example-bucket',
  endpoint: 'oss-cn-qingdao.aliyuncs.com',
  region: 'oss-cn-qingdao',
  accessKeyId: 'test-access-key',
  accessKeySecret: 'test-access-secret'
}

for (const provider of ['aliyun-oss-s3', 'oss-s3', 's3', 'cloudflare-r2']) {
  test(`${provider} signs only its supported create-only condition`, async (t) => {
    const isOss = provider.includes('oss')
    const condition = isOss ? 'x-oss-forbid-overwrite' : 'if-none-match'
    const unsupported = isOss ? 'if-none-match' : 'x-oss-forbid-overwrite'
    const upload = t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      assert.equal(init?.method, 'PUT')
      assert.equal(headers.get(condition), isOss ? 'true' : '*')
      assert.equal(headers.has(unsupported), false)
      assert.equal(headers.get('content-type'), 'text/markdown')
      assert.equal(headers.get('x-amz-meta-operation'), 'op-1')
      assert.ok(headers.get('authorization')?.includes(condition))
      return new Response('', { status: 200 })
    })
    const options = {
      forbidOverwrite: true,
      headers: { 'If-None-Match': 'old-etag', 'X-Oss-Forbid-Overwrite': 'false', 'content-type': 'text/markdown' },
      meta: { operation: 'op-1' }
    }
    const client = createAliOssCompatibleClient({ ...storageConfig, provider })
    await client.put('docs/report.md', Buffer.from('report'), options)
    assert.equal(upload.mock.callCount(), 1)
    assert.equal(options.headers['If-None-Match'], 'old-etag')
    assert.equal(options.headers['X-Oss-Forbid-Overwrite'], 'false')
  })
}

test('native OSS create-only writes use the OSS condition without leaking adapter options', async (t) => {
  const upload = t.mock.method(OSS.prototype, 'put', async (_name: string, _content: unknown, options: ObjectStoragePutOptions) => {
    assert.equal(options.headers?.['x-oss-forbid-overwrite'], 'true')
    assert.equal(options.headers?.['if-none-match'], undefined)
    assert.equal(options.forbidOverwrite, undefined)
    assert.deepEqual(options.meta, { operation: 'op-1' })
    return { res: { status: 200, headers: {} } }
  })
  const client = createAliOssCompatibleClient({ ...storageConfig, provider: 'aliyun-oss-native' })
  await client.put('docs/report.md', Buffer.from('report'), {
    forbidOverwrite: true,
    headers: { 'if-none-match': '*' },
    meta: { operation: 'op-1' }
  })
  assert.equal(upload.mock.callCount(), 1)
})

test('ordinary uploads do not acquire create-only conditions', async (t) => {
  const upload = t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    assert.equal(headers.has('if-none-match'), false)
    assert.equal(headers.has('x-oss-forbid-overwrite'), false)
    return new Response('', { status: 200 })
  })
  const client = createAliOssCompatibleClient({ ...storageConfig, provider: 's3' })
  await client.put('docs/report.md', Buffer.from('report'))
  assert.equal(upload.mock.callCount(), 1)
})

test('write-once snapshot namespace refuses delete, overwrite and in-place rewrites before any request', async () => {
  const originalFetch = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = async (input, init) => {
    requests.push(`${init?.method || 'GET'} ${new URL(String(input)).pathname}`)
    return new Response('', { status: 200, headers: { 'x-oss-version-id': 'v1' } })
  }
  try {
    const client = createAliOssCompatibleClient({
      provider: 'aliyun-oss-s3', bucket: 'example-bucket', endpoint: 'oss-cn-qingdao.aliyuncs.com',
      region: 'oss-cn-qingdao', accessKeyId: 'test-access-key', accessKeySecret: 'test-access-secret'
    })
    const snapshot = 'codocs/snapshots/h/uuid/k/body.md'
    for (const [label, attempt] of [
      ['delete', () => client.delete(snapshot)],
      ['delete with leading slash', () => client.delete(`/${snapshot}`)],
      ['batch delete', () => client.deleteMulti(['codocs/users/a.md', snapshot])],
      ['overwrite put', () => client.put(snapshot, Buffer.from('x'))],
      ['copy onto snapshot', () => client.copy(snapshot, 'codocs/users/a.md')],
      ['metadata rewrite', () => client.putMeta(snapshot, { a: '1' })]
    ] as const) {
      await assert.rejects(attempt(), (error: { statusCode?: number, code?: string }) =>
        error.statusCode === 409 && error.code === 'WriteOnceObjectNamespace', label)
    }
    assert.deepEqual(requests, [], 'refused operations must not reach storage')

    // Create-only writes into the namespace, reads, and ordinary keys still work.
    await client.put(snapshot, Buffer.from('x'), { forbidOverwrite: true })
    await client.copy('codocs/users/restored.md', snapshot)
    await client.delete('codocs/users/a.md')
    assert.equal(requests.length, 3)
  } finally {
    globalThis.fetch = originalFetch
  }
})
