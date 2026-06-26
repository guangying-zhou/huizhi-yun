export interface ReceivableOverdueNotice {
  id: number
  code?: string | null
  plan_name?: string | null
  amount: number
  received_amount?: number | null
  overdue_days: number
  planned_payment_date?: string | null
  owner_user_id?: string | null
  contract_owner_user_id?: string | null
  contract_code?: string | null
  contract_name?: string | null
}

export interface OpportunityStaleNotice {
  id: number
  code: string
  name: string
  owner_user_id?: string | null
  days_stale: number
}

export interface LeadAssignedNotice {
  id: number
  code?: string | null
  name: string
  owner_user_id?: string | null
}

export interface OpportunityAssignedNotice {
  id: number
  code?: string | null
  name: string
  owner_user_id?: string | null
  customer_name?: string | null
  amount_tax_inclusive?: number | string | null
}

function buildAltocUrl(path: string): string {
  const config = useRuntimeConfig()
  const publicConfig = (config.public || {}) as {
    deploymentPublicUrl?: string
    appBasePath?: string
  }
  const appBasePath = String(publicConfig.appBasePath || '/altoc/').replace(/\/?$/, '/')
  const baseUrl = String(publicConfig.deploymentPublicUrl || `http://localhost:3003${appBasePath}`).replace(/\/$/, '')
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
}

function formatNotifyError(error: unknown): unknown {
  return error instanceof Error ? error.message : error
}

function codePrefix(code: string | null | undefined) {
  const text = String(code || '').trim()
  return text ? `[${text}] ` : ''
}

export async function notifyLeadAssignedItem(
  lead: LeadAssignedNotice | null | undefined,
  assignerUid: string
): Promise<number> {
  const assigneeUid = String(lead?.owner_user_id || '').trim()
  if (!lead || !assigneeUid || assigneeUid === assignerUid) return 0

  try {
    await sendNotification({
      touser: assigneeUid,
      title: '有新线索分配给你',
      description: `${codePrefix(lead.code)}${lead.name}\n分配人: ${assignerUid}`,
      url: buildAltocUrl(`/leads/${lead.id}`),
      btntxt: '查看线索'
    })
    return 1
  } catch (error: unknown) {
    console.error('[RuntimeNotifications] notifyLeadAssignedItem failed:', formatNotifyError(error))
    return 0
  }
}

export async function notifyOpportunityAssignedItem(
  opportunity: OpportunityAssignedNotice | null | undefined,
  assignerUid: string
): Promise<number> {
  const assigneeUid = String(opportunity?.owner_user_id || '').trim()
  if (!opportunity || !assigneeUid || assigneeUid === assignerUid) return 0

  try {
    const amount = Number(opportunity.amount_tax_inclusive || 0)
    const amountText = Number.isFinite(amount) && amount > 0
      ? `¥${amount.toLocaleString('zh-CN')}`
      : '金额待定'
    const customerText = opportunity.customer_name ? ` / ${opportunity.customer_name}` : ''

    await sendNotification({
      touser: assigneeUid,
      title: '有新商机分配给你',
      description: `${codePrefix(opportunity.code)}${opportunity.name}${customerText}\n预期金额: ${amountText}\n分配人: ${assignerUid}`,
      url: buildAltocUrl(`/opportunities/${opportunity.id}`),
      btntxt: '查看商机'
    })
    return 1
  } catch (error: unknown) {
    console.error('[RuntimeNotifications] notifyOpportunityAssignedItem failed:', formatNotifyError(error))
    return 0
  }
}

export async function notifyReceivableOverdueItems(
  rows: ReceivableOverdueNotice[]
): Promise<number> {
  if (rows.length === 0) return 0

  try {
    const byOwner = new Map<string, ReceivableOverdueNotice[]>()
    for (const row of rows) {
      const owner = String(row.owner_user_id || row.contract_owner_user_id || '').trim()
      if (!owner) continue
      const list = byOwner.get(owner) || []
      list.push(row)
      byOwner.set(owner, list)
    }

    for (const [ownerUid, list] of byOwner) {
      const totalOutstanding = list.reduce(
        (sum, row) => sum + (Number(row.amount || 0) - Number(row.received_amount || 0)),
        0
      )
      const maxDays = Math.max(...list.map(row => Number(row.overdue_days || 0)))
      const previewList = list.slice(0, 3).map((row, index) => {
        const context = row.contract_code
          ? `[${row.contract_code}] ${row.contract_name || ''}`
          : (row.plan_name || `回款 #${row.id}`)
        const outstanding = Number(row.amount || 0) - Number(row.received_amount || 0)
        return `${index + 1}. ${context} 欠款 ¥${outstanding.toLocaleString('zh-CN')} (${row.overdue_days}天)`
      }).join('\n')
      const more = list.length > 3 ? `\n...等共 ${list.length} 条` : ''

      await sendNotification({
        touser: ownerUid,
        title: `你有 ${list.length} 笔回款已逾期`,
        description: `累计未收: ¥${totalOutstanding.toLocaleString('zh-CN')}\n最长逾期: ${maxDays} 天\n\n${previewList}${more}`,
        url: buildAltocUrl('/payments?status=overdue'),
        btntxt: '立即处理'
      })
    }

    return byOwner.size
  } catch (error: unknown) {
    console.error('[RuntimeNotifications] notifyReceivableOverdueItems failed:', formatNotifyError(error))
    return 0
  }
}

export async function notifyOpportunityStaleItems(
  rows: OpportunityStaleNotice[]
): Promise<number> {
  if (rows.length === 0) return 0

  try {
    const byOwner = new Map<string, OpportunityStaleNotice[]>()
    for (const row of rows) {
      const owner = String(row.owner_user_id || '').trim()
      if (!owner) continue
      const list = byOwner.get(owner) || []
      list.push(row)
      byOwner.set(owner, list)
    }

    for (const [ownerUid, list] of byOwner) {
      const preview = list.slice(0, 3).map((row, index) =>
        `${index + 1}. [${row.code}] ${row.name} (${row.days_stale}天未跟进)`
      ).join('\n')
      const more = list.length > 3 ? `\n...等共 ${list.length} 条` : ''

      await sendNotification({
        touser: ownerUid,
        title: `你有 ${list.length} 个商机超期未跟进`,
        description: `请及时更新跟进状态：\n\n${preview}${more}`,
        url: buildAltocUrl('/opportunities?view=stale'),
        btntxt: '立即跟进'
      })
    }

    return byOwner.size
  } catch (error: unknown) {
    console.error('[RuntimeNotifications] notifyOpportunityStaleItems failed:', formatNotifyError(error))
    return 0
  }
}
