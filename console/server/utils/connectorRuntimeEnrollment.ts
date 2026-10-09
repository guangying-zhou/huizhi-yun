import { createHash, createPublicKey } from 'node:crypto'
import { getHeader, getRequestURL, type H3Event } from 'h3'
import {
  getConsoleConnectorRuntimeMetadata,
  issueConsoleConnectorRuntimeEnrollment,
  redeemConsoleConnectorRuntimeEnrollment
} from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { resolveConsoleRuntimeBinding } from './consoleRuntimeBinding'
import { resolveDataRuntimeParameters } from './dataRuntimeManagement'
import { getOidcIssuer } from './oidc'
import { getSystemParameter } from './systemParameters'

const PACKAGE_BASE_URL = 'https://downloads.huizhi.yun/packages/hzy-connector-runtime'
const DEFAULT_PORT = '18082'

function text(value: unknown) {
  return String(value || '').trim()
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '')
}

function normalizeDataRuntimeUrl(value: unknown) {
  const raw = text(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    const secure = url.protocol === 'https:' || (loopback && url.protocol === 'http:')
    const clean = !url.username && !url.password && !url.search && !url.hash && (url.pathname === '/' || url.pathname === '')
    return secure && clean ? url.origin : null
  } catch {
    return null
  }
}

function requestOrigin(event: H3Event) {
  const forwardedHost = text(getHeader(event, 'x-forwarded-host')).split(',')[0]?.trim()
  const forwardedProto = text(getHeader(event, 'x-forwarded-proto')).split(',')[0]?.trim()
  const url = getRequestURL(event)
  const protocol = (forwardedProto || url.protocol.replace(/:$/, '') || 'https').replace(/:$/, '')
  const host = forwardedHost || text(getHeader(event, 'host')) || url.host
  return host ? `${protocol}://${host}` : url.origin
}

function shellQuote(value: string) {
  const quote = String.fromCharCode(39)
  return `${quote}${value.replace(/'/g, `${quote}\\${quote}${quote}`)}${quote}`
}

function releasePublicKey(required = false) {
  const encoded = text(process.env.HZY_CONNECTOR_RUNTIME_RELEASE_PUBLIC_KEY_PEM_BASE64)
  if (!encoded) {
    if (required) {
      throw createError({ statusCode: 503, message: 'Connector Runtime release public key is not configured' })
    }
    return null
  }
  try {
    const pem = Buffer.from(encoded, 'base64')
    const key = createPublicKey(pem)
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('not Ed25519')
    return {
      encoded: pem.toString('base64'),
      keyId: createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex')
    }
  } catch {
    if (required) {
      throw createError({ statusCode: 503, message: 'Connector Runtime release public key is invalid' })
    }
    return null
  }
}

function installCommand(input: {
  packageBaseUrl: string
  consoleApiUrl: string
  enrollmentCode: string
  issuer: string
  tenantCode: string
  deploymentCode: string
  port: string
  dataRuntimeApiUrl: string
  releasePublicKeyBase64: string
}) {
  return [
    'tmp_dir="$(mktemp -d)" && \\',
    'trap \'rm -rf "$tmp_dir"\' EXIT && \\',
    `printf '%s' ${shellQuote(input.releasePublicKeyBase64)} | openssl base64 -d -A > "$tmp_dir/release-signing-public.pem" && \\`,
    `curl -fsSL ${shellQuote(`${input.packageBaseUrl}/install.sh`)} -o "$tmp_dir/install.sh" && \\`,
    `curl -fsSL ${shellQuote(`${input.packageBaseUrl}/install.sh.sig`)} -o "$tmp_dir/install.sh.sig" && \\`,
    'openssl pkeyutl -verify -rawin -pubin -inkey "$tmp_dir/release-signing-public.pem" -in "$tmp_dir/install.sh" -sigfile "$tmp_dir/install.sh.sig" >/dev/null && \\',
    '  sudo env \\',
    `    HZY_CONNECTOR_RUNTIME_PACKAGE_BASE_URL=${shellQuote(input.packageBaseUrl)} \\`,
    `    HZY_CONNECTOR_RUNTIME_CONSOLE_URL=${shellQuote(input.consoleApiUrl)} \\`,
    `    HZY_CONNECTOR_RUNTIME_ENROLLMENT_CODE=${shellQuote(input.enrollmentCode)} \\`,
    `    HZY_CONNECTOR_RUNTIME_PORT=${shellQuote(input.port)} \\`,
    `    HZY_CONNECTOR_RUNTIME_TENANT=${shellQuote(input.tenantCode)} \\`,
    `    HZY_CONNECTOR_RUNTIME_DEPLOYMENT=${shellQuote(input.deploymentCode)} \\`,
    `    HZY_CONNECTOR_RUNTIME_DATA_RUNTIME_URL=${shellQuote(input.dataRuntimeApiUrl)} \\`,
    `    HZY_CONSOLE_API_URL=${shellQuote(input.consoleApiUrl)} \\`,
    `    HZY_CONSOLE_TOKEN_URL=${shellQuote(`${input.issuer}/oauth/token`)} \\`,
    `    HZY_CONNECTOR_RUNTIME_JWT_ISSUER=${shellQuote(input.issuer)} \\`,
    `    HZY_CONNECTOR_RUNTIME_JWKS_URL=${shellQuote(`${input.issuer}/.well-known/jwks.json`)} \\`,
    '    HZY_CONNECTOR_RUNTIME_RELEASE_PUBLIC_KEY_FILE="$tmp_dir/release-signing-public.pem" \\',
    '    bash "$tmp_dir/install.sh"'
  ].join('\n')
}

