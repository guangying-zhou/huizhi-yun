import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{assertMigratedPage}from'./helpers/migrated-page.mjs';const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8')
test('board bridge is scope-bound and read only',()=>{const bff=read('server/utils/enterpriseAimsProjectBoard.ts'),runtime=read('../data-runtime/internal/apps/aims/project_work_items.go');assert.match(bff,/work_items','view'/);assert.match(bff,/enterpriseAimsProjectScope/);assert.match(runtime,/boardQuery\.Set\("view", "board"\)/);assert.match(runtime,/boardQuery\.Set\("tier", "matter"\)/);assert.match(runtime,/project\.Category == "routine"/);assert.doesNotMatch(bff,/(?:POST|PATCH|DELETE)/)})
test('board route serves the original Aims page with a host-safe closure',()=>{
  assertMigratedPage({ route: '/projects/:id/board', name: 'project-board', source: 'projects/[id]/board' })
})
