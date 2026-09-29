import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const page = readFileSync(new URL('../app/pages/timesheet.vue', import.meta.url), 'utf8')
const hostCss = readFileSync(new URL('../../enterprise/app/assets/css/main.css', import.meta.url), 'utf8')

test('only the calendar block scrolls sideways and desktop keeps the full week', () => {
  assert.doesNotMatch(page, /min-w-\[72rem\]/, 'a 72rem week cuts Sat/Sun off the 1440 Host content area')
  // The content area scrolls vertically only, so title, alerts and hint never move sideways.
  assert.match(page, /class="@container min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4"/)
  assert.doesNotMatch(page, /class="min-h-0 flex-1 overflow-auto p-4"/)
  const scroll = page.indexOf('data-testid="timesheet-calendar-scroll"')
  assert.notEqual(scroll, -1)
  const scroller = page.slice(page.lastIndexOf('<div', scroll), scroll)
  assert.match(scroller, /overflow-x-auto/)
  // Seven responsive columns inside a bounded minimum width (608px) fit the
  // 1440 Host content area (~832px) without scrolling; narrower blocks scroll.
  assert.match(page.slice(scroll, scroll + 200), /<div class="min-w-\[38rem\] space-y-2">/)
  // The hint follows the same container width as the scrolling block.
  assert.match(page, /class="mb-2 text-xs text-muted @min-\[38rem\]:hidden" data-testid="timesheet-calendar-scroll-hint"/)
})

test('the composed Host generates the timesheet utility classes', () => {
  assert.match(hostCss, /@source "\.\.\/\.\.\/\.\.\/\.\.\/aims\/app\/pages\/timesheet\.vue";/)
})
