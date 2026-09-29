import { defineEventHandler, getHeader, getQuery, setResponseHeader, type H3Event } from 'h3'
import { resolveTrustedTenantGatewayContext } from '../utils/tenantGatewayTrust'
import { resolveApplicationShellMigrationTarget, type ApplicationShellMigrationMetadata } from '../../app/utils/applicationShellMigration'

function text(value: unknown) {
  return String(value || '').trim()
}

function originFor(event: H3Event, context: { forwardedHost: string }) {
  const host = context.forwardedHost || text(getHeader(event, 'host'))
  const protocol = text(getHeader(event, 'x-forwarded-proto')).split(',')[0]?.trim().replace(/:$/, '') || 'https'
  return host ? `${protocol}://${host}` : ''
}

/**
 * Returns a direct Host destination only for the trusted Gateway pilot
 * projection. An absent/invalid projection deliberately means “keep the
 * legacy iframe”; browser query parameters never grant migration access.
 */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'cache-control', 'private, no-store')
  const context = resolveTrustedTenantGatewayContext(event)
  if (!context || context.appCode !== 'console' || !context.tenant || !context.deployment || !context.environment) {
    return { migrated: false }
  }

  let metadata: ApplicationShellMigrationMetadata
  try {
    metadata = JSON.parse(text(getHeader(event, 'x-hzy-enterprise-shell-pages')))
  } catch {
    return { migrated: false }
  }
  const query = getQuery(event)
  const origin = originFor(event, context)
  const result = resolveApplicationShellMigrationTarget({
    metadata, consoleDeployment: context.deployment,
    appCode: query.appCode, requested: query.target, origin
  })
  if (!result) return { migrated: false }
  return {
    migrated: true,
    ...result
  }
})
