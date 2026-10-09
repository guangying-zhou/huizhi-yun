import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../app/components/LayoutSidebar.vue', import.meta.url),
  'utf8'
)

test('LayoutSidebar can hide a landing-page subtitle without affecting other pages', () => {
  assert.match(source, /hidePageTitle\?: boolean/)
  assert.match(source, /pageTitle && !hidePageTitle/)
})

test('seamless header starts the sidebar divider below the brand row', () => {
  assert.match(source, /seamlessTopHeader\?: boolean/)
  assert.match(source, /showStaticSidebarBorder && !seamlessTopHeader/)
  assert.match(source, /showStaticSidebarBorder && seamlessTopHeader \? 'border-r border-default'/)
})

test('embedded page navbar can be hidden without affecting standalone or approval mode', () => {
  assert.match(source, /hideNavbarWhenEmbedded\?: boolean/)
  assert.match(
    source,
    /const renderPageNavbar = computed/
  )
  assert.match(source, /!props\.hideNavbarWhenEmbedded/)
  assert.match(source, /\|\| isApprovalMode\.value/)
  assert.match(source, /v-if="renderPageNavbar"/)
})

test('a page can explicitly hide its navbar while preserving approval mode', () => {
  assert.match(source, /hideNavbar\?: boolean/)
  assert.match(source, /!props\.hideNavbar/)
  assert.match(source, /isApprovalMode\.value\s*\|\|/)
})

test('embedded page navbar can remain available only on mobile for mobile-only actions', () => {
  assert.match(source, /embeddedNavbarMobileOnly\?: boolean/)
  assert.match(
    source,
    /applicationShellEmbedded && embeddedNavbarMobileOnly && !isApprovalMode \? 'md:hidden'/
  )
})

test('embedded page navbar hides blank and refresh-only rows while retaining business actions', () => {
  assert.match(source, /autoHideEmptyNavbarWhenEmbedded\?: boolean/)
  assert.match(source, /autoHideEmptyNavbarWhenEmbedded: true/)
  assert.match(
    source,
    /querySelectorAll\('\[data-page-refresh\], \[data-slot="toggle"\], \[data-slot="left"\] > button'\)/
  )
  assert.match(source, /navbarHasBusinessContent/)
  assert.match(source, /v-show="showPageNavbar"/)
  assert.match(source, /data-page-refresh/)
  assert.match(source, /hzy-embedded-auto-hide-navbar/)
  assert.match(source, /:has\(\[data-slot="left"\] > :not\(button\):not\(:empty\)\)/)
  assert.match(source, /:has\(\[data-slot="right"\] > :not\(\[data-page-refresh\]\):not\(:empty\)\)/)
})
