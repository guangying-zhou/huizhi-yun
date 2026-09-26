import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../../scripts/test/support/temporary-mysql-harness.mjs'
import { applyAimsWorkflowV2, planAimsWorkflowV2 } from '../enterprise-aims-workflow-v2.mjs'

const rootDir = resolve(import.meta.dirname, '../../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async context => {
  const root = await mysql.createConnection({ socketPath: context.socketPath, user: 'root', dateStrings: true })
  const name = `hzy_workflow_${randomUUID().replaceAll('-', '')}`
  await root.query(`CREATE DATABASE \`${name}\``)
  const db = await mysql.createConnection({ socketPath: context.socketPath, user: 'root', database: name, dateStrings: true })
  try {
    await db.query('CREATE TABLE aims_aims_projects(id BIGINT UNSIGNED PRIMARY KEY) ENGINE=InnoDB')
    await db.query(`CREATE TABLE aims_workflow_status_catalog(
      entity_type ENUM('project','milestone','requirement','task','bug') NOT NULL,
      status VARCHAR(64) NOT NULL,is_initial TINYINT(1) NOT NULL DEFAULT 0,
      is_terminal TINYINT(1) NOT NULL DEFAULT 0,sort_order INT NOT NULL DEFAULT 0,
      PRIMARY KEY(entity_type,status)) ENGINE=InnoDB`)
    await db.query(`CREATE TABLE aims_workflow_transitions(
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,project_id BIGINT UNSIGNED NULL,
      entity_type ENUM('project','milestone','requirement','task','bug') NOT NULL,
      from_status VARCHAR(64) NOT NULL,to_status VARCHAR(64) NOT NULL,transition_key VARCHAR(64) NOT NULL,
      is_initial TINYINT(1) NOT NULL DEFAULT 0,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_transition(project_id,entity_type,from_status,to_status,transition_key),
      CONSTRAINT from_status_fk FOREIGN KEY(entity_type,from_status) REFERENCES aims_workflow_status_catalog(entity_type,status) ON UPDATE CASCADE ON DELETE RESTRICT,
      CONSTRAINT to_status_fk FOREIGN KEY(entity_type,to_status) REFERENCES aims_workflow_status_catalog(entity_type,status) ON UPDATE CASCADE ON DELETE RESTRICT,
      CONSTRAINT project_fk FOREIGN KEY(project_id) REFERENCES aims_aims_projects(id) ON DELETE CASCADE) ENGINE=InnoDB`)
    await db.query("INSERT INTO aims_workflow_status_catalog VALUES('task','todo',1,0,10),('task','in_progress',0,0,20),('task','done',0,1,30)")
    await db.query("INSERT INTO aims_workflow_transitions(project_id,entity_type,from_status,to_status,transition_key) VALUES(NULL,'task','todo','in_progress','start'),(NULL,'task','in_progress','done','complete')")
    const before = await planAimsWorkflowV2(db)
    assert.equal(before.v2StatusCount, 0)
    assert.equal(before.v2TransitionCount, 0)
    await assert.rejects(applyAimsWorkflowV2(db, '0'.repeat(64)), /plan changed/)
    const after = await applyAimsWorkflowV2(db, before.reviewHash)
    assert.equal(after.legacyHash, before.legacyHash)
    assert.equal(after.legacyTransitionCount, 2)
    assert.equal(after.v2StatusCount, 9)
    assert.equal(after.v2TransitionCount, 13)
    const twice = await applyAimsWorkflowV2(db, after.reviewHash)
    assert.equal(twice.legacyHash, before.legacyHash)
    assert.equal(twice.v2StatusCount, 9)
    assert.equal(twice.v2TransitionCount, 13)
    for (const [from, to, key] of [
      ['todo', 'in_progress', 'start'], ['in_progress', 'todo', 'reset'], ['completed', 'in_progress', 'reopen']
    ]) {
      const [[{ n }]] = await db.execute(`SELECT COUNT(*) AS n FROM aims_workflow_transitions
        WHERE project_id IS NULL AND entity_type='matter' AND from_status=? AND to_status=? AND transition_key=?`, [from, to, key])
      assert.equal(n, 1)
    }
    const [[{ n: old }]] = await db.query("SELECT COUNT(*) AS n FROM aims_workflow_transitions WHERE entity_type='task'")
    assert.equal(old, 2)
    await assert.rejects(db.query("INSERT INTO aims_workflow_transitions(project_id,entity_type,from_status,to_status,transition_key) VALUES(NULL,'matter','missing','todo','invalid')"),
      error => error.code === 'ER_NO_REFERENCED_ROW_2')
    console.log('PASS isolated MySQL V2 workflow: add-only DDL, 13 transitions, repeat, legacy hash, start/reset/reopen')
  } finally {
    await db.end()
    await root.query(`DROP DATABASE \`${name}\``)
    await root.end()
  }
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
