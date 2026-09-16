import { createServer } from 'node:https'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import gateway from '../../../deploy/cloudflare/tenant-gateway/src/index.js'

function required(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`missing ${name}`)
  return value
}

const host = required('HZY_G3_GATEWAY_HOST')
const port = Number(required('HZY_G3_GATEWAY_PORT'))
const key = await readFile(required('HZY_G3_GATEWAY_PRIVATE_KEY_FILE'))
const cert = await readFile(required('HZY_G3_GATEWAY_CERTIFICATE_FILE'))
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.startsWith('HZY_')))

const server = createServer({ key, cert }, async (request, response) => {
  try {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = chunks.length ? Buffer.concat(chunks) : undefined
    const url = `https://${request.headers.host || `${host}:${port}`}${request.url || '/'}`
    const upstream = await gateway.fetch(new Request(url, {
      method: request.method,
      headers: request.headers,
      ...(body ? { body, duplex: 'half' } : {}),
      redirect: 'manual'
    }), env)
    const responseHeaders = Object.fromEntries([...upstream.headers].filter(([name]) => name !== 'set-cookie'))
    const cookies = upstream.headers.getSetCookie?.() || []
    if (cookies.length) responseHeaders['set-cookie'] = cookies
    response.writeHead(upstream.status, responseHeaders)
    response.end(Buffer.from(await upstream.arrayBuffer()))
  } catch {
    response.writeHead(502, { 'content-type': 'text/plain;charset=utf-8' })
    response.end('Local gateway adapter failure')
  }
})

server.listen(port, host)
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)))
