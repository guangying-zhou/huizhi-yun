import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const layout = readFileSync(
  new URL('../app/layouts/default.vue', import.meta.url),
  'utf8'
)
const projectDocuments = readFileSync(
  new URL('../app/pages/projects/index.vue', import.meta.url),
  'utf8'
)

test('Shell 嵌入时刷新由 Shell 承担且仅移动端动作不保留桌面标题栏', () => {
  assert.match(layout, /visibleHeaderActions\.value\.length === 0/)
  assert.match(layout, /!applicationShellEmbedded\.value/)
  assert.match(layout, /:embedded-navbar-mobile-only="embeddedNavbarMobileOnly"/)
  assert.match(layout, /:hide-navbar-when-embedded="hideEmbeddedNavbar"/)
})

test('项目组文档只在移动端或目录折叠时保留页面工具栏', () => {
  assert.match(
    projectDocuments,
    /:class="panelCollapsed \? 'flex' : 'flex md:hidden'"/
  )
})
