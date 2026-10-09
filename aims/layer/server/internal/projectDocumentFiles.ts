import { owningCreateError as createError, type OwningH3Event as H3Event } from '@hzy/foundation/server/utils/owningModuleHttp'
import { checkCodocsDocumentAccess, getCodocsProjectCabinetDownloadUrl, getCodocsProjectCabinetPreviewUrl } from '../../../server/utils/codocsApi'
import { documentActor, hostProjectDocumentContext, type DocumentReadPermitProvider } from './projectDocumentPorts'

export async function readHostProjectDocumentFile(event: H3Event, provider: DocumentReadPermitProvider, action: 'preview' | 'download', projectId: string, documentId: string) {
  const user = await documentActor(event, 'view')
  const context = await hostProjectDocumentContext(event, provider, projectId, documentId)
  const access = await checkCodocsDocumentAccess({ event, documentUuid: context.documentUuid!, documentRefType: context.documentRefType!, sourceProjectCode: context.projectCode,
    action: action === 'download' ? 'download' : 'view', actorUid: user.uid, actorProjectCodes: context.actorProjectCodes, actorDeptCodes: context.actorDeptCodes, actorRoles: context.actorRoles })
  if (!access.allowed) throw createError({ statusCode: 403, message: '无权访问该文档文件' })
  if (context.documentRefType !== 'cabinet_file') throw createError({ statusCode: 400, message: '当前文档不支持文件柜访问' })
  const document = context.document!
  const params = { event, fileUuid: context.documentUuid!, projectCode: context.projectCode, expectedOssPath: String(document.ossPath ?? document.oss_path ?? document.repoFilePath ?? document.repo_file_path ?? '').trim() }
  if (action === 'download') return { code: 0, data: { url: (await getCodocsProjectCabinetDownloadUrl(params)).url } }
  return { code: 0, data: { ...await getCodocsProjectCabinetPreviewUrl(params), access } }
}
