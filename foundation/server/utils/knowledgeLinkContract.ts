import { createError } from 'h3'

export type KnowledgeTarget = 'assets' | 'codocs'
export const knowledgeLinkCapability = (target: KnowledgeTarget) => target === 'assets' ? 'assets:asset-link:create' : 'codocs:knowledge-link:create'
/** Authentication/introspection already verified the audience, JWT and live grant. */
export function assertKnowledgeIdentity(auth: { authenticated: boolean, tokenUse?: string, subjectType?: string, appCode?: string, clientCode?: string, scopes?: string[], tenant?: string, deployment?: string }, gateway: { appCode: string, tenant: string, deployment: string } | null, target: KnowledgeTarget) {
  if (!auth.authenticated || auth.tokenUse !== 'service' || auth.subjectType !== 'service') throw createError({ statusCode: 401 })
  if (auth.appCode !== 'enterprise' || auth.clientCode !== 'enterprise.runtime' || !auth.scopes?.includes(knowledgeLinkCapability(target)) || !auth.tenant || !auth.deployment || !gateway || gateway.appCode !== target || gateway.tenant !== auth.tenant || !gateway.deployment) throw createError({ statusCode: 403, message: '知识关联服务身份不匹配' })
}
/** Fixed all-string command matches Go encoding/json; never hash caller extras. */
export function canonicalKnowledgeCommand(command: Record<string, unknown>) {
  const fields = ['actorUid', 'action', 'ticketCode', 'documentUuid', 'customerCode', 'contractCode', 'projectCode', 'deliveryCode', 'deliveryAssetCode', 'environmentCode', 'targetDeployment'] as const
  if (!command || Object.keys(command).length !== fields.length || fields.some(k => typeof command[k] !== 'string' || !command[k] || (command[k] as string).trim() !== command[k] || (command[k] as string).length > 128 || /[\p{Cc}<>\u2028\u2029&]/u.test(command[k] as string)) || command.action !== 'link' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(command.documentUuid))) throw createError({ statusCode: 403, message: '知识关联命令无效' })
  return Object.fromEntries(Object.entries(command).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) as Record<typeof fields[number], string>
}
