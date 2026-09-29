import OSS from 'ali-oss'
import { Buffer } from 'node:buffer'
import { objectStorageVersionId } from './objectStorageVersion'

export type ObjectStorageProvider = 'aliyun-oss-native' | 'aliyun-oss-s3' | 's3'

export type ObjectStorageConfig = {
  provider?: string
  bucket: string
  endpoint: string
  accessKeyId: string
  accessKeySecret: string
  region?: string
  bucketDomain?: string
  timeout?: number
  forcePathStyle?: boolean | string
}

export type ObjectStoragePutOptions = {
  headers?: Record<string, string>
  meta?: Record<string, string | number>
  mime?: string
  /** Use the provider's create-only condition. OSS requires bucket versioning to be disabled. */
  forbidOverwrite?: boolean
}

export type ObjectStorageSignedUrlOptions = {
  expires?: number
  response?: Record<string, string>
}

export type ObjectStorageListV2Result = {
  prefixes?: string[]
  objects?: Array<{
    name: string
    size: number
    lastModified: string
    etag?: string
  }>
  isTruncated: boolean
  nextContinuationToken?: string
}

export type AliOssCompatibleClient = {
  get: (name: string, options?: Record<string, unknown>) => Promise<{
    content: Buffer
    res: { status: number, headers: Record<string, string> }
  }>
  put: (
    name: string,
    content: BodyInit | Buffer | ArrayBuffer | Uint8Array | string | null,
    options?: ObjectStoragePutOptions
  ) => Promise<{
    name: string
    url?: string
    res: { status: number, headers: Record<string, string> }
  }>
  head: (name: string) => Promise<{
    meta?: Record<string, string>
    res: { status: number, headers: Record<string, string> }
  }>
  copy: (targetName: string, sourceName: string) => Promise<unknown>
  putMeta: (name: string, meta: Record<string, string | number>, options?: Record<string, unknown>) => Promise<unknown>
  delete: (name: string) => Promise<unknown>
  deleteMulti: (names: string[]) => Promise<void>
  list: (params: Record<string, unknown>, options?: Record<string, unknown>) => Promise<ObjectStorageListV2Result & {
    nextMarker?: string
  }>
  listV2: (params: Record<string, unknown>) => Promise<ObjectStorageListV2Result>
  signatureUrl: (name: string, options?: ObjectStorageSignedUrlOptions) => string
  createSignedGetUrl: (name: string, options?: ObjectStorageSignedUrlOptions) => Promise<string>
}

