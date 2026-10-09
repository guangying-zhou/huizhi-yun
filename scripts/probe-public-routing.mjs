#!/usr/bin/env node
import dns from 'node:dns/promises'
import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import process from 'node:process'

const DEFAULT_CONSOLE_PM2_URL = 'https://hzy.wiztek.cn'
const DEFAULT_CONSOLE_CLOUDFLARE_URL = 'https://console.huizhi.yun'

const DEFAULT_TARGETS = {
  platformProd: {
    label: 'platform-prod',
    url: 'https://platform.wiztek.cn',
    forbidCloudflare: true,
    pm2Name: 'hzy-platform-prod',
    upstream: '127.0.0.1:3010'
  },
  platformDev: {
    label: 'platform-dev',
    url: 'https://platform-dev.wiztek.cn',
    forbidCloudflare: true,
    pm2Name: 'hzy-platform-dev',
    upstream: '127.0.0.1:3011'
  },
  consoleProd: {
    label: 'console-prod',
    url: DEFAULT_CONSOLE_PM2_URL,
    forbidCloudflare: false,
    pm2Name: 'hzy-console-prod',
    upstream: '127.0.0.1:3030'
  },
  consoleTest: {
    label: 'console-test',
    url: 'https://hzy-test.wiztek.cn',
    forbidCloudflare: false,
    pm2Name: 'hzy-console-test',
    upstream: '127.0.0.1:3031'
  }
}

const URL_OPTIONS = {
  'platform-prod-url': 'platformProd',
  'platform-dev-url': 'platformDev',
  'console-prod-url': 'consoleProd',
  'console-test-url': 'consoleTest'
}

const EXPECTED_IP_OPTIONS = {
  'platform-prod-expected-ip': 'platformProd',
  'platform-dev-expected-ip': 'platformDev',
  'console-prod-expected-ip': 'consoleProd',
  'console-test-expected-ip': 'consoleTest'
}

const EXPECTED_IP_ENV_OPTIONS = {
  'platform-prod-expected-ip-env': 'platformProd',
  'platform-dev-expected-ip-env': 'platformDev',
  'console-prod-expected-ip-env': 'consoleProd',
  'console-test-expected-ip-env': 'consoleTest'
}

function usage() {
  return `
Usage:
  pnpm run probe:public-routing

  pnpm run probe:public-routing -- \\
    --expected-ip 8.130.81.31 \\
    --platform-prod-url https://platform.wiztek.cn \\
    --platform-dev-url https://platform-dev.wiztek.cn \\
    --console-prod-url https://hzy.wiztek.cn \\
    --console-test-url https://hzy-test.wiztek.cn

  # If console-prod runs on Cloudflare, validate only the domestic server targets:
  pnpm run probe:public-routing -- --expected-server-ip 8.130.81.31 --console-prod-cloudflare
  pnpm run probe:public-routing -- --expected-server-ip-env HZY_SERVER_PUBLIC_IP --console-prod-cloudflare

  # Equivalent targeted checks:
  pnpm run probe:public-routing -- \\
    --expected-platform-ip 8.130.81.31 \\
    --console-test-expected-ip 8.130.81.31
  pnpm run probe:public-routing -- \\
    --expected-platform-ip-env HZY_SERVER_PUBLIC_IP \\
    --console-test-expected-ip-env HZY_SERVER_PUBLIC_IP

Checks public DNS and HTTP reachability for the prod/test Platform and Console
domains. Platform targets fail if they appear to be served by Cloudflare unless
--allow-platform-cloudflare is explicitly passed.
Use --print-plan to show target URLs and expected IP constraints without DNS or
HTTP access.
Use --dns-fixture-file with --skip-http only for offline verifier tests.
`
}

