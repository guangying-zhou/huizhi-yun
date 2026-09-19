import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { getCodocsProjectDocumentContent } from '../../../aims/server/utils/codocsApi'
import { assertCodocsProjectDocumentAccess } from '../../../aims/server/utils/projectDocumentAccess'

// ADR-018 §2 范围表：Codocs 首轮保留现有运行边界，因此这里是真实的跨应用调用，
// 不是把 Codocs 并入宿主。§3.2 要求宿主身份映射由正式契约覆盖，且不得通过放宽
// 校验兼容 —— 所以 codocs 侧新增了与 Aims 并列的 enterprise 授权条目
// （ENTERPRISE_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH），scope 与 operationCode 相同，
// 只有 allowedApps / allowedClientCodes 不同。
//
// 这个常量同时是 readiness 策略推导宿主 codocs 能力的事实源。
const requiredCapability = 'codocs:project-document:content:read'
const audience = 'codocs'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const numericID = /^[1-9]\d*$/

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function enterpriseCodocsProjectDocumentContract() {
  return { audience, requiredCapability }
}

export async function enterpriseCodocsProjectDocumentContent(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)

  const uuid = text(getRouterParam(event, 'uuid'))
  if (!uuidPattern.test(uuid) || uuid === '00000000-0000-0000-0000-000000000000') {
    throw createError({ statusCode: 400, message: '文档标识无效' })
  }
  const query = getQuery(event)
  const projectId = text(String(query.projectId ?? query.project_id ?? ''))
  if (!numericID.test(projectId)) {
    throw createError({ statusCode: 400, message: '缺少项目 ID，无法校验项目文档访问权限' })
  }
  const preview = query.preview === '1' || query.preview === 'true'
  const fallbackTitle = text(String(query.title ?? ''))

  // 项目文档访问权限先在本域判定，再去 Codocs 取正文；失败时预览模式降级而不是抛错，
  // 与独立应用一致。
  let context: { title?: string, projectCode?: string } | null = null
  try {
    context = await assertCodocsProjectDocumentAccess(event, Number(projectId), uuid, user.uid)
  } catch (error) {
    if (!preview) throw error
    return {
      code: 0,
      data: {
        uuid, title: fallbackTitle || '文档', docType: '', ownerUid: '', content: '', updatedAt: '',
        contentUnavailable: true,
        message: (error as { message?: string })?.message || '暂时无法校验项目文档访问权限'
      }
    }
  }

  try {
    const result = await getCodocsProjectDocumentContent({
      event,
      actorUid: user.uid,
      projectCode: context?.projectCode || '',
      documentUuid: uuid,
      sourceApp: 'enterprise'
    })
    return { code: 0, data: result }
  } catch (error) {
    if (!preview) throw error
    return {
      code: 0,
      data: {
        uuid, title: context?.title || fallbackTitle || '文档', docType: '', ownerUid: '', content: '', updatedAt: '',
        contentUnavailable: true,
        message: (error as { message?: string })?.message || '暂时无法读取文档内容'
      }
    }
  }
}