type NativeAliOssClient = {
  get: AliOssCompatibleClient['get']
  put: AliOssCompatibleClient['put']
  head: AliOssCompatibleClient['head']
  copy: AliOssCompatibleClient['copy']
  putMeta?: AliOssCompatibleClient['putMeta']
  delete: AliOssCompatibleClient['delete']
  deleteMulti?: AliOssCompatibleClient['deleteMulti']
  list?: AliOssCompatibleClient['list']
  listV2: AliOssCompatibleClient['listV2']
  signatureUrl: AliOssCompatibleClient['signatureUrl']
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function boolValue(value: unknown) {
  if (typeof value === 'boolean') return value
  return ['1', 'true', 'yes', 'on'].includes(stringValue(value).toLowerCase())
}

function positiveNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function normalizeProvider(value: unknown): ObjectStorageProvider {
  const provider = stringValue(value || process.env.HZY_OBJECT_STORAGE_PROVIDER || process.env.OSS_PROVIDER)
    .toLowerCase()

  if (provider === 'aliyun-oss-s3' || provider === 'oss-s3') return 'aliyun-oss-s3'
  if (provider === 's3' || provider === 'cloudflare-r2' || provider === 'r2') return 's3'
  return 'aliyun-oss-native'
}

function putHeaders(provider: ObjectStorageProvider, options: ObjectStoragePutOptions) {
  const headers = Object.fromEntries(
    Object.entries(options.headers || {}).filter(([key]) =>
      !options.forbidOverwrite || !['if-none-match', 'x-oss-forbid-overwrite'].includes(key.toLowerCase())
    )
  )
  if (options.forbidOverwrite) {
    // OSS's S3-compatible endpoint still requires the OSS-specific condition.
    // Do not send S3-only preconditions to OSS.
    if (provider === 's3') headers['if-none-match'] = '*'
    else headers['x-oss-forbid-overwrite'] = 'true'
  }
  return headers
}

function assertStorageConfig(config: ObjectStorageConfig) {
  if (!stringValue(config.bucket) || !stringValue(config.endpoint)) {
    throw new Error('Object storage bucket or endpoint is not configured')
  }
  if (!stringValue(config.accessKeyId) || !stringValue(config.accessKeySecret)) {
    throw new Error('Object storage credentials are not configured')
  }
}

function normalizeEndpoint(endpoint: string) {
  return /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`
}

function normalizeAliyunS3Endpoint(endpoint: string) {
  const url = new URL(normalizeEndpoint(endpoint))
  if (!url.hostname.startsWith('s3.')) {
    url.hostname = `s3.${url.hostname}`
  }
  return url.toString().replace(/\/$/, '')
}

function encodePathSegment(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function encodeObjectKey(key: string) {
  return key.split('/').map(encodePathSegment).join('/')
}

function headersToRecord(headers: Headers) {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value
  })
  return result
}

function metadataFromHeaders(headers: Record<string, string>) {
  const meta: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (key.startsWith('x-amz-meta-')) {
      meta[key.slice('x-amz-meta-'.length)] = value
    } else if (key.startsWith('x-oss-meta-')) {
      meta[key.slice('x-oss-meta-'.length)] = value
    }
  }
  return meta
}

function requestedObjectVersion(options?: Record<string, unknown>) {
  if (!options || !Object.prototype.hasOwnProperty.call(options, 'versionId')) return null
  const version = options.versionId
  // Control characters are rejected on purpose: the version goes into a query.
  // eslint-disable-next-line no-control-regex
  if (typeof version !== 'string' || !version || version.trim() !== version || version.length > 255 || /[\x00-\x1f\x7f]/.test(version)) {
    throw new Error('Invalid object storage version ID')
  }
  return version
}

function assertObjectVersion(headers: Record<string, string>, requested: string) {
  if (objectStorageVersionId(headers) !== requested) {
    throw new Error('Object storage returned a different version')
  }
}

function objectUrl(config: ObjectStorageConfig, key: string, params?: URLSearchParams) {
  const endpoint = new URL(normalizeEndpoint(config.endpoint))
  const forcePathStyle = boolValue(config.forcePathStyle)
  const endpointHost = endpoint.host
  const bucketPrefix = `${config.bucket}.`
  const host = forcePathStyle || endpoint.hostname.startsWith(bucketPrefix)
    ? endpointHost
    : `${config.bucket}.${endpointHost}`
  const path = forcePathStyle
    ? `/${encodePathSegment(config.bucket)}/${encodeObjectKey(key)}`
    : `/${encodeObjectKey(key)}`
  const url = new URL(`${endpoint.protocol}//${host}${path}`)
  if (params) {
    params.forEach((value, name) => url.searchParams.append(name, value))
  }
  return url
}

function responseParamName(name: string) {
  return name.startsWith('response-') ? name : `response-${name.toLowerCase()}`
}

function rfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function canonicalQuery(params: URLSearchParams) {
  return Array.from(params.entries())
    .map(([key, value]) => [rfc3986(key), rfc3986(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) return leftValue.localeCompare(rightValue)
      return leftKey.localeCompare(rightKey)
    })
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
}

function canonicalHeaders(headers: Headers) {
  const entries = Array.from(headers.entries())
    .map(([key, value]) => [key.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const)
    .sort(([left], [right]) => left.localeCompare(right))

  return {
    canonical: entries.map(([key, value]) => `${key}:${value}\n`).join(''),
    signedHeaders: entries.map(([key]) => key).join(';')
  }
}

async function sha256Hex(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Buffer.from(hash).toString('hex')
}

async function hmac(key: string | ArrayBuffer | Uint8Array, value: string) {
  const encoder = new TextEncoder()
  const rawKey = typeof key === 'string'
    ? encoder.encode(key).buffer
    : key instanceof ArrayBuffer
      ? key
      : key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value))
}

async function signingKey(secret: string, date: string, region: string) {
  const kDate = await hmac(`AWS4${secret}`, date)
  const kRegion = await hmac(kDate, region)
  const kService = await hmac(kRegion, 's3')
  return await hmac(kService, 'aws4_request')
}

function amzTimestamp(now = new Date()) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function amzDate(timestamp: string) {
  return timestamp.slice(0, 8)
}

function regionFor(config: ObjectStorageConfig) {
  return stringValue(config.region) || 'auto'
}

function aliyunOssRegionFor(config: ObjectStorageConfig) {
  const configured = stringValue(config.region)
  if (configured.startsWith('oss-')) return configured.slice('oss-'.length)
  if (configured) return configured

  const endpoint = stringValue(config.endpoint)
  const match = endpoint.match(/(?:^|\/\/)oss-([a-z0-9-]+)\./i)
  return match?.[1] || 'cn-hangzhou'
}

