import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{assertMigratedPage}from'./helpers/migrated-page.mjs';const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8')
test('weekly overview uses one scoped summary query',()=>{const source=read('../data-runtime/internal/apps/aims/project_weekly_report_summary.go'),bff=read('server/utils/enterpriseAimsWeeklyReportOverview.ts');assert.match(source,/projectVisibilityWhere\(query, "p", currentUser\)/);assert.match(source,/DB\(\)\.QueryContext/);assert.match(bff,/weekly_reports','view'/);assert.match(bff,/enterpriseAimsProjectScope/);assert.doesNotMatch(bff,/projects\/.+weekly-reports/)})
test('weekly report page serves the original Aims page with a host-safe closure',()=>{
  // 原断言锁的是薄改写页"不提供创建、提交、审阅或冻结"。按"复用原页面"切换后
  // 该前提不成立 —— 原周报页本就含审阅与纠错。改为守护迁移不变量，
  // 并保留 overview 端点仍不接受 uid 这一条真实边界。
  const runtime=read('../data-runtime/internal/server/enterprise_weekly_report_overview.go')
  assert.doesNotMatch(runtime,/case\s*"uid"/)
  assertMigratedPage({ route: '/weekly-reports', name: 'weekly-reports', source: 'weekly-reports' })
})
