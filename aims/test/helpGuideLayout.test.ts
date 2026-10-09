import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Aims PIVR guide and embedded header', () => {
  test('utility navigation exposes the guide after system management', () => {
    const navigation = source('app/config/navigation.ts')
    const systemManagement = navigation.indexOf('label: \'系统管理\'')
    const guide = navigation.indexOf('label: \'使用指南\'')

    assert.notEqual(systemManagement, -1)
    assert.notEqual(guide, -1)
    assert.ok(systemManagement < guide)
    assert.match(navigation, /label: '使用指南'[\s\S]*to: '\/help\/pivr'/)
  })

  test('guide page renders the former PIVR modal content as a page', () => {
    const page = source('app/pages/help/pivr.vue')
    const content = source('app/components/PivrGuideContent.vue')

    assert.match(page, /layoutHeaderTitle: '使用指南'/)
    assert.match(page, /<PivrGuideContent/)
    assert.match(content, /PIVR\.md/)
    assert.match(content, /renderSafeMarkdown/)
  })

  test('layout removes the old help icon and hides title-only embedded headers', () => {
    const layout = source('app/layouts/default.vue')

    assert.doesNotMatch(layout, /<PivrHelpButton/)
    assert.match(layout, /layoutHeaderActions/)
    assert.match(layout, /:hide-navbar-when-embedded="hideEmbeddedNavbar"/)
    assert.match(layout, /const hideEmbeddedNavbar = computed\(\(\) => !resolvedHeaderActions\.value\)/)
    assert.doesNotMatch(layout, /projectSwitcherOpen/)
    assert.doesNotMatch(layout, /showHeaderProjectSwitcher/)
  })

  test('project navigation owns the project switcher beside the project name', () => {
    const navbar = source('app/components/project/ProjectNavbar.vue')
    const trigger = navbar.indexOf('aria-label="切换项目"')
    const projectName = navbar.indexOf('project.shortName || project.name')

    assert.notEqual(trigger, -1)
    assert.notEqual(projectName, -1)
    assert.ok(trigger < projectName)
    assert.match(navbar, /v-model:open="projectSwitcherOpen"/)
    assert.match(navbar, /await switchProject\(id\)/)
    assert.match(navbar, /placeholder="搜索项目\.\.\."/)
  })

  test('pages teleporting header actions explicitly retain the header', () => {
    for (const path of [
      'app/pages/admin/projects.vue',
      'app/pages/board.vue',
      'app/pages/projects/[id]/work-items/[workItemId]/breakdown.vue',
      'app/pages/projects/[id]/board/[workItemId]/execution.vue'
    ]) {
      const page = source(path)
      assert.match(page, /layoutHeaderActions: true/, `${path} must retain its header actions`)
      assert.match(page, /<Teleport to="#aims-layout-header-actions">/)
    }
  })
})