async function signS3Request(input: {
  config: ObjectStorageConfig
  method: string
  url: URL
  headers: Headers
  payloadHash?: string
  now?: Date
}) {
  const timestamp = amzTimestamp(input.now)
  const date = amzDate(timestamp)
  const region = regionFor(input.config)
  const payloadHash = input.payloadHash || 'UNSIGNED-PAYLOAD'
  input.headers.set('host', input.url.host)
  input.headers.set('x-amz-content-sha256', payloadHash)
  input.headers.set('x-amz-date', timestamp)

  const canonical = canonicalHeaders(input.headers)
  const canonicalRequest = [
    input.method.toUpperCase(),
    input.url.pathname,
    canonicalQuery(input.url.searchParams),
    canonical.canonical,
    canonical.signedHeaders,
    payloadHash
  ].join('\n')
  const scope = `${date}/${region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    timestamp,
    scope,
    await sha256Hex(canonicalRequest)
  ].join('\n')
  const signature = Buffer.from(await hmac(await signingKey(input.config.accessKeySecret, date, region), stringToSign)).toString('hex')

  input.headers.set(
    'authorization',
    `AWS4-HMAC-SHA256 Credential=${input.config.accessKeyId}/${scope}, SignedHeaders=${canonical.signedHeaders}, Signature=${signature}`
  )
}

async function createS3SignedGetUrl(
  config: ObjectStorageConfig,
  name: string,
  options: ObjectStorageSignedUrlOptions = {}
) {
  const timestamp = amzTimestamp()
  const date = amzDate(timestamp)
  const region = regionFor(config)
  const expires = String(Math.max(1, Number(options.expires || 3600)))
  const url = objectUrl(config, name)
  const scope = `${date}/${region}/s3/aws4_request`
  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
  url.searchParams.set('X-Amz-Credential', `${config.accessKeyId}/${scope}`)
  url.searchParams.set('X-Amz-Date', timestamp)
  url.searchParams.set('X-Amz-Expires', expires)
  url.searchParams.set('X-Amz-SignedHeaders', 'host')

  for (const [key, value] of Object.entries(options.response || {})) {
    url.searchParams.set(responseParamName(key), value)
  }

  const canonicalRequest = [
    'GET',
    url.pathname,
    canonicalQuery(url.searchParams),
    `host:${url.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD'
  ].join('\n')
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    timestamp,
    scope,
    await sha256Hex(canonicalRequest)
  ].join('\n')
  const signature = Buffer.from(await hmac(await signingKey(config.accessKeySecret, date, region), stringToSign)).toString('hex')
  url.searchParams.set('X-Amz-Signature', signature)
  return url.toString()
}

async function assertOk(response: Response, name: string) {
  if (response.ok) return

  const message = await response.text().catch(() => '')
  const error = new Error(`Object storage request failed for ${name}: ${response.status} ${message}`) as Error & {
    code?: string
    status?: number
    statusCode?: number
  }
  error.status = response.status
  error.statusCode = response.status
  error.code = response.status === 404 ? 'NoSuchKey' : 'ObjectStorageError'
  throw error
}

function objectUrlString(config: ObjectStorageConfig, name: string) {
  if (config.bucketDomain) {
    return `https://${config.bucketDomain.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}/${encodeObjectKey(name)}`
  }
  return objectUrl(config, name).toString()
}

function normalizeBody(content: BodyInit | Buffer | ArrayBuffer | Uint8Array | string | null) {
  if (content === null) return null
  if (typeof content === 'string') return content
  if (content instanceof ArrayBuffer) return content
  if (ArrayBuffer.isView(content)) return content
  return content as BodyInit
}

function xmlDecode(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&')
}

function xmlText(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
  return match ? xmlDecode(match[1] || '') : ''
}

function xmlBlocks(xml: string, tag: string) {
  return Array.from(xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'g'))).map(match => match[1] || '')
}

function parseListV2Xml(xml: string): ObjectStorageListV2Result {
  const objects = xmlBlocks(xml, 'Contents').map(block => ({
    name: xmlText(block, 'Key'),
    size: Number(xmlText(block, 'Size') || 0),
    lastModified: xmlText(block, 'LastModified'),
    etag: xmlText(block, 'ETag').replace(/^"|"$/g, '')
  })).filter(item => item.name)

  const prefixes = xmlBlocks(xml, 'CommonPrefixes')
    .map(block => xmlText(block, 'Prefix'))
    .filter(Boolean)

  return {
    prefixes,
    objects,
    isTruncated: xmlText(xml, 'IsTruncated') === 'true',
    nextContinuationToken: xmlText(xml, 'NextContinuationToken') || undefined
  }
}

