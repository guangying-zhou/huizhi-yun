import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('announcement surfaces retain entry loading without recurring data refresh', () => {
  const component = readFileSync(new URL('../app/components/HostAnnouncements.vue', import.meta.url), 'utf8')
  assert.match(component, /onMounted\(refresh\)/)
  assert.match(component, /watch\(scope, refresh\)/)
  assert.doesNotMatch(component, /useIntervalFn|setInterval|setTimeout/)
  assert.match(component, /@click="refresh"/)
})

test('announcements have no scheduler grant and expose only Host administration', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../console/app.manifest.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.resources.find(r => r.code === 'announcements').actions, ['view', 'admin'])
  assert.ok(!manifest.resources.some(r => r.code === 'scheduler'))
  assert.ok(!manifest.recommendedRoles.some(r => r.code === 'console:announcement_reader'))
  const seed = readFileSync(new URL('../../console/docs/sql/Console-SQL-Seed-v2.40-announcements.sql', import.meta.url), 'utf8')
  assert.doesNotMatch(seed, /INSERT INTO service_client_grants/)
  const independent = readFileSync(new URL('../../console/app/pages/announcements.vue', import.meta.url), 'utf8')
  assert.match(independent, /to="\/enterprise\/announcements\/manage"/)
  assert.doesNotMatch(independent, /useFetch|\$fetch/)
})

test('unapproved production announcement surface stays unmounted', () => {
  const config = readFileSync(new URL('../nuxt.config.ts', import.meta.url), 'utf8')
  const layout = readFileSync(new URL('../app/layouts/default.vue', import.meta.url), 'utf8')
  assert.match(config, /announcementsEnabled: process\.env\.HZY0_LOCAL_ENTERPRISE === 'true' \|\| process\.env\.HZY_ENTERPRISE_ANNOUNCEMENTS_ENABLED === 'true'/)
  assert.match(layout, /v-if="signedIn && config\.public\.announcementsEnabled"/)
})
