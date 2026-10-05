import { owningCreateError as createError, type OwningH3Event as H3Event } from '@hzy/foundation/server/utils/owningModuleHttp'
import { getCodocsProjectDocumentContent } from '../../../server/utils/codocsApi'
import { documentActor, hostProjectDocumentContext, type HostProjectDocumentContext, type DocumentReadPermitProvider } from './projectDocumentPorts'

// Aims verifies exact project/UUID association through U before any independent
// Codocs read. Codocs retains its own ACL and the P1 dual-source contract.
export function readHostProjectDocumentContent(event: H3Event, provider: DocumentReadPermitProvider, projectId: string, uuid: string, contextOnly: true): Promise<HostProjectDocumentContext>
export function readHostProjectDocumentContent(event: H3Event, provider: DocumentReadPermitProvider, projectId: string, uuid: string): ReturnType<typeof getCodocsProjectDocumentContent>
export async function readHostProjectDocumentContent(event: H3Event, provider: DocumentReadPermitProvider, projectId: string, uuid: string, contextOnly = false) {
  if (!/^[1-9]\d*$/.test(projectId) || !Number.isSafeInteger(Number(projectId)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid) || uuid === '00000000-0000-0000-0000-000000000000') throw createError({ statusCode: 400, message: '项目文档标识无效' })
  const user = await documentActor(event, 'view')
  const context = await hostProjectDocumentContext(event, provider, projectId, undefined, undefined, uuid)
  if (!context.isMember || context.documentUuid !== uuid || !context.projectCode) throw createError({ statusCode: 403, message: '该文档未关联到当前项目或无成员权限' })
  if (contextOnly) return context
  return await getCodocsProjectDocumentContent({ event, actorUid: user.uid, projectCode: context.projectCode, documentUuid: uuid, sourceApp: 'enterprise' })
}