function createNativeAliOssCompatibleClient(config: ObjectStorageConfig): AliOssCompatibleClient {
  const native = new OSS({
    bucket: config.bucket,
    endpoint: config.endpoint,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    region: config.region,
    timeout: config.timeout
  }) as unknown as NativeAliOssClient

  return {
    get: async (name, options) => {
      const version = requestedObjectVersion(options)
      const result = await native.get(name, options)
      if (version) assertObjectVersion(result.res.headers, version)
      return result
    },
    put: (name, content, options = {}) => {
      const { forbidOverwrite: _forbidOverwrite, ...nativeOptions } = options
      return native.put(name, content, { ...nativeOptions, headers: putHeaders('aliyun-oss-native', options) })
    },
    head: name => native.head(name),
    copy: (targetName, sourceName) => native.copy(targetName, sourceName),
    putMeta: async (name, meta, options) => {
      if (native.putMeta) {
        return await native.putMeta(name, meta, options)
      }
      const current = await native.get(name)
      return await native.put(name, current.content, {
        headers: current.res?.headers || {},
        meta
      })
    },
    delete: name => native.delete(name),
    deleteMulti: async (names) => {
      if (native.deleteMulti) {
        await native.deleteMulti(names)
        return
      }
      await Promise.all(names.map(name => native.delete(name)))
    },
    list: (params, options) => {
      if (native.list) return native.list(params, options)
      return native.listV2(params)
    },
    listV2: params => native.listV2(params),
    signatureUrl: (name, options) => native.signatureUrl(name, options),
    createSignedGetUrl: async (name, options) => native.signatureUrl(name, options)
  }
}

function createS3CompatibleClient(config: ObjectStorageConfig): AliOssCompatibleClient {
  const request = async (
    method: string,
    name: string,
    options: {
      query?: URLSearchParams
      headers?: Headers
      body?: BodyInit | Buffer | ArrayBuffer | Uint8Array | string | null
    } = {}
  ) => {
    const url = objectUrl(config, name, options.query)
    const headers = options.headers || new Headers()
    await signS3Request({
      config,
      method,
      url,
      headers
    })
    const body = normalizeBody(options.body || null) as BodyInit | null
    const timeoutMs = positiveNumber(config.timeout)
    const controller = timeoutMs > 0 ? new AbortController() : null
    const timeout = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller?.signal
      })
      await assertOk(response, name)
      return response
    } catch (error: unknown) {
      if (controller?.signal.aborted) {
        throw new Error(`Object storage request timed out after ${timeoutMs}ms: ${method} ${name}`)
      }
      throw error
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  return {
    async get(name, options) {
      const version = requestedObjectVersion(options)
      const query = version ? new URLSearchParams({ versionId: version }) : undefined
      const response = await request('GET', name, { query })
      const headers = headersToRecord(response.headers)
      if (version) assertObjectVersion(headers, version)
      return {
        content: Buffer.from(await response.arrayBuffer()),
        res: {
          status: response.status,
          headers
        }
      }
    },

    async put(name, content, options = {}) {
      const headers = new Headers(putHeaders(normalizeProvider(config.provider), options))
      if (options.mime && !headers.has('content-type')) {
        headers.set('content-type', options.mime)
      }
      for (const [key, value] of Object.entries(options.meta || {})) {
        headers.set(`x-amz-meta-${key}`, String(value))
      }
      const response = await request('PUT', name, {
        headers,
        body: content
      })
      return {
        name,
        url: objectUrlString(config, name),
        res: {
          status: response.status,
          headers: headersToRecord(response.headers)
        }
      }
    },

    async head(name) {
      const response = await request('HEAD', name)
      const headers = headersToRecord(response.headers)
      return {
        meta: metadataFromHeaders(headers),
        res: {
          status: response.status,
          headers
        }
      }
    },

    async copy(targetName, sourceName) {
      const headers = new Headers({
        'x-amz-copy-source': `/${encodePathSegment(config.bucket)}/${encodeObjectKey(sourceName)}`
      })
      const response = await request('PUT', targetName, { headers })
      return {
        res: {
          status: response.status,
          headers: headersToRecord(response.headers)
        }
      }
    },

    async putMeta(name, meta) {
      const headResponse = await request('HEAD', name)
      const currentHeaders = headersToRecord(headResponse.headers)
      const headers = new Headers({
        'x-amz-copy-source': `/${encodePathSegment(config.bucket)}/${encodeObjectKey(name)}`,
        'x-amz-metadata-directive': 'REPLACE'
      })
      const contentType = currentHeaders['content-type']
      if (contentType) {
        headers.set('content-type', contentType)
      }
      for (const [key, value] of Object.entries(meta || {})) {
        headers.set(`x-amz-meta-${key}`, String(value))
      }
      const response = await request('PUT', name, { headers })
      return {
        res: {
          status: response.status,
          headers: headersToRecord(response.headers)
        }
      }
    },

    async delete(name) {
      const response = await request('DELETE', name)
      return {
        res: {
          status: response.status,
          headers: headersToRecord(response.headers)
        }
      }
    },

    async deleteMulti(names) {
      await Promise.all(names.map(name => this.delete(name)))
    },

    async list(params) {
      const result = await this.listV2({
        ...params,
        'continuation-token': params['continuation-token'] || params.marker
      })
      return {
        ...result,
        nextMarker: result.nextContinuationToken
      }
    },

    async listV2(params) {
      const query = new URLSearchParams()
      query.set('list-type', '2')
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue
        const normalizedKey = key === 'continuation-token' ? 'continuation-token' : key
        query.set(normalizedKey, String(value))
      }
      const response = await request('GET', '', { query })
      return parseListV2Xml(await response.text())
    },

    signatureUrl(name, options) {
      if (normalizeProvider(config.provider) === 'aliyun-oss-native') {
        return createNativeAliOssCompatibleClient(config).signatureUrl(name, options)
      }
      throw new Error('S3-compatible object storage signed URLs are async; use createSignedGetUrl instead')
    },

    createSignedGetUrl(name, options) {
      return createS3SignedGetUrl(config, name, options)
    }
  }
}