function parseArgs(argv) {
  const args = {
    targets: structuredClone(DEFAULT_TARGETS),
    expectedIps: [],
    timeoutMs: 10000,
    allowPlatformCloudflare: false,
    consoleProdCloudflare: false,
    consoleProdUrlExplicit: false,
    skipHttp: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--') continue
    if (item === '--help' || item === '-h') {
      args.help = true
      continue
    }
    if (item === '--allow-platform-cloudflare') {
      args.allowPlatformCloudflare = true
      continue
    }
    if (item === '--console-prod-cloudflare') {
      args.consoleProdCloudflare = true
      continue
    }
    if (item === '--skip-http') {
      args.skipHttp = true
      continue
    }
    if (item === '--print-plan') {
      args.printPlan = true
      continue
    }
    if (!item.startsWith('--')) continue

    const raw = item.slice(2)
    const equalsIndex = raw.indexOf('=')
    const name = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw
    const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : argv[index + 1]

    if (URL_OPTIONS[name]) {
      if (URL_OPTIONS[name] === 'consoleProd') {
        args.consoleProdUrlExplicit = true
      }
      args.targets[URL_OPTIONS[name]].url = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (EXPECTED_IP_OPTIONS[name]) {
      args.targets[EXPECTED_IP_OPTIONS[name]].expectedIps = parseIpList(requiredValue(name, value))
      if (equalsIndex < 0) index += 1
      continue
    }

    if (EXPECTED_IP_ENV_OPTIONS[name]) {
      args.targets[EXPECTED_IP_ENV_OPTIONS[name]].expectedIps = readIpListFromEnv(requiredValue(name, value))
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'expected-ip') {
      args.expectedIps = parseIpList(requiredValue(name, value))
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'expected-ip-env') {
      const envName = requiredValue(name, value)
      args.expectedIps = parseIpList(String(process.env[envName] || '').trim())
      if (!args.expectedIps.length) throw new Error(`environment variable is empty: ${envName}`)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'expected-server-ip') {
      const expectedIps = parseIpList(requiredValue(name, value))
      args.targets.platformProd.expectedIps = expectedIps
      args.targets.platformDev.expectedIps = expectedIps
      args.targets.consoleTest.expectedIps = expectedIps
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'expected-server-ip-env') {
      const expectedIps = readIpListFromEnv(requiredValue(name, value))
      args.targets.platformProd.expectedIps = expectedIps
      args.targets.platformDev.expectedIps = expectedIps
      args.targets.consoleTest.expectedIps = expectedIps
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'expected-platform-ip') {
      const expectedIps = parseIpList(requiredValue(name, value))
      args.targets.platformProd.expectedIps = expectedIps
      args.targets.platformDev.expectedIps = expectedIps
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'expected-platform-ip-env') {
      const expectedIps = readIpListFromEnv(requiredValue(name, value))
      args.targets.platformProd.expectedIps = expectedIps
      args.targets.platformDev.expectedIps = expectedIps
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'timeout-ms') {
      const parsed = Number.parseInt(requiredValue(name, value), 10)
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('--timeout-ms must be a positive integer')
      args.timeoutMs = parsed
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'dns-fixture-file') {
      args.dnsFixtureFile = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    throw new Error(`unknown option: --${name}`)
  }

  if (args.consoleProdCloudflare && !args.consoleProdUrlExplicit) {
    args.targets.consoleProd.url = DEFAULT_CONSOLE_CLOUDFLARE_URL
  }

  return args
}

function parseIpList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function readIpListFromEnv(envName) {
  const expectedIps = parseIpList(String(process.env[envName] || '').trim())
  if (!expectedIps.length) throw new Error(`environment variable is empty: ${envName}`)
  return expectedIps
}

function requiredValue(name, value) {
  if (!value || value.startsWith('--')) {
    throw new Error(`missing value for --${name}`)
  }
  return value
}

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function dnsHint(target, hostname, expectedIps) {
  if (!expectedIps.length) return ''
  return `; add DNS A record ${hostname} -> ${expectedIps.join(' or ')} for ${target.label}`
}

function readDnsFixture(path) {
  if (!path) return null
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('DNS fixture must be a JSON object mapping hostname to IP string or array')
  }

  const fixture = new Map()
  for (const [hostname, value] of Object.entries(parsed)) {
    const addresses = Array.isArray(value) ? value : [value]
    fixture.set(hostname, addresses.map(item => String(item || '').trim()).filter(Boolean))
  }
  return fixture
}

function tlsHint(error, hostname) {
  const cause = error && typeof error === 'object' ? error.cause : null
  const code = cause && typeof cause === 'object' ? cause.code : ''
  if (!code) return ''

  if (String(code) === 'ERR_TLS_CERT_ALTNAME_INVALID') {
    return `; hint=issue/install a TLS certificate whose subjectAltName covers ${hostname}, then reload Nginx`
  }
  if (['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(String(code))) {
    return `; hint=replace the TLS certificate for ${hostname} with a trusted, unexpired certificate, then reload Nginx`
  }
  return ''
}

function describeError(error, hostname) {
  const message = error instanceof Error ? error.message : String(error)
  const cause = error && typeof error === 'object' ? error.cause : null
  const hint = tlsHint(error, hostname)
  if (!cause || typeof cause !== 'object') return `${message}${hint}`

  const details = []
  if (cause.code) details.push(String(cause.code))
  if (cause.address) details.push(String(cause.address))
  if (cause.port) details.push(`port ${cause.port}`)
  if (cause.message && cause.message !== message) details.push(String(cause.message))

  return details.length ? `${message}; cause=${details.join(' ')}${hint}` : `${message}${hint}`
}

function httpStatusHint(target, status, options) {
  if ([502, 503, 504].includes(status)) {
    const upstreamCommand = `pnpm run probe:server-upstreams${options.consoleProdCloudflare ? ' -- --console-prod-cloudflare' : ''}`
    return `; hint=check PM2 process ${target.pm2Name} is online, listening on ${target.upstream}, and Nginx proxy_pass/server_name routes to that upstream; next=on the PM2/Nginx server run ${upstreamCommand}, then validate/reload Nginx`
  }
  return ''
}

async function resolveAddresses(hostname, fixture) {
  const literalAddress = hostname.replace(/^\[/, '').replace(/\]$/, '')
  if (isIP(literalAddress)) return [literalAddress]

  if (fixture) {
    return fixture.get(hostname) || []
  }

  const [ipv4, ipv6] = await Promise.all([
    dns.resolve4(hostname).catch((error) => {
      if (['ENODATA', 'ENOTFOUND', 'ENODOMAIN'].includes(error.code)) return []
      throw error
    }),
    dns.resolve6(hostname).catch((error) => {
      if (['ENODATA', 'ENOTFOUND', 'ENODOMAIN'].includes(error.code)) return []
      throw error
    })
  ])
  return [...ipv4, ...ipv6]
}

async function fetchReachability(url, timeoutMs) {
  const head = await fetchHttp(url, 'HEAD', timeoutMs)
  if (![405, 501].includes(head.status)) return head

  return fetchHttp(url, 'GET', timeoutMs)
}

async function fetchHttp(url, method, timeoutMs) {
  const response = await fetch(url, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs)
  })
  await response.body?.cancel().catch(() => {})

  return {
    method,
    status: response.status,
    server: response.headers.get('server') || '',
    location: response.headers.get('location') || ''
  }
}

