import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url)

function read(path) {
  return readFileSync(new URL(path, root), 'utf8')
}

test('People runtime schema inventory includes migrations and transport grants', () => {
  const peopleSchemaPlan = JSON.parse(read('people/docs/schema-manifest.json'))
  assert.equal(peopleSchemaPlan.module, 'people')
  assert.equal(peopleSchemaPlan.targetMode, 'upgrade')
  assert.deepEqual(
    peopleSchemaPlan.upgrade.map(entry => entry.sequence),
    [...peopleSchemaPlan.upgrade.map(entry => entry.sequence)].sort((left, right) => left - right)
  )
  const schemaEntries = [
    ...peopleSchemaPlan.bootstrap,
    ...peopleSchemaPlan.upgrade,
    ...peopleSchemaPlan.postMigrationChecks
  ]
  for (const entry of schemaEntries) {
    const content = read(entry.path)
    const actual = createHash('sha256').update(content).digest('hex')
    assert.equal(entry.sha256, actual, `${entry.path} checksum must match the release manifest`)
  }

  const upgradePaths = peopleSchemaPlan.upgrade.map(entry => entry.path)
  const productionUpgradeFiles = readdirSync(new URL('people/docs/', root), { recursive: true })
    .map(path => String(path).replaceAll('\\', '/'))
    .filter(path => path.endsWith('.sql'))
    .filter(path => !['people_schema.sql', 'people_demo_seed.sql'].includes(path))
    .filter(path => !path.endsWith('_verify.sql'))
    .map(path => `people/docs/${path}`)
    .sort()
  assert.deepEqual([...upgradePaths].sort(), productionUpgradeFiles)
  assert.ok(upgradePaths.includes('people/docs/migrations/20260829_rank_series.sql'))
  assert.deepEqual(peopleSchemaPlan.postMigrationChecks, [
    {
      path: 'people/docs/migrations/20260725_unscored_project_facts_verify.sql',
      sha256: '8dc9d93b6969d1235e0d317d224d48654edccbfea6ebb5cab6382ef30229722b',
      after: 'people/docs/migrations/20260725_unscored_project_facts.sql'
    },
    {
      path: 'people/docs/migrations/20260829_rank_series_verify.sql',
      sha256: '59afff4e6941bcc4c0b7495fa8e5a96f0b92b6e97d52e186ee9c55fea0a21e79',
      after: 'people/docs/migrations/20260829_rank_series.sql'
    },
    {
      path: 'people/docs/migrations/20260902_dingtalk_profile_fields_verify.sql',
      sha256: '264f8f1c0d76757dfb72de8d2c370c9c0cb501a0cf86c92d5aef457774856049',
      after: 'people/docs/migrations/20260902_dingtalk_profile_fields.sql'
    },
    {
      path: 'people/docs/migrations/20260902_onboarding_cases_verify.sql',
      sha256: '69cfae40213bc1634c3c802f6d65f671b210e31f1b65d8b8b3aac5dd83bfb2ed',
      after: 'people/docs/migrations/20260902_onboarding_cases.sql'
    },
    {
      path: 'people/docs/migrations/20260902_onboarding_provisioning_refs_verify.sql',
      sha256: 'fc78b7ba7ac31081dbd303f0cfee432674a6f71a524ba1c4fa6591b3a6b20dc9',
      after: 'people/docs/migrations/20260902_onboarding_provisioning_refs.sql'
    },
    {
      path: 'people/docs/migrations/20260904_employee_private_facts_verify.sql',
      sha256: '5ad6a93d7eb23654874cf990f7af06737b584b99f8cebac28f39ceaf6c4cc517',
      after: 'people/docs/migrations/20260904_employee_private_facts.sql'
    },
    {
      path: 'people/docs/migrations/20260904_employee_number_sequence_verify.sql',
      sha256: 'b2459c2c71a78a641148820c70f999f13e74cec3e4b10fc4d4217896a0cf394c',
      after: 'people/docs/migrations/20260904_employee_number_sequence.sql'
    }
  ])
  const rankSeriesMigration = read('people/docs/migrations/20260829_rank_series.sql')
  const migration = peopleSchemaPlan.upgrade.map(entry => read(entry.path)).join('\n')
  const grants = read('console/docs/sql/Console-SQL-Seed-v1.59-people-runtime-grants.sql')

  assert.match(rankSeriesMigration, /ALTER TABLE [` ]*people_ranks[` ]* ADD COLUMN [` ]*rank_series/)
  assert.match(rankSeriesMigration, /ENUM\(''M'', ''P''\)/)
  assert.match(rankSeriesMigration, /WHERE [` ]*rank_series[` ]* IS NULL/)
  assert.match(rankSeriesMigration, /MODIFY COLUMN [` ]*rank_series[` ]* ENUM\(''M'', ''P''\) NOT NULL DEFAULT ''P''/)

  for (const table of [
    'people_employee_number_sequences',
    'people_employee_private_facts',
    'people_offboarding_cases',
    'people_offboarding_tasks',
    'people_offboarding_notification_checkpoint',
    'people_directory_lifecycle_versions',
    'integration_operation',
    'integration_operation_attempt',
    'integration_operation_dead_letter_actionable'
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS [\\x60 ]*${table}`))
  }

  for (const [resource, action] of [
    ['data-runtime:people', 'read'],
    ['data-runtime:people', 'write'],
    ['tenant-runtime:people', 'read'],
    ['tenant-runtime:people', 'write']
  ]) {
    assert.match(grants, new RegExp(`'${resource}'[^\\n]{0,80}'${action}'`))
  }
})
