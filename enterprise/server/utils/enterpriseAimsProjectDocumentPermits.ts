import type { H3Event } from 'h3'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { enterpriseAimsNestedProjectReadPermit } from './enterpriseAimsProjects'

// This callback is an internal typed dependency, never a browser request field.
// The owning Aims core reloads the verified actor; Runtime binds the permit to it.
export function enterpriseAimsDocumentReadPermitProvider(event: H3Event) {
  return async (projectId: string) => await enterpriseAimsNestedProjectReadPermit(event, await requireEnterpriseUser(event), projectId)
}
