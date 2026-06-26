import { createError, type H3Event } from 'h3'

type IssueRecord = {
  id?: string
  displayNo?: number
  title?: string
  description?: string
  appCode?: string
  repoId?: string
  pageUrl?: string
  pageKey?: string
  reporterUid?: string
  linkedJobId?: string
}

type ClaimRecord = {
  claimed?: boolean
  alreadyLinked?: boolean
  issue?: IssueRecord
}

export type ClaimOutcome = {
  claimed: boolean
  jobId?: string
  issue?: unknown
}

const CODEX_TEMPLATE_IDS = ['codex.app-server', 'codex.exec']

type AgentEnrollment = {
  templates?: Array<{
    id?: string
    type?: string
  }>
}

function unwrap<T>(result: unknown): T {
  return ((result as { data?: unknown })?.data ?? result) as T
}

function buildPrompt(id: string, issue: IssueRecord) {
  return [
    `【WebDev Issue #${issue.displayNo ?? id}】${issue.title || ''}`.trim(),
    issue.description ? `\n${issue.description}` : '',
    `\n来源应用：${issue.appCode || '-'}`,
    issue.pageUrl || issue.pageKey ? `；页面：${issue.pageUrl || issue.pageKey}` : '',
    '\n\n请定位根因并修复，补充必要测试后运行检查、提交任务分支。'
  ].filter(Boolean).join('')
}

async function resolveCodexTemplateId(event: H3Event) {
  try {
    const enrollment = await devAgentFetch<AgentEnrollment>(event, '/runtime/enrollment')
    const templates = Array.isArray(enrollment.templates) ? enrollment.templates : []
    return CODEX_TEMPLATE_IDS
      .map(id => templates.find(template => template.id === id)?.id)
      .find(Boolean)
      || templates.find(template => template.type === 'codex_task')?.id
      || ''
  } catch {
    return ''
  }
}

/**
 * 领取 Issue 并创建 Dev Agent 任务（幂等）：
 * 1. 原子抢占领取锁；已关联则返回现有 job。
 * 2. 用确定性 claim_token 作为 Dev Agent clientRequestId 建 job，避免重试/并发重复执行。
 * 3. 回填 linked_job_id、state→in_progress；建 job 失败则回滚领取锁。
 */
export async function claimIssueAndCreateJob(
  event: H3Event,
  id: string,
  opts: { actor: string, autoClaimed?: boolean, createdBy?: string }
): Promise<ClaimOutcome> {
  const claimToken = `issue-${id}`

  const issue = unwrap<IssueRecord>(
    await dataRuntimeFetch(event, `/v1/webdev/issues/${encodeURIComponent(id)}`)
  )

  const claim = unwrap<ClaimRecord>(
    await dataRuntimeFetch(event, `/v1/webdev/issues/${encodeURIComponent(id)}/claim`, {
      method: 'POST',
      body: { claimToken, actor: opts.actor, autoClaimed: Boolean(opts.autoClaimed) }
    })
  )

  if (!claim.claimed) {
    if (claim.alreadyLinked && claim.issue) {
      return { claimed: false, jobId: claim.issue.linkedJobId, issue: claim.issue }
    }
    throw createError({ statusCode: 409, statusMessage: 'Issue 当前不可领取' })
  }

  let job: Record<string, unknown>
  try {
    const templateId = await resolveCodexTemplateId(event)
    job = await devAgentFetch<Record<string, unknown>>(event, '/v1/jobs', {
      method: 'POST',
      body: {
        type: 'codex_task',
        ...(templateId ? { templateId } : {}),
        prompt: buildPrompt(id, issue),
        clientRequestId: claimToken
      }
    })
  } catch (error) {
    await dataRuntimeFetch(event, `/v1/webdev/issues/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { state: 'open', claimToken: '', actor: opts.actor }
    }).catch(() => {})
    throw error
  }

  const jobId = String(job.id || '')
  await persistJobSnapshot(event, { ...job, createdBy: opts.createdBy })

  const updated = unwrap<unknown>(
    await dataRuntimeFetch(event, `/v1/webdev/issues/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: {
        state: 'in_progress',
        linkedJobId: jobId,
        claimedAt: new Date().toISOString(),
        actor: opts.actor
      }
    })
  )

  // 通知反馈人：已创建修复任务（best-effort）
  await notifyIssueUpdate(event, { ...issue, id, state: 'in_progress' }, { eventType: 'claimed' })

  return { claimed: true, jobId, issue: updated }
}
