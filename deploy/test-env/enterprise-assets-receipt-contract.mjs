/** Source migration contract only. Importing this module performs no I/O. */
export const masterReceiptMigration = 'assets/docs/migrations/20260913_assets_owned_product_receipts.sql'
export const linkReceiptMigration = 'assets/docs/migrations/20260914_assets_owned_product_link_receipts.sql'
export const assetsReceiptMigrations = Object.freeze([masterReceiptMigration, linkReceiptMigration])
const master = ['assets.products.create.v1', 'assets.products.edit.v1', 'assets.product-categories.save.v1']
const links = ['assets.products.link-base.v1', 'assets.products.link-asset.v1', 'assets.products.link-document.v1']
const bound = ['assets-owned-command.v1', 'original_actor_uid', 'source_deployment_code', 'deployment_code', 'assets:product:edit', 'assets:admin:admin']

// Metadata observation is not a replacement for Runtime checks or command tests.
export function observeAssetsReceiptConstraints(rows) {
  const constraint = rows.find(row => row.name === 'chk_scr_cross_app' && row.enforced === 'YES')
  const clause = String(constraint?.clause || '')
  const masterReady = [...bound, ...master].every(value => clause.includes(value))
  return { masterReady, linksReady: masterReady && links.every(value => clause.includes(value)), anyLinkMarker: links.some(value => clause.includes(value)) }
}
export function parseAssetsReceiptMigrationArgs(args) {
  const remaining = args.filter(value => value !== '--links')
  if (args.filter(value => value === '--links').length > 1) throw Error('MODE_OR_REVIEW_HASH_REQUIRED')
  const mode = remaining[0] || '--plan'
  const reviewHash = remaining[1]
  if (!['--plan', '--apply'].includes(mode) || remaining.length > (mode === '--apply' ? 2 : 1) || (mode === '--apply' && !/^[a-f0-9]{64}$/.test(reviewHash || ''))) throw Error('MODE_OR_REVIEW_HASH_REQUIRED')
  return { mode, reviewHash, migrationPath: args.includes('--links') ? linkReceiptMigration : masterReceiptMigration }
}
export function assertAssetsReceiptMigrationSource(rows, migrationPath) {
  if (rows.length !== 1 || rows[0].enforced !== 'YES') throw Error('SOURCE_CONSTRAINT_UNEXPECTED')
  const observed = observeAssetsReceiptConstraints(rows)
  if (migrationPath === linkReceiptMigration) {
    if (!observed.masterReady) throw Error('MASTER_RECEIPT_MIGRATION_REQUIRED')
  } else if (migrationPath === masterReceiptMigration) {
    if (observed.anyLinkMarker) throw Error('RECEIPT_SCHEMA_DOWNGRADE_FORBIDDEN')
  } else throw Error('UNKNOWN_RECEIPT_MIGRATION')
  return observed
}
