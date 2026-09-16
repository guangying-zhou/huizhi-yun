import { Buffer } from 'node:buffer'

type OssClientOptions = {
  accessKeyId: string
  accessKeySecret: string
  bucket: string
  endpoint: string
}

type PutOptions = {
  headers?: Record<string, string>
}

function normalizeEndpoint(endpoint: string) {
  return /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`
}

function encodeObjectKey(key: string) {
  return key.split('/').map(part => encodeURIComponent(part)).join('/')
}

function objectUrl(options: OssClientOptions, key: string) {
  const endpoint = new URL(normalizeEndpoint(options.endpoint))
  const hostname = endpoint.hostname.startsWith(`${options.bucket}.`)
    ? endpoint.hostname
    : `${options.bucket}.${endpoint.hostname}`

  return new URL(`/${encodeObjectKey(key)}`, `${endpoint.protocol}//${hostname}`)
}

function canonicalResource(options: OssClientOptions, key: string) {
  return `/${options.bucket}/${key}`
}

function headersToRecord(headers: Headers) {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value
  })
  return result
}

async function sign(secret: string, text: string) {
  const encoder = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(text))
  return Buffer.from(signature).toString('base64')
}

async function assertOk(response: Response, key: string) {
  if (response.ok) return

  const message = await response.text().catch(() => '')
  const error = new Error(`OSS request failed for ${key}: ${response.status} ${message}`) as Error & {
    code?: string
    status?: number
  }
  error.status = response.status
  error.code = response.status === 404 ? 'NoSuchKey' : 'OssError'
  throw error
}

export default class OSS {
  private readonly options: OssClientOptions

  constructor(options: OssClientOptions) {
    this.options = options
  }

  private async authorization(method: 'GET' | 'PUT', key: string, contentType = '') {
    const date = new Date().toUTCString()
    const stringToSign = [
      method,
      '',
      contentType,
      date,
      canonicalResource(this.options, key)
    ].join('\n')
    const signature = await sign(this.options.accessKeySecret, stringToSign)
    return {
      date,
      authorization: `OSS ${this.options.accessKeyId}:${signature}`
    }
  }

  async put(key: string, content: BodyInit | null, options: PutOptions = {}) {
    const contentType = options.headers?.['Content-Type'] || options.headers?.['content-type'] || 'application/octet-stream'
    const auth = await this.authorization('PUT', key, contentType)
    const headers = new Headers(options.headers || {})
    headers.set('Date', auth.date)
    headers.set('Authorization', auth.authorization)
    headers.set('Content-Type', contentType)

    const response = await fetch(objectUrl(this.options, key), {
      method: 'PUT',
      headers,
      body: content
    })

    await assertOk(response, key)
    return {
      name: key,
      res: {
        status: response.status,
        headers: headersToRecord(response.headers)
      }
    }
  }

  async get(key: string) {
    const auth = await this.authorization('GET', key)
    const headers = new Headers()
    headers.set('Date', auth.date)
    headers.set('Authorization', auth.authorization)

    const response = await fetch(objectUrl(this.options, key), {
      method: 'GET',
      headers
    })

    await assertOk(response, key)
    return {
      content: Buffer.from(await response.arrayBuffer()),
      res: {
        status: response.status,
        headers: headersToRecord(response.headers)
      }
    }
  }
}
