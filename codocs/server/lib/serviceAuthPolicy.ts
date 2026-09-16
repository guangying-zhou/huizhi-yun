// Kept outside Nuxt's auto-imported server/utils directory for explicit policy imports.
import { createError } from 'h3'

export interface CodocsServiceAuthContext {
  authenticated?: boolean
  reason?: string
  tokenUse?: string
  subjectType?: string
  appCode?: string
  clientCode?: string
  scopes?: string[]
  tenant?: string
  deployment?: string
}

export interface CodocsServiceAuthRequirement {
  scope: string
  allowedApps: string[]
  allowedClientCodes?: string[]
  exactScope?: boolean
}

export const ALTOC_OPS_KNOWLEDGE_SERVICE_AUTH: CodocsServiceAuthRequirement = {
  scope: 'codocs:documents:write', allowedApps: ['altoc']
}

export const AIMS_DOCUMENT_PREVIEW_GRANT_SERVICE_AUTH: CodocsServiceAuthRequirement = {
  scope: 'codocs:documents:write', allowedApps: ['aims']
}

// This actor-delegating endpoint accepts only the signed Aims product binding.
export const AIMS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH: CodocsServiceAuthRequirement = {
  scope: 'codocs:product-document:read', allowedApps: ['aims'], allowedClientCodes: ['aims.runtime'], exactScope: true
}

export const ASSETS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH: CodocsServiceAuthRequirement = {
  scope: 'codocs:product-document:read', allowedApps: ['assets'], allowedClientCodes: ['assets.runtime'], exactScope: true
}

export const AIMS_PRODUCT_DOCUMENT_CREATE_SERVICE_AUTH: CodocsServiceAuthRequirement = {
  scope: 'codocs:product-document:create', allowedApps: ['aims'], allowedClientCodes: ['aims.runtime'], exactScope: true
}

export const AIMS_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH: CodocsServiceAuthRequirement = {
  scope: 'codocs:project-document:content:read', allowedApps: ['aims'], allowedClientCodes: ['aims.runtime'], exactScope: true
}

export const AIMS_DEPARTMENT_DOCUMENTS_LIST_SERVICE_AUTH: CodocsServiceAuthRequirement = {
  scope: 'codocs:department-documents:list', allowedApps: ['aims'], allowedClientCodes: ['aims.runtime'], exactScope: true
}

export const AIMS_PROJECT_DOCUMENT_VERSION_RESOLVE_SERVICE_AUTH: CodocsServiceAuthRequirement = {
  scope: 'codocs:project-document:version:resolve', allowedApps: ['aims'], allowedClientCodes: ['aims.runtime'], exactScope: true
}

export const AIMS_PROJECT_DOCUMENT_REVIEW_CONTENT_SERVICE_AUTH: CodocsServiceAuthRequirement = {
  scope: 'codocs:project-document:review-content:read', allowedApps: ['aims'], allowedClientCodes: ['aims.runtime'], exactScope: true
}

export const AIMS_PROJECT_DOCUMENT_REVIEW_GRANT_SERVICE_AUTH: CodocsServiceAuthRequirement = {
  scope: 'codocs:project-document:review-grant:create', allowedApps: ['aims'], allowedClientCodes: ['aims.runtime'], exactScope: true
}

export const AIMS_COMPANY_WEEKLY_SUMMARY_PUBLISH_SERVICE_AUTH: CodocsServiceAuthRequirement = {
  scope: 'codocs:company-weekly-summary:publish', allowedApps: ['aims'], allowedClientCodes: ['aims.runtime'], exactScope: true
}

export const ALTOC_ENTITY_DOCUMENT_CONTENT_SERVICE_AUTH: CodocsServiceAuthRequirement = {
  scope: 'codocs:altoc-entity-document:content:read', allowedApps: ['altoc'], allowedClientCodes: ['altoc'], exactScope: true
}

export const ALTOC_ENTITY_DOCUMENT_ATTACH_SERVICE_AUTH: CodocsServiceAuthRequirement = {
  scope: 'codocs:altoc-entity-document:attach', allowedApps: ['altoc'], allowedClientCodes: ['altoc'], exactScope: true
}

