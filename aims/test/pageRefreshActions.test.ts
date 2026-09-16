import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const refreshPages = [
  'app/pages/project-resources.vue',
  'app/pages/weekly-reports.vue',
  'app/pages/admin/projects.vue',
  'app/pages/projects/[id]/requirements/index.vue',
  'app/pages/projects/[id]/documents.vue',
  'app/pages/projects/[id]/board/[workItemId]/execution.vue',
  'app/pages/quality-reviews.vue'
]

describe('Aims unified page refresh', () => {
  test('layout renders the registered refresh action in the shared header', () => {
    const layout = source('app/layouts/default.vue')

    assert.match(layout, /const \{ refreshHandler \} = usePageActions\(\)/)
    assert.match(layout, /:refresh-handler="refreshHandler \|\| undefined"/)
    assert.match(layout, /v-if="refreshHandler"[\s\S]*data-page-refresh[\s\S]*@click="refreshHandler\?\.\(\)"/)
  })

  test('affected pages register and clear their page refresh handlers', () => {
    for (const path of refreshPages) {
      const page = source(path)

      assert.match(page, /const \{ setRefresh, clearRefresh \} = usePageActions\(\)/, path)
      assert.match(page, /setRefresh\(/, path)
      assert.match(page, /onBeforeUnmount\([\s\S]*clearRefresh/, path)
      assert.doesNotMatch(page, /icon="i-lucide-refresh-cw"/, path)
    }
  })

  test('context-specific actions remain distinct from page refresh', () => {
    const requirements = source('app/pages/projects/[id]/requirements/index.vue')
    const documents = source('app/pages/projects/[id]/documents.vue')
    const execution = source('app/pages/projects/[id]/board/[workItemId]/execution.vue')

    assert.match(requirements, /icon="i-lucide-rotate-ccw"[\s\S]*label="重新准备评审"/)
    assert.match(documents, /icon="i-lucide-list-restart"[\s\S]*@click="loadAccessAuditLogs\(accessAuditPage\)"/)
    assert.match(execution, /label="同步 GitLab"[\s\S]*icon="i-lucide-git-pull-request-arrow"[\s\S]*@click="syncGitlab"/)
  })

  test('admin header actions collapse their labels on narrow screens', () => {
    const adminProjects = source('app/pages/admin/projects.vue')
    const responsiveLabels = adminProjects.match(/:ui="\{ label: 'hidden sm:inline' \}"/g) || []

    assert.equal(responsiveLabels.length, 3)
    assert.match(adminProjects, /aria-label="批量创建部门事务项目"/)
    assert.match(adminProjects, /aria-label="新建项目集"/)
    assert.match(adminProjects, /aria-label="新建项目"/)
  })
})
