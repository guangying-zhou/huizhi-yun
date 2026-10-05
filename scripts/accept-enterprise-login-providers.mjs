#!/usr/bin/env node
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const PROVIDERS = ['oidc', 'cas', 'wecom', 'dingtalk']

export class EnterpriseLoginAcceptanceError extends Error {}

function requiredValue(name, value) {
  const normalized = String(value || '').trim()
  if (!normalized || normalized.startsWith('--')) {
    throw new EnterpriseLoginAcceptanceError(`--${name} requires a value`)
  }
  return normalized
}

function normalizeBaseUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname))) {
    throw new EnterpriseLoginAcceptanceError('--base-url must use HTTPS or a loopback HTTP origin')
  }
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export function parseArgs(argv) {
  const args = {
    baseUrl: '',
    primary: '',
    providers: [],
    oidcHost: '',
    dingtalkHost: '',
    probeStarts: false,
    probeInvalidState: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--') continue
    if (item === '--help' || item === '-h') args.help = true
    else if (item === '--probe-starts') args.probeStarts = true
    else if (item === '--probe-invalid-state') args.probeInvalidState = true
    else if (item.startsWith('--')) {
      const name = item.slice(2)
      const value = requiredValue(name, argv[index + 1])
      index += 1
      if (name === 'base-url') args.baseUrl = normalizeBaseUrl(value)
      else if (name === 'primary') args.primary = value.toLowerCase()
      else if (name === 'providers') args.providers = value.split(',').map(entry => entry.trim().toLowerCase()).filter(Boolean)
      else if (name === 'oidc-host') args.oidcHost = value.toLowerCase()
      else if (name === 'dingtalk-host') args.dingtalkHost = value.toLowerCase()
      else throw new EnterpriseLoginAcceptanceError(`unknown option: --${name}`)
    }
  }

  if (args.help) return args
  if (!args.baseUrl) throw new EnterpriseLoginAcceptanceError('--base-url is required')
  if (!PROVIDERS.includes(args.primary)) throw new EnterpriseLoginAcceptanceError('--primary must be oidc, cas, wecom, or dingtalk')
  if (!args.providers.length || args.providers.some(provider => !PROVIDERS.includes(provider))) {
    throw new EnterpriseLoginAcceptanceError('--providers must be a comma-separated provider list')
  }
  args.providers = [...new Set(args.providers)]
  if (!args.providers.includes(args.primary)) throw new EnterpriseLoginAcceptanceError('--providers must include --primary')
  if (args.probeInvalidState && !args.probeStarts) {
    throw new EnterpriseLoginAcceptanceError('--probe-invalid-state requires --probe-starts')
  }
  if (args.probeStarts && args.providers.includes('oidc') && !args.oidcHost) {
    throw new EnterpriseLoginAcceptanceError('--oidc-host is required when probing OIDC start')
  }
  return args
}

function responseData(payload) {
  return payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object'
    ? payload.data
    : payload
}

async function jsonResponse(response, label) {
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new EnterpriseLoginAcceptanceError(`${label} did not return JSON`)
  }
  if (!response.ok) throw new EnterpriseLoginAcceptanceError(`${label} returned HTTP ${response.status}`)
  return responseData(payload)
}

function assertRedirect(response, label, expectedHost, expectedPath = '') {
  if (response.status !== 302 && response.status !== 303) {
    throw new EnterpriseLoginAcceptanceError(`${label} expected redirect, got HTTP ${response.status}`)
  }
  const location = response.headers.get('location') || ''
  let url
  try {
    url = new URL(location)
  } catch {
    throw new EnterpriseLoginAcceptanceError(`${label} returned an invalid redirect`)
  }
  if (url.host.toLowerCase() !== expectedHost.toLowerCase()) {
    throw new EnterpriseLoginAcceptanceError(`${label} redirected to unexpected host ${url.host}`)
  }
  if (expectedPath && url.pathname !== expectedPath) {
    throw new EnterpriseLoginAcceptanceError(`${label} redirected to unexpected path ${url.pathname}`)
  }
  if (!url.searchParams.get('state')) {
    throw new EnterpriseLoginAcceptanceError(`${label} redirect is missing state`)
  }
  return { host: url.host, path: url.pathname, state: 'present' }
}

