import { createError } from 'h3'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'

// 跨应用引用扫描尚未产品化前，禁止从浏览器执行不可逆的主体归并。
// 预览仍可使用；实际变更必须按 runbook 完成全应用核查和分阶段审计。
export default defineEventHandler(async (event) => {
  await assertPeoplePermission(event, 'employees', 'admin')
  throw createError({
    statusCode: 410,
    statusMessage: 'people_subject_merge_manual_only',
    message: '跨应用主体归并已禁止在线执行；请按 docs/runbooks/dt-uid-merge.md 完成全应用核查后走审计运维流程。'
  })
})
