import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../../scripts/test/support/temporary-mysql-harness.mjs'
import { applyEnterpriseAssetsReceipts, planEnterpriseAssetsReceipts } from '../enterprise-assets-receipts.mjs'

const rootDir = resolve(import.meta.dirname, '../../..')
const temporaryPlan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(temporaryPlan, async context => {
  const root = await mysql.createConnection({ socketPath: context.socketPath, user: 'root', dateStrings: true })
  const name = `hzy_assets_receipt_${randomUUID().replaceAll('-', '')}`
  await root.query(`CREATE DATABASE \`${name}\``)
  const db = await mysql.createConnection({ socketPath: context.socketPath, user: 'root', database: name, dateStrings: true })
  try {
    const schema = await readFile(resolve(rootDir, 'assets/docs/assets_schema.sql'), 'utf8')
    const start = schema.indexOf('CREATE TABLE IF NOT EXISTS service_command_receipt (')
    assert.ok(start > 0)
    const create = schema.slice(start, schema.indexOf(';', start) + 1)
      .replace('CREATE TABLE IF NOT EXISTS service_command_receipt', 'CREATE TABLE assets_service_command_receipt')
      .replace('CONSTRAINT chk_scr_cross_app', 'CONSTRAINT assets_chk_scr_cross_app_ffc9e2bc')
      .replace('CONSTRAINT chk_scr_status', 'CONSTRAINT assets_chk_scr_status_fb396286')
    await db.query(create)
    const link = await readFile(resolve(rootDir, 'assets/docs/migrations/20260914_assets_owned_product_link_receipts.sql'), 'utf8')
    await db.query(link.slice(link.indexOf('ALTER TABLE service_command_receipt'))
      .replace('ALTER TABLE service_command_receipt', 'ALTER TABLE assets_service_command_receipt')
      .replaceAll('chk_scr_cross_app', 'assets_chk_scr_cross_app_ffc9e2bc'))

    const insert = async (operation, capability, source = 'assets', target = 'assets') => {
      await db.execute(`INSERT INTO assets_service_command_receipt
        (receipt_id,operation_id,operation_code,tenant_code,source_deployment_code,deployment_code,
         source_app,target_app,required_capability,idempotency_key,command_schema_version,command_sha256,original_actor_uid)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        randomUUID(), randomUUID(), operation, 'C000001', 'test-deployment', 'test-deployment',
        source, target, capability, randomUUID(), 'assets-owned-command.v1', 'a'.repeat(64), 'test-owner'
      ])
    }
    await insert('assets.products.create.v1', 'assets:product:edit')
    await insert('aims.project.link.v1', 'aims:project:edit', 'aims', 'assets')
    const before = await planEnterpriseAssetsReceipts(db)
    assert.equal(before.ready, false)
    assert.equal(before.receiptCount, 2)
    assert.deepEqual(before.presentOperations, [
      'assets.product-categories.save.v1', 'assets.products.create.v1', 'assets.products.edit.v1',
      'assets.products.link-asset.v1', 'assets.products.link-base.v1', 'assets.products.link-document.v1'
    ])
    await assert.rejects(insert('assets.digital-assets.create.v1', 'assets:digital-asset:create'),
      error => error.code === 'ER_CHECK_CONSTRAINT_VIOLATED')
    await assert.rejects(applyEnterpriseAssetsReceipts(db, '0'.repeat(64)), /plan changed/)
    const after = await applyEnterpriseAssetsReceipts(db, before.schemaHash)
    assert.equal(after.ready, true)
    assert.equal(after.receiptCount, before.receiptCount)
    assert.equal(after.receiptSha256, before.receiptSha256)
    assert.equal(after.constraint, before.constraint)
    for (const [operation, capability] of [
      ['assets.digital-assets.create.v1', 'assets:digital-asset:create'],
      ['assets.digital-assets.edit.v1', 'assets:digital-asset:edit'],
      ['assets.ip-assets.create.v1', 'assets:ip-asset:create'],
      ['assets.ip-assets.edit.v1', 'assets:ip-asset:edit'],
      ['assets.ip-assets.link-product.v1', 'assets:ip-asset:link-product']
    ]) await insert(operation, capability)
    await assert.rejects(insert('assets.digital-assets.create.v1', 'assets:product:edit'),
      error => error.code === 'ER_CHECK_CONSTRAINT_VIOLATED')
    await assert.rejects(insert('assets.unknown.create.v1', 'assets:product:edit'),
      error => error.code === 'ER_CHECK_CONSTRAINT_VIOLATED')
    const repeat = await planEnterpriseAssetsReceipts(db)
    const twice = await applyEnterpriseAssetsReceipts(db, repeat.schemaHash)
    assert.equal(twice.receiptSha256, repeat.receiptSha256)
    assert.equal(twice.receiptCount, repeat.receiptCount)
    console.log('PASS isolated MySQL Assets receipts: old rows, full allowlist, exact capabilities, repeat, wrong hash')
  } finally {
    await db.end()
    await root.query(`DROP DATABASE \`${name}\``)
    await root.end()
  }
}, { execute: true, confirm: temporaryPlan.confirmationSha256, temporaryParent: '/tmp' })
