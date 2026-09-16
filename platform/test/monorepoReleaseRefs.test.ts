import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildReleaseRefCandidates,
  normalizeManifestPath,
  normalizeReleaseTagPrefix,
  qualifyReleaseRef,
  releaseVersionFromTag
} from '../server/utils/appReleaseRefs.ts'

test('normalizes standalone and monorepo release source configuration', () => {
  assert.equal(normalizeReleaseTagPrefix(null), null)
  assert.equal(normalizeReleaseTagPrefix('/aims/'), 'aims/')
  assert.equal(normalizeManifestPath('aims/app.manifest.json'), 'aims/app.manifest.json')
  assert.equal(normalizeManifestPath('', 'custom.manifest.json'), 'custom.manifest.json')
  assert.throws(() => normalizeReleaseTagPrefix('../aims'))
  assert.throws(() => normalizeManifestPath('../app.manifest.json'))
})

test('qualifies namespaced tags while keeping app-local release versions', () => {
  assert.equal(qualifyReleaseRef('v1.2.3', 'aims/'), 'aims/v1.2.3')
  assert.equal(qualifyReleaseRef('aims/v1.2.3', 'aims/'), 'aims/v1.2.3')
  assert.equal(qualifyReleaseRef('v1.2.3', null), 'v1.2.3')
  assert.equal(releaseVersionFromTag('aims/v1.2.3', 'aims/'), 'v1.2.3')
  assert.equal(releaseVersionFromTag('v1.2.3', null), 'v1.2.3')
})

test('adds v to the tag leaf instead of before the monorepo namespace', () => {
  assert.deepEqual(buildReleaseRefCandidates('0.2.0'), ['0.2.0', 'v0.2.0'])
  assert.deepEqual(buildReleaseRefCandidates('aims/0.2.0'), ['aims/0.2.0', 'aims/v0.2.0'])
  assert.deepEqual(buildReleaseRefCandidates('aims/v0.2.0'), ['aims/v0.2.0'])
})

test('schema and import flow persist configured source provenance', () => {
  const schema = readFileSync(new URL('../docs/sql/HZY-Platform-SQL-DDL-Draft-v2.sql', import.meta.url), 'utf8')
  const importer = readFileSync(new URL('../server/utils/gitlabManifestImport.ts', import.meta.url), 'utf8')
  const releasesApi = readFileSync(new URL('../server/api/platform/ops/app-manifest-imports/gitlab-releases.get.ts', import.meta.url), 'utf8')
  const registration = readFileSync(new URL('../server/utils/appManifests.ts', import.meta.url), 'utf8')

  assert.match(schema, /`manifest_path` VARCHAR\(500\) NOT NULL DEFAULT 'app\.manifest\.json'/)
  assert.match(schema, /`release_tag_prefix` VARCHAR\(128\) NULL/)
  assert.match(schema, /`source_registration_id` BIGINT UNSIGNED NULL/)
  assert.match(importer, /SELECT id, app_code, repo_url, manifest_path, release_tag_prefix/)
  assert.match(importer, /qualifyReleaseRef\(requestedRef, releaseTagPrefix\)/)
  assert.match(releasesApi, /WHERE app_code = \?/)
  assert.match(releasesApi, /listGitLabReleases\(repoUrl, config, releaseTagPrefix\)/)
  assert.match(registration, /source_registration_id = \?/)
  assert.match(registration, /registration\.insertId/)
})

test('GitLab release catalog includes migrated tags and deduplicates releases by tag', () => {
  const gitlab = readFileSync(new URL('../server/utils/gitlab.ts', import.meta.url), 'utf8')

  assert.match(gitlab, /\/releases\?per_page=100/)
  assert.match(gitlab, /\/repository\/tags\?per_page=100/)
  assert.match(gitlab, /summaries\.has\(tagName\)/)
  assert.match(gitlab, /releaseVersionFromTag\(tagName, normalizedPrefix\)/)
})

test('active admin application routes use app-scoped monorepo release configuration', () => {
  const detailPage = readFileSync(new URL('../app/pages/admin/applications/[code].vue', import.meta.url), 'utf8')
  const settingsPage = readFileSync(new URL('../app/pages/admin/applications/[code]/settings.vue', import.meta.url), 'utf8')
  const importModal = readFileSync(new URL('../app/components/AppGitLabReleaseImportModal.vue', import.meta.url), 'utf8')
  const releasesApi = readFileSync(new URL('../server/api/platform/ops/app-manifest-imports/gitlab-releases.get.ts', import.meta.url), 'utf8')

  assert.doesNotMatch(detailPage, /:repo-url=/)
  assert.doesNotMatch(detailPage, /:default-manifest-path=/)
  assert.match(importModal, /query: \{ appCode: props\.appCode \}/)
  assert.doesNotMatch(importModal, /query: \{ repoUrl: repoUrlText\.value \}/)
  assert.match(importModal, /selectedRelease\.value\?\.version/)
  assert.match(importModal, /response\.data\.source\.repoUrl/)
  assert.match(importModal, /response\.data\.source\.manifestPath/)
  assert.match(importModal, /resolvedRepoUrl\.value = null/)
  assert.match(releasesApi, /SELECT repo_url, manifest_path, release_tag_prefix/)
  assert.match(releasesApi, /source:\s*\{\s*repoUrl,\s*manifestPath:/)
  assert.match(settingsPage, /manifestPath: form\.manifestPath\.trim\(\) \|\| 'app\.manifest\.json'/)
  assert.match(settingsPage, /releaseTagPrefix: form\.releaseTagPrefix\.trim\(\) \|\| null/)
})

test('monorepo cutover migration configures repository-relative manifests and tag namespaces', () => {
  const migration = readFileSync(new URL('../docs/sql/HZY-Platform-SQL-Migration-v2.32-monorepo-application-cutover.sql', import.meta.url), 'utf8')

  assert.match(migration, /https:\/\/gitlab\.wiztek\.cn\/huizhi-yun\/huizhiyun\.git/)
  assert.match(migration, /manifest_path = CONCAT\(app_code, '\/app\.manifest\.json'\)/)
  assert.match(migration, /release_tag_prefix = CONCAT\(app_code, '\/'\)/)
  assert.match(migration, /'codocs'/)
})