async function probeTarget(target, options) {
  const url = normalizeUrl(target.url)
  const parsed = new URL(url)
  const addresses = await resolveAddresses(parsed.hostname, options.dnsFixture)
  const expectedIps = target.expectedIps?.length ? target.expectedIps : options.expectedIps
  if (!addresses.length) {
    throw new Error(`${target.label} DNS has no A/AAAA records for ${parsed.hostname}${dnsHint(target, parsed.hostname, expectedIps)}`)
  }

  if (expectedIps.length && !expectedIps.some(expectedIp => addresses.includes(expectedIp))) {
    throw new Error(`${target.label} DNS does not include expected IP ${expectedIps.join(' or ')}; got ${addresses.join(', ')}${dnsHint(target, parsed.hostname, expectedIps)}`)
  }

  if (options.skipHttp) {
    console.info(`[public-routing] ${target.label}: host=${parsed.hostname}, dns=${addresses.join(', ')}, http=skipped`)
    return
  }

  let http
  try {
    http = await fetchReachability(url, options.timeoutMs)
  } catch (error) {
    throw new Error(`${target.label} HTTP probe failed for ${url} (dns=${addresses.join(', ')}): ${describeError(error, parsed.hostname)}`)
  }
  if (http.status === 404 || http.status >= 500) {
    throw new Error(`${target.label} returned HTTP ${http.status} for ${url}${httpStatusHint(target, http.status, options)}`)
  }

  if (
    target.forbidCloudflare
    && !options.allowPlatformCloudflare
    && http.server.toLowerCase().includes('cloudflare')
  ) {
    throw new Error(`${target.label} must not be served by Cloudflare; got server=${http.server}`)
  }

  console.info(`[public-routing] ${target.label}: host=${parsed.hostname}, dns=${addresses.join(', ')}, http=${http.status}/${http.method}, server=${http.server || '<none>'}`)
}

function printPlan(args) {
  for (const target of Object.values(args.targets)) {
    const url = normalizeUrl(target.url)
    const parsed = new URL(url)
    const expectedIps = target.expectedIps?.length ? target.expectedIps : args.expectedIps
    console.info([
      `[public-routing-plan] ${target.label}:`,
      `url=${url}`,
      `host=${parsed.hostname}`,
      `expectedIps=${expectedIps.length ? expectedIps.join(',') : '<none>'}`,
      `forbidCloudflare=${target.forbidCloudflare && !args.allowPlatformCloudflare ? 'true' : 'false'}`
    ].join(' '))
  }
  console.info('[public-routing-plan] printed')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.info(usage().trim())
    return
  }

  if (args.printPlan) {
    printPlan(args)
    return
  }

  if (args.dnsFixtureFile && !args.skipHttp) {
    throw new Error('--dns-fixture-file is only for offline verifier tests and must be combined with --skip-http')
  }

  args.dnsFixture = readDnsFixture(args.dnsFixtureFile)

  const failures = []
  for (const target of Object.values(args.targets)) {
    try {
      await probeTarget(target, args)
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }

  if (failures.length) {
    throw new Error(failures.join('\n  - '))
  }

  console.info('[public-routing] passed')
}

main().catch((error) => {
  console.error(`[public-routing] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
