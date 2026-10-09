import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, test } from 'node:test'
import { REPOSITORY_COPY_DOC_TYPE, documentBucket, isProjectFamilyDocType, isRepositoryCopyDocType } from '../shared/utils/documentStorage.ts'

const root = new URL('../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')
function files(directory: string): string[] {
  return readdirSync(new URL(directory, root), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : files(path)
    return /\.(ts|vue|mjs)$/.test(entry.name) ? [path] : []
  })
}

// Document asset design DOC-06a/6b.
describe('document storage dimension', () => {
  test('classification keeps today\'s behaviour', () => {
    assert.equal(REPOSITORY_COPY_DOC_TYPE, 'git-project')
    assert.equal(isRepositoryCopyDocType('git-project'), true)
    for (const type of ['project', 'private', 'department', '', undefined, null]) assert.equal(isRepositoryCopyDocType(type), false)
    assert.equal(isProjectFamilyDocType('project'), true)
    assert.equal(isProjectFamilyDocType('git-project'), true)
    assert.equal(isProjectFamilyDocType('department'), false)
    assert.equal(documentBucket('git-project'), 'projects')
    for (const type of ['project', 'private', 'department', 'company', undefined]) assert.equal(documentBucket(type), 'documents')
  })

  test('the repository-copy discriminator has a single owner', () => {
    // The type union in app/types/index.ts is a declaration, not a decision.
    const allowed = new Set(['shared/utils/documentStorage.ts', 'app/types/index.ts'])
    for (const file of ['app', 'server', 'shared', 'layer'].flatMap(files)) {
      if (allowed.has(file)) continue
      assert.doesNotMatch(read(file), /git-project/, `${file} must use shared/utils/documentStorage`)
    }
  })

  test('the migration is additive and backfills only the implicit bucket', () => {
    const migration = read('docs/migrations/20261005_document_storage_dimension.sql')
    const statements = migration.replace(/^--.*$/gm, '')
    assert.match(statements, /ADD COLUMN `storage_type` ENUM\('oss', 'git'\) NOT NULL DEFAULT 'oss'/)
    assert.match(statements, /ADD COLUMN `storage_locator` JSON NULL/)
    assert.match(statements, /ADD COLUMN `origin_json` JSON NULL/)
    assert.match(statements, /ADD COLUMN `storage_revision` VARCHAR\(128\) NULL/)
    assert.doesNotMatch(statements, /\b(DROP|MODIFY|CHANGE|DELETE|TRUNCATE|RENAME)\b/i)
    // Idempotent backfill: only rows that have no locator yet, never doc_type itself.
    assert.equal((statements.match(/WHERE `storage_locator` IS NULL/g) || []).length, 2)
    assert.doesNotMatch(statements, /SET `doc_type`/)
    const schema = read('docs/codocs_schema.sql')
    for (const column of ['`storage_type` ENUM(\'oss\', \'git\')', '`storage_locator` JSON NULL', '`origin_json` JSON NULL', '`storage_revision` VARCHAR(128) NULL']) {
      assert.ok(schema.includes(column), column)
    }
  })
})
