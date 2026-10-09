import { type H3Event, setHeader } from 'h3'
import { requireEnterpriseKnowledgeLink } from '@hzy/foundation/server/utils/knowledgeLinkService'
import { callCodocsTenantRuntime } from './codocsRuntime'

export async function handleEnterpriseKnowledgeLink(event: H3Event) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const { envelope, command } = await requireEnterpriseKnowledgeLink(event, 'codocs')
  const data = await callCodocsTenantRuntime(event, '/v1/codocs/service/enterprise-knowledge-links', { method: 'POST', scope: 'codocs:knowledge-link:create', serviceTokenSourceBinding: 'service-client-policy', serviceCommandActor: { uid: command.actorUid }, body: { serviceCommand: envelope } })
  return { code: 0, data }
}
