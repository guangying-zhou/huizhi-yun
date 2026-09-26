import { fileURLToPath } from 'node:url'

const page = (path, name, source) => ({
  path,
  name,
  file: fileURLToPath(new URL(`../app/pages/${source}.vue`, import.meta.url))
})

// This is the Host composition boundary, not a product feature inventory.
// A route appears in `pages` only after its Host BFF has been registered and
// can execute against the enterprise Runtime.  Keep unavailable standalone
// paths here so a future Layer change cannot silently turn a 503 into a page
// that looks complete but has no supported data path.
const hostReadiness = Object.freeze({
  entryPath: '/products',
  deferredPages: Object.freeze([
    '/overview',
    '/technology-bases/:id',
    '/environments',
    '/deliveries',
    '/procurement/**',
    '/operations/assignments',
    '/alerts',
    '/reports'
  ])
})

// Placed by business area, not by owning application. 数字资产 and 资产字典 are
// the extension third-level items the specification §3 allows so an existing
// page does not disappear when names converge.
const navigation = Object.freeze([
  { id: 'assets.product.catalog.products', area: 'product', group: 'catalog', label: '全部产品', to: '/assets/products', permission: { resource: 'products', action: 'view' }, order: 1 },
  { id: 'assets.product.assets.ip', area: 'product', group: 'assets', label: '知识产权', to: '/assets/ip-assets', permission: { resource: 'ip_assets', action: 'view' }, order: 2 },
  { id: 'assets.product.assets.digital', area: 'product', group: 'assets', label: '数字资产', to: '/assets/digital-assets', permission: { resource: 'digital_assets', action: 'view' }, order: 3 },
  { id: 'assets.operations.resource.physical', area: 'operations', group: 'resource', label: '自用资产', to: '/assets/physical', permission: { resource: 'asset_items', action: 'view' }, order: 1 },
  { id: 'assets.operations.resource.resources', area: 'operations', group: 'resource', label: '资源台账', to: '/assets/resources', permission: { resource: 'asset_items', action: 'view' }, order: 2 },
  { id: 'assets.console.config.categories', area: 'console', group: 'config', label: '产品字典', to: '/assets/admin/asset-categories', permission: { resource: 'admin', action: 'view' }, order: 1 },
  { id: 'assets.console.config.dictionaries', area: 'console', group: 'config', label: '资产字典', to: '/assets/admin/dictionaries', permission: { resource: 'admin', action: 'view' }, order: 2 }
])

export default Object.freeze({
  code: 'assets', prefix: '/assets', label: '产品与资产',
  hostReadiness, navigation,
  pages: [
    page('/products', 'products', 'products/index'),
    page('/products/:id', 'product-detail', 'products/[id]'),
    page('/admin/asset-categories', 'product-category-admin', 'admin/asset-categories'),
    page('/admin/dictionaries', 'dictionaries', 'admin/dictionaries'),
    page('/physical', 'physical-assets', 'physical'),
    page('/resources', 'resource-assets', 'resources'),
    page('/digital-assets', 'digital-assets', 'digital-assets/index'),
    page('/digital-assets/:id', 'digital-asset-detail', 'digital-assets/[id]'),
    page('/ip-assets', 'ip-assets', 'ip-assets/index'),
    page('/ip-assets/:id', 'ip-asset-detail', 'ip-assets/[id]'),
    page('/items/:id', 'asset-detail', 'items/[id]')
  ],
  handlers: [], tasks: []
})
