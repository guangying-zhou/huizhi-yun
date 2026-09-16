import { createError } from 'h3'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

// 跨应用引用扫描与可恢复编排尚未产品化，Console 半边也必须 fail-closed；
// 否则绕过 People BFF 仍可先停用旧主体，留下不可原子回滚的跨库半完成状态。
export default defineEventHandler(async (event) => {
  await requireConsoleServiceActor(event, 'console', 'console:directory-user:provision', {
    requireBoundTargetApp: true
  })
  throw createError({
    statusCode: 410,
    statusMessage: 'console_subject_merge_manual_only',
    message: 'Cross-application subject merge is disabled; use the audited migration runbook.'
  })
})
