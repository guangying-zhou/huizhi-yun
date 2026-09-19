import test from 'node:test'
import { assertMigratedPage } from './helpers/migrated-page.mjs'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8')
test('project plan BFF requires both plan permissions and preserves scoped project identity',()=>{const source=read('server/utils/enterpriseAimsProjectPlan.ts');assert.match(source,/\['milestones','work_items'\]/);assert.match(source,/authorizationResourcesAllow/);assert.match(source,/enterpriseAimsProjectScope/);assert.match(source,/projectId/);assert.doesNotMatch(source,/method:\s*['"](?:POST|PATCH|DELETE)/)})
test('project plan route serves the original Aims page with a host-safe closure',()=>{
  // 原断言锁的是薄改写页"仅供读取"。切到原页面后该前提不成立（原计划页含里程碑
  // 周期开启等写操作）。rollover 走 Aims 的 service 路径、Runtime 不做逐用户判定，
  // 因此额外要求宿主 BFF 自行判定项目经理或范围管理员。
  assertMigratedPage({ route: '/projects/:id/plan', name: 'project-plan', source: 'projects/[id]/plan' })
  const bff=read('server/utils/enterpriseAimsPlanActions.ts')
  assert.match(bff,/currentUserRole/)
  assert.match(bff,/仅项目经理或具备该项目范围管理权限的用户可以开启下一周期/)
  assert.match(bff,/Runtime 这条路径不做逐用户判定/)
})
