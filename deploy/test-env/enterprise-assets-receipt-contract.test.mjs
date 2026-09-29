import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { assetsReceiptMigrations, masterReceiptMigration, linkReceiptMigration, observeAssetsReceiptConstraints, parseAssetsReceiptMigrationArgs, assertAssetsReceiptMigrationSource } from './enterprise-assets-receipt-contract.mjs'
const ddl = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
const row = clause => [{name:'chk_scr_cross_app',enforced:'YES',clause}]
test('migration selector is explicit, defaults read-only and rejects unreviewed apply', () => {
 assert.deepEqual(parseAssetsReceiptMigrationArgs([]),{mode:'--plan',reviewHash:undefined,migrationPath:masterReceiptMigration})
 assert.equal(parseAssetsReceiptMigrationArgs(['--links']).migrationPath,linkReceiptMigration)
 assert.equal(parseAssetsReceiptMigrationArgs(['--apply','a'.repeat(64),'--links']).reviewHash,'a'.repeat(64))
 for(const args of [['--apply'],['--links','--unknown'],['--plan','a'.repeat(64)],['--links','--links'],['--apply','a'.repeat(64),'extra']])assert.throws(()=>parseAssetsReceiptMigrationArgs(args))
})
test('link observation requires every operation and enforced master contract', () => {
 assert.deepEqual(assetsReceiptMigrations,[masterReceiptMigration,linkReceiptMigration])
 assert.equal(observeAssetsReceiptConstraints(row(ddl(masterReceiptMigration))).masterReady,true)
 assert.equal(observeAssetsReceiptConstraints(row(ddl(masterReceiptMigration))).linksReady,false)
 const complete=ddl(linkReceiptMigration)
 assert.equal(observeAssetsReceiptConstraints(row(complete)).linksReady,true)
 for(const marker of ['assets.products.link-base.v1','assets.products.link-asset.v1','assets.products.link-document.v1','original_actor_uid'])assert.equal(observeAssetsReceiptConstraints(row(complete.replaceAll(marker,''))).linksReady,false)
 assert.equal(observeAssetsReceiptConstraints([{...row(complete)[0],enforced:'NO'}]).linksReady,false)
 assert.equal(observeAssetsReceiptConstraints([{...row(complete)[0],name:'unrelated'}]).linksReady,false)
})
test('link upgrade requires prior master; original migration cannot downgrade links', () => {
 assert.throws(()=>assertAssetsReceiptMigrationSource(row('source_app<>target_app'),linkReceiptMigration),/MASTER_RECEIPT/)
 assert.doesNotThrow(()=>assertAssetsReceiptMigrationSource(row(ddl(masterReceiptMigration)),linkReceiptMigration))
 assert.doesNotThrow(()=>assertAssetsReceiptMigrationSource(row(ddl(linkReceiptMigration)),linkReceiptMigration))
 assert.throws(()=>assertAssetsReceiptMigrationSource(row(ddl(linkReceiptMigration)),masterReceiptMigration),/DOWNGRADE/)
 assert.throws(()=>assertAssetsReceiptMigrationSource([{...row(ddl(masterReceiptMigration))[0],enforced:'NO'}],linkReceiptMigration),/UNEXPECTED/)
})
test('already applied master migration bytes match the recorded source receipt',()=>{
 const evidence=JSON.parse(readFileSync(new URL('./artifacts/C000001.assets-owned-receipt-migration.json',import.meta.url)))
 assert.equal(createHash('sha256').update(ddl(masterReceiptMigration)).digest('hex'),evidence.migrationSha256)
})
