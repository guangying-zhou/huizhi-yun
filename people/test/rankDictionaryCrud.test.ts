import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { rankFormSchema } from '../app/utils/rankFormSchema.ts'

const page = readFileSync(new URL('../app/pages/settings/ranks.vue', import.meta.url), 'utf8')
const types = readFileSync(new URL('../app/types/people.ts', import.meta.url), 'utf8')
const schema = readFileSync(new URL('../docs/people_schema.sql', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../docs/migrations/20260829_rank_series.sql', import.meta.url), 'utf8')
const migrationVerify = readFileSync(new URL('../docs/migrations/20260829_rank_series_verify.sql', import.meta.url), 'utf8')

describe('People rank dictionary CRUD', () => {
  test('create and update share one editor with professional and management types', () => {
    assert.match(page, /v-model:open="editorOpen"/)
    assert.match(page, /<UForm[\s\S]*:schema="rankFormSchema"[\s\S]*:state="form"/)
    assert.match(page, /name="rankLevel"[\s\S]*required/)
    assert.match(page, /name="sortOrder"[\s\S]*required/)
    assert.match(page, /@click="openCreate"/)
    assert.match(page, /method: current \? 'PATCH' : 'POST'/)
    assert.match(page, /\? `\/api\/v1\/ranks\/\$\{current\.id\}`/)
    assert.match(page, /\.\.\.\(!current \? \{ rankCode: data\.rankCode \} : \{\}\)/)
    assert.match(page, /:disabled="Boolean\(editingRank\)"/)
    assert.match(page, /rankSeriesOptions[\s\S]*专业[\s\S]*value: 'P'[\s\S]*管理[\s\S]*value: 'M'/)
    assert.match(page, /rankSeries: data\.rankSeries/)
    assert.match(page, /ensurePeoplePermission\('ranks', 'admin'\)/)
  })

  test('accepts numeric input models and rejects blank integer fields', () => {
    const valid = rankFormSchema.safeParse({
      rankCode: 'P6',
      rankName: '专业 P6',
      rankSeries: 'P',
      rankLevel: 6,
      description: '',
      enabled: true,
      sortOrder: 10
    })
    assert.equal(valid.success, true)
    if (valid.success) {
      assert.equal(valid.data.rankLevel, 6)
      assert.equal(valid.data.sortOrder, 10)
    }

    const invalid = rankFormSchema.safeParse({
      rankCode: 'P6',
      rankName: '专业 P6',
      rankSeries: 'P',
      rankLevel: '',
      description: '',
      enabled: true,
      sortOrder: ''
    })
    assert.equal(invalid.success, false)
  })

  test('delete is explicit, permission guarded and confirmed as destructive', () => {
    assert.match(page, /method: 'DELETE'/)
    assert.match(page, /`\/api\/v1\/ranks\/\$\{rank\.id\}`/)
    assert.match(page, /tone: 'danger'/)
    assert.match(page, /已有员工、任职和成本快照中的职级事实不会被修改/)
    assert.match(page, /删除职级 \$\{row\.original\.rank_name\}/)
  })

  test('list keeps server pagination and debounced search behavior', () => {
    assert.match(page, /page_size: pageSize\.value/)
    assert.match(page, /onChange: \(\) => \{\s*page\.value = 1/)
    assert.match(page, /@keyup\.enter="flushSearch"/)
    assert.match(page, /<UPagination/)
  })

  test('schema and migration persist M and P rank series', () => {
    assert.match(types, /rank_series: 'M' \| 'P'/)
    assert.match(schema, /`rank_series` ENUM\('M', 'P'\) NOT NULL DEFAULT 'P'/)
    assert.match(migration, /ALTER TABLE `people_ranks` ADD COLUMN `rank_series` ENUM\(''M'', ''P''\)/)
    assert.match(migration, /WHERE [` ]*rank_series[` ]* IS NULL/)
    assert.doesNotMatch(migration, /ELSE 'P'/)
    assert.match(migration, /SELECT [` ]*rank_code[` ]*, [` ]*rank_name[` ]*[\s\S]*WHERE [` ]*rank_series[` ]* IS NULL/)
    assert.match(migration, /_people_rank_series_unresolved_guard/)
    assert.match(migration, /STRICT_TRANS_TABLES/)
    assert.match(migration, /SET SESSION sql_mode = @rank_series_previous_sql_mode/)
    assert.match(migration, /MODIFY COLUMN [` ]*rank_series[` ]* ENUM\(''M'', ''P''\) NOT NULL DEFAULT ''P''/)
    assert.match(schema, /CONSTRAINT `ck_people_rank_numeric` CHECK/)
    assert.match(schema, /CONSTRAINT `ck_people_rank_enabled` CHECK/)
    assert.match(migration, /ADD CONSTRAINT `ck_people_rank_numeric` CHECK/)
    assert.match(migration, /ADD CONSTRAINT `ck_people_rank_enabled` CHECK/)
    assert.match(migrationVerify, /rank_series metadata checks passed/)
    assert.match(migrationVerify, /ranks without a series/)
  })
})
