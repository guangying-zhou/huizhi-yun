import { createError, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'

// The Codocs document index pages at most 100 rows (paged reads reject a larger
// pageSize with 400). Calendar views need every matching row of a narrow filter,
// so read successive pages under the same signed actor, with a hard page bound.
export const personalDocumentPageSize = 100
const maxPages = 10

type PersonalDocumentRow = Record<string, unknown>
interface Actor { uid: string, tenant: string, deployment: string }

export async function listAllPersonalDocuments(event: H3Event, user: Actor, filter: Record<string, string>) {
  const rows: PersonalDocumentRow[] = []
  for (let page = 1; page <= maxPages; page++) {
    const result = await callEnterpriseRuntime<{ data?: { items?: PersonalDocumentRow[], total?: number } }>(event, 'codocs.personal-document-list', {
      tenant: user.tenant, deployment: user.deployment,
      query: { ...filter, page: String(page), pageSize: String(personalDocumentPageSize) },
      authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'personal-documents', action: 'read', expiresAt: enterpriseRuntimePermitExpiresAt() }
    })
    const items = Array.isArray(result?.data?.items) ? result.data.items : []
    rows.push(...items)
    const total = Number(result?.data?.total)
    if (items.length < personalDocumentPageSize || (Number.isFinite(total) && rows.length >= total)) return rows
  }
  // Never present a silently truncated calendar as complete.
  throw createError({ statusCode: 422, message: '匹配的文档过多，请缩小时间范围' })
}