// Write-once namespaces: objects here are referenced by exact provider
// version (Codocs v2 snapshots). The bucket expires noncurrent versions, so a
// delete (delete marker), overwrite or in-place metadata rewrite would make a
// referenced version disappear. Only create-only puts are allowed; retiring
// these objects needs a dedicated, reference-checked path.
export const WRITE_ONCE_OBJECT_PREFIXES = ['codocs/snapshots/'] as const

export function isWriteOnceObjectKey(name: string) {
  const key = String(name || '').replace(/^\/+/, '')
  return WRITE_ONCE_OBJECT_PREFIXES.some(prefix => key.startsWith(prefix))
}

function writeOnceViolation(action: string) {
  const error = new Error(`Object ${action} is not allowed in a write-once namespace`) as Error & { statusCode?: number, code?: string }
  error.statusCode = 409
  error.code = 'WriteOnceObjectNamespace'
  return error
}

function guardWriteOnceNamespaces(client: AliOssCompatibleClient): AliOssCompatibleClient {
  const reject = (action: string) => Promise.reject(writeOnceViolation(action))
  return {
    ...client,
    put: (name, content, options = {}) => isWriteOnceObjectKey(name) && options.forbidOverwrite !== true
      ? reject('overwrite')
      : client.put(name, content, options),
    copy: (targetName, sourceName) => isWriteOnceObjectKey(targetName) ? reject('overwrite') : client.copy(targetName, sourceName),
    putMeta: (name, meta, options) => isWriteOnceObjectKey(name) ? reject('metadata rewrite') : client.putMeta(name, meta, options),
    delete: name => isWriteOnceObjectKey(name) ? reject('delete') : client.delete(name),
    deleteMulti: names => names.some(isWriteOnceObjectKey) ? reject('delete') : client.deleteMulti(names)
  }
}

export function createAliOssCompatibleClient(config: ObjectStorageConfig): AliOssCompatibleClient {
  assertStorageConfig(config)
  const provider = normalizeProvider(config.provider)
  if (provider === 'aliyun-oss-native') {
    return guardWriteOnceNamespaces(createNativeAliOssCompatibleClient(config))
  }
  return guardWriteOnceNamespaces(createS3CompatibleClient({
    ...config,
    provider,
    endpoint: provider === 'aliyun-oss-s3'
      ? normalizeAliyunS3Endpoint(config.endpoint)
      : config.endpoint,
    region: provider === 'aliyun-oss-s3'
      ? aliyunOssRegionFor(config)
      : config.region
  }))
}

export const createObjectStorageClient = createAliOssCompatibleClient