export async function getConnectorRuntimeMetadata(event: H3Event) {
  const binding = resolveConsoleRuntimeBinding(event)
  const consoleApiUrl = normalizeBaseUrl(requestOrigin(event))
  const issuer = normalizeBaseUrl(getOidcIssuer(event) || consoleApiUrl)
  const packageBaseUrl = normalizeBaseUrl(text(process.env.HZY_CONNECTOR_RUNTIME_PACKAGE_BASE_URL) || PACKAGE_BASE_URL)
  const runtime = await getConsoleConnectorRuntimeMetadata(event)
  const runtimeApiUrl = await getSystemParameter('connector.runtimeApiUrl', event).catch(() => null)
  const dataRuntimeApiUrl = await resolveDataRuntimeParameters(event)
    .then(parameters => normalizeDataRuntimeUrl(parameters.runtimeApiUrl))
    .catch(() => null)
  const trustedReleaseKey = releasePublicKey()
  return {
    packageBaseUrl,
    consoleApiUrl,
    issuer,
    audience: 'connector-runtime',
    tenantCode: binding.tenantId,
    deploymentCode: binding.deploymentId,
    port: text(process.env.HZY_CONNECTOR_RUNTIME_PORT) || DEFAULT_PORT,
    sqlitePath: '/opt/hzy/connector-runtime/data/operations.db',
    serviceName: 'hzy-connector-runtime',
    updateTimer: 'hzy-connector-runtime-update.timer',
    releaseSigningKeyId: trustedReleaseKey?.keyId || null,
    runtimeApiUrl,
    dataRuntimeApiUrl,
    connector: runtime.data.connector,
    installCommand: ''
  }
}

export async function issueConnectorRuntimeEnrollment(event: H3Event) {
  const metadata = await getConnectorRuntimeMetadata(event)
  if (!metadata.dataRuntimeApiUrl) {
    throw createError({ statusCode: 503, message: 'Data Runtime 地址未配置或不安全；跨服务器部署必须使用 HTTPS origin' })
  }
  const trustedReleaseKey = releasePublicKey(true)!
  const enrollment = await issueConsoleConnectorRuntimeEnrollment(event)
  return {
    ...metadata,
    enrollmentCodeLast4: enrollment.data.enrollmentCodeLast4,
    expiresAt: enrollment.data.expiresAt,
    installCommand: installCommand({
      ...metadata,
      dataRuntimeApiUrl: metadata.dataRuntimeApiUrl,
      enrollmentCode: enrollment.data.enrollmentCode,
      releasePublicKeyBase64: trustedReleaseKey.encoded
    })
  }
}

export async function redeemConnectorRuntimeEnrollment(
  event: H3Event,
  input: Record<string, unknown>
) {
  const response = await redeemConsoleConnectorRuntimeEnrollment(event, input)
  return response.data
}
