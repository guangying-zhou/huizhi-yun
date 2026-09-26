#!/usr/bin/env node
// Anonymous, read-only exposure and route inventory. Never sends credentials,
// follows redirects, submits bodies, or prints response bodies/headers.
import { readFile } from 'node:fs/promises'
import { networkInterfaces, homedir } from 'node:os'
import { connect } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { enterpriseHostRoutes } from '../enterprise-host-routes.mjs'
import { deriveBusinessApiSurface } from '../../../enterprise/composition/business-api-surface.mjs'
import { businessApiRoutes } from '../../../enterprise/composition/business-api-routes.generated.mjs'

export const PUBLIC_ORIGIN = 'https://hzy0.isme.dev'
const INTERNAL_PORTS = ['console', 'gatewayInternal', 'enterprise', 'codocsEditor']
const PUBLIC_PATHS = [
  ['LE-A05', '/console/api/internal/policy-bundle/sync'],
  ['LE-A05', '/console/api/internal/integration-outbox/drain'],
  ['LE-A05', '/enterprise/api/internal/probe'],
  ['LE-A05', '/_nitro/tasks/probe'],
  ['LE-A05', '/enterprise/__nuxt_devtools__/'],
  ['LE-A05', '/console/__nuxt_devtools__/'],
  ['LE-A06', '/enterprise/_nuxt/@vite/client'],
  ['LE-A06', '/codocs/_nuxt/probe.js'],
  ['LE-A06', '/console/_nuxt/@vite/client']
]

export function nonLoopbackIpv4(interfaces = networkInterfaces()) {
  return Object.values(interfaces).flat().find(address => address?.family === 'IPv4' && !address.internal)?.address || null
}

export function concretePath(pattern) {
  return pattern.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_whole, name) =>
    /uuid|document/i.test(name) ? '00000000-0000-4000-8000-000000000000' : '0')
    .replace(/\*\*:?\w*/g, 'probe')
}

export function routePlan(surface = deriveBusinessApiSurface(), hostRoutes = enterpriseHostRoutes) {
  const registered = new Set(businessApiRoutes.map(([method, path]) => `${method} ${path}`))
  const source = new Set(surface.routes.map(({ method, route }) => `${method} ${route}`))
  if (registered.size !== source.size || [...source].some(key => !registered.has(key))) throw Error('Host API route registration drift')
  const pages = Object.entries(hostRoutes).flatMap(([module, paths]) => paths.map(path => ({
    group: 'LE-A11 page', module, registeredMethod: 'GET', probeMethod: 'HEAD', path: concretePath(path)
  })))
  const apis = surface.routes.map(({ method, route }) => ({
    group: 'LE-A11 api', module: route.split('/')[1], registeredMethod: method,
    // OPTIONS is safe for write routes; the exact method is proven by the
    // file registration, never by sending an anonymous mutation request.
    probeMethod: method === 'GET' || method === 'HEAD' ? method : 'OPTIONS',
    path: concretePath(route)
  }))
  return { pages, apis }
}

