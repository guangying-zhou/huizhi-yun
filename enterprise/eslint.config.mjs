// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import { aimsImportBoundary } from '../foundation/eslint/aims-server-boundary.mjs'

// Frozen existing composition baseline; additions are rejected by the composition test.
export const existingAimsCompositionFiles = Object.freeze([
  'server/routes/aims/api/v1/product-permissions.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/adoption.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/components/permissions.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/features/[featureId].delete.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/features/[featureId].get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/features/[featureId].patch.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/features/[featureId]/component.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/features/[featureId]/lifecycle.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/features/[featureId]/requests.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/features/[featureId]/requests.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/features/[featureId]/roadmap.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/features/[featureId]/unscheduled.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/features/index.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/features/index.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/features/permissions.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/permissions.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/planning-cycles.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/planning-items/[itemId].get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/planning-items/[itemId]/handoffs.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/planning-items/permissions.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/requests.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/requests/[requestId].patch.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/requests/[requestId]/decision.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/requests/[requestId]/handoffs.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/requests/[requestId]/merge.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/requests/[requestId]/sources/[sourceId].delete.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/requests/[requestId]/sources/index.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/requests/[requestId]/sources/index.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/requests/permissions.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/roadmaps/execution-coordination.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId].delete.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId].get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId].patch.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/acceptance-preview.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/acceptances.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/acceptances.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/acceptances/[acceptanceId].get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/archive.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/features/[scopeId].patch.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/features/[scopeId]/deliver.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/features/[scopeId]/history.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/features/[scopeId]/legacy-criteria.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/features/[scopeId]/reopen.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/features/[scopeId]/visibility.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/features/index.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/plan.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/plan.patch.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/plan/confirm.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/plan/items/[scopeId].delete.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/plan/items/[scopeId].patch.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/plan/items/index.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/plan/items/index.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/publish.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/releases/[recordId].get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/releases/index.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/reopen.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/transition.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/index.get.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/index.post.ts', // 既有，待随原生化收敛
  'server/routes/aims/api/v1/products/[productCode]/versions/permissions.get.ts', // 既有，待随原生化收敛
  'server/utils/enterpriseAimsProjectProducts.ts', // 既有，待随原生化收敛
  'server/utils/enterpriseAimsProjectWriteAuthorization.ts', // 既有，待随原生化收敛
  'server/utils/enterpriseAimsProjects.ts', // 既有，待随原生化收敛
  'server/utils/enterpriseAimsWeeklyGovernance.ts', // 既有，待随原生化收敛
  'server/utils/enterpriseCodocsProjectDocument.ts', // 既有，待随原生化收敛
  'server/utils/enterpriseProductAuthorization.ts', // 既有，待随原生化收敛
  'server/utils/enterpriseProductComponents.ts', // 既有，待随原生化收敛
  'server/utils/enterpriseProductDocumentLink.ts', // 既有，待随原生化收敛
  'server/utils/enterpriseProductDocuments.ts', // 既有，待随原生化收敛
  'server/utils/enterpriseProductFeatures.ts', // 既有，待随原生化收敛
  'server/utils/enterpriseProductHandoff.ts', // 既有，待随原生化收敛
  'server/utils/enterpriseProductHandoffCandidates.ts', // 既有，待随原生化收敛
  'server/utils/enterpriseProductList.ts', // 既有，待随原生化收敛
  'server/utils/enterpriseProductOnboarding.ts', // 既有，待随原生化收敛
  'server/utils/enterpriseProductPlanning.ts', // 既有，待随原生化收敛
  'server/utils/enterpriseProductRequestActions.ts', // 既有，待随原生化收敛
  'server/utils/enterpriseProductRequestRead.ts', // 既有，待随原生化收敛
  'server/utils/enterpriseProductWorkspace.ts' // 既有，待随原生化收敛
])

export default withNuxt({
  files: ['**/*.{ts,js,mjs,vue}'],
  ignores: ['test/**'],
  rules: { 'no-restricted-imports': aimsImportBoundary() }
}, {
  files: existingAimsCompositionFiles.map(file => file.replaceAll('[', '\\[').replaceAll(']', '\\]')),
  rules: { 'no-restricted-imports': aimsImportBoundary(true) }
})
