import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { announcementDismissalKey } from '../app/utils/announcement-dismissal.ts'

const scope = (uid = 'fixture-user', policy = 'rev1', tenant = 'T1', deployment = 'D1') => JSON.stringify([tenant, uid, uid, policy, deployment])
const item = { id: 'announcement-fixture', revision: 1 }
test('announcement dismissal is per user, tenant, deployment and announcement revision, not policy revision', () => {
  const key = announcementDismissalKey(scope(), item)
  assert.ok(key)
  assert.equal(key, announcementDismissalKey(scope('fixture-user', 'rev2'), item))
  for (const other of [scope('another-user'), scope('fixture-user', 'rev1', 'T2'), scope('fixture-user', 'rev1', 'T1', 'D2')]) {
    assert.notEqual(key, announcementDismissalKey(other, item))
  }
  assert.notEqual(key, announcementDismissalKey(scope(), { ...item, revision: 2 }))
  assert.notEqual(key, announcementDismissalKey(scope(), { ...item, id: 'another-announcement' }))
})
test('unverified or invalid identity/revision cannot use a shared dismissal bucket', () => {
  for (const invalid of ['', '{}', 'null', '[]', '["T1", ""]']) assert.equal(announcementDismissalKey(invalid, item), undefined)
  assert.equal(announcementDismissalKey(scope(), { ...item, revision: 0 }), undefined)
})
test('topbar owns the closable announcement summary; popup and list remain reachable', () => {
  const source = readFileSync(new URL('../app/components/HostAnnouncements.vue', import.meta.url), 'utf8')
  assert.ok(compileScript(parse(source).descriptor, { id: 'announcement', inlineTemplate: true }).content)
  assert.match(source, /banner && !props.titleVisible/)
  assert.match(source, /localStorage.setItem\(key, '1'\)/)
  assert.match(source, /localStorage.getItem\(key\)/)
  assert.match(source, /watch\(\[scope, data\], loadDismissed/)
  assert.match(source, /hidden min-w-0 truncate sm:block/)
  assert.match(source, /@click="dismissBanner\(banner\)"/)
  assert.match(source, /\/enterprise\/announcements\/\$\{banner.id\}/)
  assert.match(source, /await markRead\(popup.value.id\)/)
  assert.doesNotMatch(source, /border-b px-4 py-2/)
  const layout = readFileSync(new URL('../app/layouts/default.vue', import.meta.url), 'utf8')
  const header = layout.slice(layout.indexOf('<header'), layout.indexOf('</header>'))
  assert.match(header, /<HostAnnouncements\s+v-if="signedIn && config\.public\.announcementsEnabled"\s+:title-visible="pinnedTitle.visible"/)
  assert.equal((layout.match(/<HostAnnouncements/g) || []).length, 1)
  assert.match(layout, /系统公告.*\/enterprise\/announcements/)
})
