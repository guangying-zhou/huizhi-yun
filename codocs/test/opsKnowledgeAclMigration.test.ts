import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const migration = readFileSync(new URL('../docs/migration_v1.3_ops_knowledge_acl_hardening.sql', import.meta.url), 'utf8')

describe('ops knowledge historical ACL hardening migration', () => {
  test('disables old user-principal context rows and strips every ACL flag', () => {
    assert.match(migration, /relation_type = 'ops_knowledge'/)
    assert.match(migration, /related_uid <> 'service:altoc:ops-knowledge'/)
    assert.match(migration, /can_read = 0,[\s\S]*can_edit = 0,[\s\S]*can_comment = 0,[\s\S]*status = 0/)
    assert.match(migration, /unsafe_active_ops_knowledge_relations/)
  })
})