export async function tcpStatus(host, port, timeout = 1500) {
  return await new Promise(resolve => {
    const socket = connect({ host, port })
    const done = reachable => { socket.destroy(); resolve(reachable) }
    socket.setTimeout(timeout, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

export async function httpStatus(url, { method = 'GET', localHost = false, upgrade = false } = {}) {
  const target = new URL(url)
  const transport = target.protocol === 'https:' ? httpsRequest : httpRequest
  return await new Promise(resolve => {
    const headers = { accept: 'application/json' }
    if (localHost) headers.host = 'hzy0.isme.dev'
    if (upgrade) Object.assign(headers, { connection: 'Upgrade', upgrade: 'websocket', origin: PUBLIC_ORIGIN,
      'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' })
    const request = transport(target, { method, headers, timeout: 5000 }, response => {
      const contentType = String(response.headers['content-type'] || '').split(';')[0].toLowerCase()
      let location = null
      try { if (response.headers.location) location = new URL(response.headers.location, target) } catch { /* do not follow malformed redirects */ }
      const accessRedirect = response.statusCode === 302 && location?.hostname.endsWith('.cloudflareaccess.com')
        && location.pathname.startsWith('/cdn-cgi/access/login/')
      response.resume()
      resolve({ status: response.statusCode, contentType, accessRedirect: Boolean(accessRedirect) })
    })
    request.once('upgrade', response => { request.destroy(); resolve({ status: response.statusCode, contentType: '', accessRedirect: false }) })
    request.once('timeout', () => { request.destroy(); resolve({ status: null, contentType: '', accessRedirect: false }) })
    request.once('error', () => resolve({ status: null, contentType: '', accessRedirect: false }))
    request.end()
  })
}

export function assess(row) {
  if (row.group === 'LE-A05 tcp') return row.target === 'loopback' ? 'designed' : row.reachable ? 'EXPOSED' : 'closed'
  if (row.group === 'LE-A05 path') return row.status === null ? 'unreachable' : row.accessRedirect ? 'outer-protected'
    : [401, 403, 404].includes(row.status) ? 'denied' : 'REVIEW'
  if (row.group === 'LE-A06 public') return row.status === null ? 'unreachable' : row.accessRedirect || [401, 403].includes(row.status) ? 'outer-protected' : 'REVIEW'
  if (row.group === 'LE-A11 api' && row.status === 200 && row.contentType === 'text/html') return 'HTML-AS-API'
  if (row.group === 'LE-A11 negative') return row.expected.includes(row.status) ? 'passed' : 'REVIEW'
  return row.status === null ? 'unreachable' : 'observed'
}

export async function runProbe(profile, { summary = false, ipv4 = nonLoopbackIpv4() } = {}) {
  const rows = []
  const ingress = `http://127.0.0.1:${profile.listeners.gatewayIngress.port}`
  for (const name of [...INTERNAL_PORTS, ...(profile.features?.codocsCollaborationV2 === true ? ['collab'] : []), 'runtime']) {
    const port = name === 'runtime' ? 18084 : profile.listeners[name].port
    for (const [target, host] of [['public', 'hzy0.isme.dev'], ['non-loopback', ipv4], ['loopback', '127.0.0.1']]) {
      if (!host) { rows.push({ group: 'LE-A05 tcp', target, path: `${name}:${port}`, reachable: null, verdict: 'no-interface' }); continue }
      const reachable = await tcpStatus(host, port)
      rows.push({ group: 'LE-A05 tcp', target, path: `${name}:${port}`, reachable,
        verdict: assess({ group: 'LE-A05 tcp', target, reachable }) })
    }
  }
  for (const [group, path] of PUBLIC_PATHS) {
    const result = await httpStatus(`${PUBLIC_ORIGIN}${path}`)
    const row = { group: group === 'LE-A05' ? 'LE-A05 path' : 'LE-A06 public', target: 'public', method: 'GET', path, ...result }
    rows.push({ ...row, verdict: assess(row) })
    if (group === 'LE-A05') {
      const local = await httpStatus(`${ingress}${path}`, { localHost: true })
      const localRow = { group: 'LE-A05 path', target: 'loopback', method: 'GET', path, ...local }
      rows.push({ ...localRow, verdict: assess(localRow) })
    }
  }
  for (const path of ['/enterprise/_nuxt/@vite/client', '/codocs/_nuxt/probe.js', '/console/_nuxt/@vite/client', '/enterprise/api/navigation', '/console/oauth/userinfo']) {
    const result = await httpStatus(`${ingress}${path}`, { localHost: true })
    rows.push({ group: 'LE-A06 local', target: 'loopback', method: 'GET', path, ...result, verdict: 'observed' })
  }
  const publicWs = await httpStatus(`${PUBLIC_ORIGIN}/__vite_ws`, { upgrade: true })
  rows.push({ group: 'LE-A06 ws', target: 'public', method: 'GET+Upgrade', path: '/__vite_ws', ...publicWs,
    verdict: publicWs.status === 101 ? 'REVIEW' : 'observed' })
  const { pages, apis } = routePlan()
  const routeRows = [...pages, ...apis]
  // Bounded concurrency avoids flooding the local Dev server and Runtime.
  for (let offset = 0; offset < routeRows.length; offset += 6) {
    const batch = routeRows.slice(offset, offset + 6)
    rows.push(...await Promise.all(batch.map(async entry => {
      const result = await httpStatus(`${ingress}${entry.path}`, { method: entry.probeMethod, localHost: true })
      const row = { ...entry, target: 'loopback', method: entry.probeMethod, ...result }
      return { ...row, verdict: assess(row) }
    })))
  }
  for (const [method, path, expected] of [
    ['GET', '/enterprise/route-that-is-not-registered', [404]],
    ['GET', '/api/not-registered', [404]],
    ['OPTIONS', '/shell/aims?target=%2Faims%2Fprojects', [404, 405]],
    ['GET', '/shell/aims?target=%2Faims%2Fprojects', [307]], // legacy /shell/ bookmarks: 307 + no-store, matching the cloud Gateway (C5)
    ['HEAD', '/shell/aims?target=%2Faims%2Fprojects', [307]]
  ]) {
    const result = await httpStatus(`${ingress}${path}`, { method, localHost: true })
    const row = { group: 'LE-A11 negative', target: 'loopback', method, path, expected, ...result }
    rows.push({ ...row, verdict: assess(row) })
  }
  const statuses = group => Object.fromEntries([...new Set(rows.filter(row => row.group === group).map(row => row.status ?? 'unreachable'))]
    .sort().map(status => [status, rows.filter(row => row.group === group && (row.status ?? 'unreachable') === status).length]))
  const counts = { pages: pages.length, apis: apis.length, getApis: apis.filter(row => row.registeredMethod === 'GET').length,
    safeMethodProbes: routeRows.length, pageStatuses: statuses('LE-A11 page'), apiStatuses: statuses('LE-A11 api'),
    writeMethodsNotSent: apis.filter(row => !['GET', 'HEAD'].includes(row.registeredMethod)).length,
    inconclusiveRouteResponses: rows.filter(row => ['LE-A11 page', 'LE-A11 api'].includes(row.group) && [null, 503].includes(row.status)).length,
    warnings: rows.filter(row => ['EXPOSED', 'REVIEW', 'HTML-AS-API'].includes(row.verdict)).length }
  printTable(rows, counts, { summary })
  return { rows, counts }
}

function printTable(rows, counts, { summary }) {
  console.log(`Registered Host pages: ${counts.pages}; APIs: ${counts.apis}; GET APIs: ${counts.getApis}; safe HTTP route probes: ${counts.safeMethodProbes}; warnings: ${counts.warnings}`)
  console.log(`Page status counts: ${JSON.stringify(counts.pageStatuses)}; API status counts: ${JSON.stringify(counts.apiStatuses)}; write methods not sent: ${counts.writeMethodsNotSent}; inconclusive route responses: ${counts.inconclusiveRouteResponses}`)
  console.log('| Check | Target | Method | Path | Result | Verdict |')
  console.log('| --- | --- | --- | --- | --- | --- |')
  for (const row of rows) {
    if (summary && (row.group === 'LE-A11 page' || row.group === 'LE-A11 api') && row.verdict === 'observed') continue
    const result = row.group === 'LE-A05 tcp' ? (row.reachable === null ? 'n/a' : row.reachable ? 'reachable' : 'closed')
      : `${row.status ?? 'unreachable'}${row.contentType ? ` ${row.contentType}` : ''}`
    console.log(`| ${row.group} | ${row.target} | ${row.method || 'TCP'} | ${row.path} | ${result} | ${row.verdict} |`)
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { profile: { type: 'string' }, summary: { type: 'boolean' } } })
  const path = values.profile || join(homedir(), '.config/huizhi-yun/hzy0/profile.json')
  const profile = JSON.parse(await readFile(path, 'utf8'))
  if (profile.profileId !== 'hzy0-local-enterprise' || profile.environment !== 'test'
    || new URL(profile.publicOrigin).href !== `${PUBLIC_ORIGIN}/`) throw Error('Unapproved probe profile')
  const result = await runProbe(profile, { summary: values.summary })
  if (result.counts.warnings) process.exitCode = 1
}
