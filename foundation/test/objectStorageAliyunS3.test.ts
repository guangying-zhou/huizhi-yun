import assert from 'node:assert/strict'
import test from 'node:test'
import OSS from 'ali-oss'
import { createAliOssCompatibleClient } from '../server/utils/objectStorage'
import type { ObjectStoragePutOptions } from '../server/utils/objectStorage'

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