export async function runEnterpriseLoginAcceptance(args, { fetchImpl = fetch } = {}) {
  const configResponse = await fetchImpl(`${args.baseUrl}/api/auth/login-config`, {
    headers: { accept: 'application/json' },
    redirect: 'manual'
  })
  const config = await jsonResponse(configResponse, 'login config')
  const enabledProviders = Array.isArray(config.enabledProviders) ? config.enabledProviders : []
  if (config.mode !== args.primary) {
    throw new EnterpriseLoginAcceptanceError(`expected primary ${args.primary}, got ${config.mode || 'none'}`)
  }
  if (JSON.stringify(enabledProviders) !== JSON.stringify(args.providers)) {
    throw new EnterpriseLoginAcceptanceError(`expected providers ${args.providers.join(',')}, got ${enabledProviders.join(',')}`)
  }
  const serializedConfig = JSON.stringify(config).toLowerCase()
  for (const forbidden of ['corpsecret', 'appsecret', 'clientsecret']) {
    if (serializedConfig.includes(forbidden)) {
      throw new EnterpriseLoginAcceptanceError(`public login config exposes forbidden field ${forbidden}`)
    }
  }

  const evidence = {
    baseUrl: args.baseUrl,
    primary: config.mode,
    enabledProviders,
    publicSecretsExposed: false,
    startProbes: {},
    invalidStateRejected: null
  }
  if (!args.probeStarts) return evidence

  if (enabledProviders.includes('oidc')) {
    const response = await fetchImpl(`${args.baseUrl}/api/auth/oidc-login?redirect=%2F`, { redirect: 'manual' })
    evidence.startProbes.oidc = assertRedirect(response, 'OIDC start', args.oidcHost)
  }
  if (enabledProviders.includes('wecom')) {
    const desktop = await fetchImpl(`${args.baseUrl}/api/auth/wecom-login?redirect=%2F`, { redirect: 'manual' })
    evidence.startProbes.wecomDesktop = assertRedirect(desktop, 'WeCom desktop start', 'open.work.weixin.qq.com', '/wwopen/sso/qrConnect')
    const mobile = await fetchImpl(`${args.baseUrl}/api/auth/wecom-login?redirect=%2F`, {
      headers: { 'user-agent': 'Mozilla/5.0 wxwork/4.1.30' },
      redirect: 'manual'
    })
    evidence.startProbes.wecomMobile = assertRedirect(mobile, 'WeCom mobile start', 'open.weixin.qq.com', '/connect/oauth2/authorize')
  }
  if (enabledProviders.includes('dingtalk')) {
    if (!args.dingtalkHost) throw new EnterpriseLoginAcceptanceError('--dingtalk-host is required when probing DingTalk start')
    const response = await fetchImpl(`${args.baseUrl}/api/auth/dingtalk-login?redirect=%2F`, { redirect: 'manual' })
    evidence.startProbes.dingtalk = assertRedirect(response, 'DingTalk start', args.dingtalkHost)
  }

  if (args.probeInvalidState) {
    for (const provider of ['wecom', 'dingtalk']) {
      if (!enabledProviders.includes(provider)) continue
      const response = await fetchImpl(`${args.baseUrl}/api/auth/${provider}-callback?code=acceptance-invalid-code&state=acceptance-invalid-state`, { redirect: 'manual' })
      if (response.status !== 400) {
        throw new EnterpriseLoginAcceptanceError(`invalid ${provider} state expected HTTP 400, got ${response.status}`)
      }
    }
    evidence.invalidStateRejected = true
  }
  return evidence
}

function usage() {
  return `Usage:
  pnpm run accept:enterprise-login -- --base-url https://wiztek.huizhi.yun \\
    --primary oidc --providers oidc,wecom

Add --probe-starts --oidc-host sso.wiztek.cn to create short-lived login
transactions and validate provider redirect hosts. Add --probe-invalid-state only
for an authorized live failure-path probe; it validates every enabled external
provider callback and writes sanitized auth audit events.`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }
  console.log(JSON.stringify(await runEnterpriseLoginAcceptance(args), null, 2))
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
