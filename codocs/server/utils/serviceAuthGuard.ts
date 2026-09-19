import { createError, getHeader, type H3Event } from 'h3'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requireCodocsServiceAuth, type CodocsServiceAuthContext, type CodocsServiceAuthRequirement } from '../lib/serviceAuthPolicy'

export {
  ALTOC_OPS_KNOWLEDGE_SERVICE_AUTH,
  ALTOC_ENTITY_DOCUMENT_ATTACH_SERVICE_AUTH,
  ALTOC_ENTITY_DOCUMENT_CONTENT_SERVICE_AUTH,
  AIMS_DOCUMENT_PREVIEW_GRANT_SERVICE_AUTH,
  AIMS_DEPARTMENT_DOCUMENTS_LIST_SERVICE_AUTH,
  AIMS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH,
  ASSETS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH,
  ENTERPRISE_ASSETS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH,
  AIMS_PRODUCT_DOCUMENT_CREATE_SERVICE_AUTH,
  AIMS_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH,
  ENTERPRISE_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH,
  AIMS_PROJECT_DOCUMENT_REVIEW_CONTENT_SERVICE_AUTH,
  AIMS_PROJECT_DOCUMENT_REVIEW_GRANT_SERVICE_AUTH,
  AIMS_COMPANY_WEEKLY_SUMMARY_PUBLISH_SERVICE_AUTH,
  AIMS_PROJECT_DOCUMENT_VERSION_RESOLVE_SERVICE_AUTH,
  AIMS_PROJECT_CABINET_DELETE_SERVICE_AUTH,
  AIMS_PROJECT_CABINET_READ_SERVICE_AUTH,
  AIMS_PROJECT_CABINET_UPLOAD_SERVICE_AUTH,
  WORKFLOW_PUBLISH_REQUEST_CALLBACK_SERVICE_AUTH,
  requireCodocsServiceAuth,
  requireCodocsCrossAppServiceTenantDeploymentBinding,
  requireCodocsServiceTenantDeploymentBinding,
  type CodocsServiceAuthContext,
  type CodocsServiceAuthRequirement
} from '../lib/serviceAuthPolicy'

export async function requireAimsProjectCabinetServiceAuth(event: H3Event, requirement: CodocsServiceAuthRequirement) {
  const auth = await requireConsoleAuthContext(event) as CodocsServiceAuthContext
  requireCodocsServiceAuth(auth, requirement)
  const tenant = String(auth.tenant || '').trim()
  const deployment = String(auth.deployment || '').trim()
  const requestTenant = String(getHeader(event, 'x-hzy-tenant') || '').trim()
  const requestDeployment = String(getHeader(event, 'x-hzy-deployment') || '').trim()
  const gateway = resolveTrustedTenantGatewayContext(event)
  const targetBindingValid = gateway
    ? gateway.appCode === 'codocs' && gateway.tenant === tenant && gateway.deployment === requestDeployment
    : deployment === requestDeployment
  if (!tenant || !deployment || !requestTenant || !requestDeployment || tenant !== requestTenant || !targetBindingValid) {
    throw createError({ statusCode: 403, message: 'Service tenant/deployment binding is invalid.' })
  }
  return { tenant, deployment }
}