export const AIMS_PROJECT_CABINET_READ_SERVICE_AUTH: CodocsServiceAuthRequirement = {
  scope: 'codocs:project-cabinet:read', allowedApps: ['aims'], allowedClientCodes: ['aims', 'aims.runtime'], exactScope: true
}
export const AIMS_PROJECT_CABINET_UPLOAD_SERVICE_AUTH: CodocsServiceAuthRequirement = {
  scope: 'codocs:project-cabinet:upload', allowedApps: ['aims'], allowedClientCodes: ['aims', 'aims.runtime'], exactScope: true
}
export const AIMS_PROJECT_CABINET_DELETE_SERVICE_AUTH: CodocsServiceAuthRequirement = {
  scope: 'codocs:project-cabinet:delete', allowedApps: ['aims'], allowedClientCodes: ['aims', 'aims.runtime'], exactScope: true
}

export const WORKFLOW_PUBLISH_REQUEST_CALLBACK_SERVICE_AUTH: CodocsServiceAuthRequirement = {
  scope: 'workflow:callback', allowedApps: ['workflow'], exactScope: true
}

function sourceApp(auth: CodocsServiceAuthContext) {
  return String(auth.appCode || auth.clientCode || '').trim().replace(/\.runtime$/, '')
}

function hasServiceCapability(scopes: string[], required: string, exact = false) {
  const scopeSet = new Set(scopes)
  if (scopeSet.has(required)) return true
  if (exact) return false
  return scopeSet.has('codocs:*') || scopeSet.has('codocs:admin')
}

export function requireCodocsServiceAuth(
  auth: CodocsServiceAuthContext | null | undefined,
  requirement: CodocsServiceAuthRequirement
) {
  if (!auth?.authenticated && auth?.reason === 'service_token_introspection_unavailable') {
    throw createError({ statusCode: 503, statusMessage: 'service_token_introspection_unavailable', message: 'Console service token introspection is unavailable.' })
  }
  if (!auth?.authenticated || auth.tokenUse !== 'service' || auth.subjectType !== 'service') {
    throw createError({ statusCode: 401, message: 'Console service token is required.' })
  }
  if (!hasServiceCapability(auth.scopes || [], requirement.scope, requirement.exactScope)) {
    throw createError({ statusCode: 403, message: `Missing required service scope: ${requirement.scope}` })
  }
  if (!requirement.allowedApps.includes(sourceApp(auth))) {
    throw createError({ statusCode: 403, message: 'Service caller is not allowed for this endpoint.' })
  }
  if (requirement.allowedClientCodes && !requirement.allowedClientCodes.includes(String(auth.clientCode || '').trim())) {
    throw createError({ statusCode: 403, message: 'Service client is not allowed for this endpoint.' })
  }
}

// This is intentionally separate from the Aims cabinet wrapper: callback
// routes already have a resolved Console auth context and must bind that exact
// service token to the Tenant Gateway request context before reading a body.
export function requireCodocsServiceTenantDeploymentBinding(
  auth: CodocsServiceAuthContext | null | undefined,
  requestTenant: unknown,
  requestDeployment: unknown
) {
  const tenant = String(auth?.tenant || '').trim()
  const deployment = String(auth?.deployment || '').trim()
  const trustedRequestTenant = String(requestTenant || '').trim()
  const trustedRequestDeployment = String(requestDeployment || '').trim()
  if (!tenant || !deployment || !trustedRequestTenant || !trustedRequestDeployment || tenant !== trustedRequestTenant || deployment !== trustedRequestDeployment) {
    throw createError({ statusCode: 403, message: 'Service tenant/deployment binding is invalid.' })
  }
  return { tenant, deployment }
}

export function requireCodocsCrossAppServiceTenantDeploymentBinding(
  auth: CodocsServiceAuthContext | null | undefined,
  requestTenant: unknown,
  requestTargetDeployment: unknown
) {
  const tenant = String(auth?.tenant || '').trim()
  const sourceDeployment = String(auth?.deployment || '').trim()
  const trustedRequestTenant = String(requestTenant || '').trim()
  const targetDeployment = String(requestTargetDeployment || '').trim()
  if (!tenant || !sourceDeployment || !trustedRequestTenant || !targetDeployment || tenant !== trustedRequestTenant) {
    throw createError({ statusCode: 403, message: 'Cross-app service tenant/deployment binding is invalid.' })
  }
  return { tenant, sourceDeployment, targetDeployment }
}
