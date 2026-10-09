// Exact retired source URLs only. Never forwards to the retired Aims service.
export const legacyAimsPages = Object.freeze([
  {
    path: '/admin',
    name: 'legacy-page-0',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/admin/index.vue'
  },
  {
    path: '/admin/products',
    name: 'legacy-page-1',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/admin/products.vue'
  },
  {
    path: '/admin/project-templates',
    name: 'legacy-page-2',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/admin/project-templates.vue'
  },
  {
    path: '/board',
    name: 'legacy-page-3',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/board.vue'
  },
  {
    path: '/embed/project/:bizId',
    name: 'legacy-page-4',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/embed/project/[bizId].vue'
  },
  {
    path: '/help/pivr',
    name: 'legacy-page-5',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/help/pivr.vue'
  },
  {
    path: '/integration-operations',
    name: 'legacy-page-6',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/integration-operations.vue'
  },
  {
    path: '/login',
    name: 'legacy-page-7',
    kind: 'redirect',
    target: '/enterprise',
    source: 'aims/app/pages/login.vue'
  },
  {
    path: '/product-setup',
    name: 'legacy-page-8',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/product-setup.vue'
  },
  {
    path: '/products/:productCode/cost-rules',
    name: 'legacy-page-9',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cost-rules.vue'
  },
  {
    path: '/products/:productCode/cost',
    name: 'legacy-page-10',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cost.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/add-item',
    name: 'legacy-page-11',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/add-item.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/budget',
    name: 'legacy-page-12',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/budget.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/capacity',
    name: 'legacy-page-13',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/capacity.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/close',
    name: 'legacy-page-14',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/close.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/edit',
    name: 'legacy-page-15',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/edit.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/items/:itemId/assess',
    name: 'legacy-page-16',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/assess.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/items/:itemId/assessments',
    name: 'legacy-page-17',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/assessments.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/items/:itemId/commit',
    name: 'legacy-page-18',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/commit.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/items/:itemId/consumption',
    name: 'legacy-page-19',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/consumption.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/items/:itemId/move',
    name: 'legacy-page-20',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/move.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/items/:itemId/select',
    name: 'legacy-page-21',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/select.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/items/:itemId/withdraw',
    name: 'legacy-page-22',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/items/[itemId]/withdraw.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/items',
    name: 'legacy-page-23',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/items/index.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/matrix',
    name: 'legacy-page-24',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/matrix.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/model',
    name: 'legacy-page-25',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/model.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/observations/:observationId/correct',
    name: 'legacy-page-26',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/observations/[observationId]/correct.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/observations',
    name: 'legacy-page-27',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/observations/index.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/observe',
    name: 'legacy-page-28',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/observe.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/open',
    name: 'legacy-page-29',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/open.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/review',
    name: 'legacy-page-30',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/review.vue'
  },
  {
    path: '/products/:productCode/cycles/:cycleId/roadmap',
    name: 'legacy-page-31',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/[cycleId]/roadmap.vue'
  },
  {
    path: '/products/:productCode/cycles/new',
    name: 'legacy-page-32',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/cycles/new.vue'
  },
  {
    path: '/products/:productCode/feature-version-matrix',
    name: 'legacy-page-33',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/feature-version-matrix.vue'
  },
  {
    path: '/products/:productCode/models',
    name: 'legacy-page-34',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/models/index.vue'
  },
  {
    path: '/products/:productCode/models/new',
    name: 'legacy-page-35',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/models/new.vue'
  },
  {
    path: '/products/:productCode/models/rice-new',
    name: 'legacy-page-36',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/models/rice-new.vue'
  },
  {
    path: '/products/:productCode/objectives/:objectiveId',
    name: 'legacy-page-37',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/objectives/[objectiveId].vue'
  },
  {
    path: '/products/:productCode/objectives',
    name: 'legacy-page-38',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/objectives/index.vue'
  },
  {
    path: '/products/:productCode/objectives/new',
    name: 'legacy-page-39',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/objectives/new.vue'
  },
  {
    path: '/products/:productCode/planning-items/:itemId/commitments',
    name: 'legacy-page-40',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/planning-items/[itemId]/commitments.vue'
  },
  {
    path: '/products/:productCode/planning-items/:itemId/dependencies',
    name: 'legacy-page-41',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/planning-items/[itemId]/dependencies.vue'
  },
  {
    path: '/products/:productCode/planning-items/:itemId/feature',
    name: 'legacy-page-42',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/planning-items/[itemId]/feature.vue'
  },
  {
    path: '/products/:productCode/planning-items/:itemId',
    name: 'legacy-page-43',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/planning-items/[itemId]/index.vue'
  },
  {
    path: '/products/:productCode/planning-items/:itemId/reach-new',
    name: 'legacy-page-44',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/planning-items/[itemId]/reach-new.vue'
  },
  {
    path: '/products/:productCode/planning-items/:itemId/reach',
    name: 'legacy-page-45',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/planning-items/[itemId]/reach.vue'
  },
  {
    path: '/products/:productCode/planning-items/:itemId/roadmap',
    name: 'legacy-page-46',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/planning-items/[itemId]/roadmap.vue'
  },
  {
    path: '/products/:productCode/planning-items/:itemId/version',
    name: 'legacy-page-47',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/planning-items/[itemId]/version.vue'
  },
  {
    path: '/products/:productCode/release-comparison',
    name: 'legacy-page-48',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/release-comparison.vue'
  },
  {
    path: '/products/:productCode/settings',
    name: 'legacy-page-49',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/settings.vue'
  },
  {
    path: '/products/:productCode/views',
    name: 'legacy-page-50',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/products/[productCode]/views/index.vue'
  },
  {
    path: '/project-resources',
    name: 'legacy-page-51',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/project-resources.vue'
  },
  {
    path: '/projects/:id/environments',
    name: 'legacy-page-52',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/projects/[id]/environments.vue'
  },
  {
    path: '/projects/:id/milestones/:milestoneId',
    name: 'legacy-page-53',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/projects/[id]/milestones/[milestoneId].vue'
  },
  {
    path: '/projects/:id/service-desk',
    name: 'legacy-page-54',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/projects/[id]/service-desk.vue'
  },
  {
    path: '/quality-reviews',
    name: 'legacy-page-56',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/quality-reviews.vue'
  },
  {
    path: '/reports',
    name: 'legacy-page-57',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/reports.vue'
  },
  {
    path: '/requirements/batch/:batchId',
    name: 'legacy-page-58',
    kind: 'retired',
    target: null,
    source: 'aims/app/pages/requirements/batch/[batchId].vue'
  },
  {
    path: '/settings/profile',
    name: 'legacy-page-59',
    kind: 'redirect',
    target: '/enterprise/profile',
    source: 'aims/app/pages/settings/profile.vue'
  }
].map(page => Object.freeze(page)))
