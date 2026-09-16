import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const layout = readFileSync(
  new URL('../app/layouts/default.vue', import.meta.url),
  'utf8'
)
const permissions = readFileSync(
  new URL('../app/config/permissions.ts', import.meta.url),
  'utf8'
)

test('使用指南保留在系统管理下方的左侧业务菜单中', () => {
  assert.match(
    permissions,
    /label:\s*'系统管理'[\s\S]*label:\s*'使用指南'/
  )
  assert.match(layout, /const utilityLinks = computed\(\(\) => links\.value\[1\] \|\| \[\]\)/)
  assert.doesNotMatch(layout, /guideDropdownItems/)
  assert.doesNotMatch(layout, /aria-label="使用指南"/)
})
