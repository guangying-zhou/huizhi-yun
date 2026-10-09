/**
 * 产品工作台信息架构
 *
 * 产品中心不再平铺同等权重的功能页签，而是围绕一个产品组织三个工作视角：
 * 产品与研发、销售与交付、经营与管理。视角是岗位视图而不是目录树，
 * 因此同一个页面（版本、功能版本矩阵、客户采用）可以同时出现在多个视角里，
 * 由链接上的 `view` 参数说明用户是从哪个视角进入的。
 */

export type ProductPerspectiveKey = 'overview' | 'rd' | 'gtm' | 'ops' | 'settings'

export interface ProductNavItem {
  label: string
  icon: string
  path: string
  /** 归属该入口的额外路径前缀，例如详情页 */
  extraPaths?: string[]
}

export interface ProductPerspective {
  key: ProductPerspectiveKey
  label: string
  icon: string
  /** 主要面向人员 */
  audience: string
  /** 优先呈现内容 */
  summary: string
  /** 视角默认入口 */
  path: string
  /** 归属该视角但不增加二级入口的页面，例如设置中的高级规划 */
  extraPaths?: string[]
  /** 视角内的二级入口 */
  items: ProductNavItem[]
  /** 收敛到「更多」的低频入口 */
  more: ProductNavItem[]
}

export function productBasePath(productCode: string) {
  return `/products/${encodeURIComponent(productCode)}`
}

export function getProductPerspectives(productCode: string): ProductPerspective[] {
  const base = productBasePath(productCode)
  return [
    {
      key: 'overview',
      label: '概览',
      icon: 'i-lucide-layout-dashboard',
      audience: '全部相关岗位',
      summary: '产品定位、核心价值与各视角当前状态',
      path: base,
      items: [],
      more: []
    },
    {
      key: 'rd',
      label: '产品与研发',
      icon: 'i-lucide-drafting-compass',
      audience: '产品负责人、研发负责人',
      summary: '整理需求、安排版本、确认投入并跟踪交付；按模块维护产品能力',
      path: `${base}/requests`,
      items: [
        { label: '需求池', icon: 'i-lucide-inbox', path: `${base}/requests` },
        { label: '版本计划', icon: 'i-lucide-package', path: `${base}/versions`, extraPaths: [
          `${base}/execution-coordination`, `${base}/feature-version-matrix`, `${base}/release-comparison`,
          `${base}/views`, `${base}/planning`, `${base}/planning-items`, `${base}/cycles`
        ] },
        { label: '产品结构', icon: 'i-lucide-folder-tree', path: `${base}/structure`, extraPaths: [`${base}/features`, `${base}/components`] }
      ],
      more: []
    },
    {
      key: 'gtm',
      label: '销售与交付',
      icon: 'i-lucide-handshake',
      audience: '销售、售前、项目经理、服务人员',
      summary: '已发布能力、产品资料、客户部署版本与服务关系',
      path: `${base}/adoption`,
      items: [
        { label: '客户采用', icon: 'i-lucide-boxes', path: `${base}/adoption` },
        { label: '已发布能力', icon: 'i-lucide-table-2', path: `${base}/feature-version-matrix` },
        { label: '版本发布', icon: 'i-lucide-package', path: `${base}/versions` },
        { label: '版本差异', icon: 'i-lucide-git-compare', path: `${base}/release-comparison` },
        { label: '产品资料', icon: 'i-lucide-files', path: `${base}/documents` }
      ],
      more: []
    },
    {
      key: 'ops',
      label: '经营与管理',
      icon: 'i-lucide-chart-no-axes-combined',
      audience: '企业负责人、业务负责人',
      summary: '产品目标、投入产出、成本归集与客户覆盖',
      path: `${base}/objectives`,
      items: [
        { label: '产品目标', icon: 'i-lucide-target', path: `${base}/objectives` },
        { label: '经营结果', icon: 'i-lucide-chart-no-axes-combined', path: `${base}/cost` },
        { label: '成本分摊规则', icon: 'i-lucide-scale', path: `${base}/cost-rules` },
        { label: '客户覆盖', icon: 'i-lucide-users', path: `${base}/adoption` }
      ],
      more: []
    },
    {
      key: 'settings',
      label: '设置',
      icon: 'i-lucide-settings',
      audience: '产品负责人、产品总监',
      summary: '产品定位维护、成员授权、空间生命周期与高级规划设置',
      path: `${base}/settings`,
      extraPaths: [`${base}/models`],
      items: [],
      more: []
    }
  ]
}

/** Enterprise Host only exposes the product routes registered by aims/layer/entry.mjs. */
export function hostProductPerspectives(values: ProductPerspective[]): ProductPerspective[] {
  return values.filter(value => ['overview', 'rd', 'gtm'].includes(value.key)).map(value => ({
    ...value,
    ...(value.key === 'gtm' ? { path: value.items.find(item => hostProductPathAvailable(item.path))?.path || value.path } : {}),
    extraPaths: value.extraPaths?.filter(hostProductPathAvailable),
    items: value.items.filter(item => hostProductPathAvailable(item.path)).map(item => ({
      ...item,
      extraPaths: item.extraPaths?.filter(hostProductPathAvailable)
    })),
    more: value.more.filter(item => hostProductPathAvailable(item.path)).map(item => ({
      ...item,
      extraPaths: item.extraPaths?.filter(hostProductPathAvailable)
    }))
  }))
}

function hostProductPathAvailable(path: string) {
  const suffix = path.replace(/^\/products\/[^/]+/, '')
  return suffix === '' || ['/requests', '/versions', '/structure', '/features', '/components', '/adoption', '/documents', '/cycles', '/execution-coordination', '/planning'].includes(suffix)
    || /^\/versions\//.test(suffix)
    || /^\/features\//.test(suffix)
    || /^\/planning-items\/[^/]+\/handoff$/.test(suffix)
}

/** 路径是否命中某个入口（含其子路由） */
export function productPathMatches(path: string, target: string) {
  return path === target || path.startsWith(`${target}/`)
}

export function productNavItemMatches(path: string, item: ProductNavItem) {
  return [item.path, ...(item.extraPaths || [])].some(target => productPathMatches(path, target))
}

/**
 * 页面的归属视角。同一页面被多个视角复用时，取配置顺序里的第一个作为归属，
 * 只有用户显式带上 `view` 才切换到另一个视角。
 */
export function canonicalProductPerspective(perspectives: ProductPerspective[], path: string): ProductPerspectiveKey | null {
  const overview = perspectives.find(item => item.key === 'overview')
  if (overview && path === overview.path) return 'overview'
  for (const perspective of perspectives) {
    if (perspective.key === 'overview') continue
    if (perspective.extraPaths?.some(target => productPathMatches(path, target))) return perspective.key
    if (perspective.items.length === 0 && perspective.more.length === 0) {
      if (productPathMatches(path, perspective.path)) return perspective.key
      continue
    }
    if ([...perspective.items, ...perspective.more].some(item => productNavItemMatches(path, item))) return perspective.key
  }
  return null
}

/** 当前应高亮的视角：优先取显式 `view`，其次回落到页面归属视角 */
export function resolveProductPerspective(
  perspectives: ProductPerspective[],
  path: string,
  view: unknown
): ProductPerspectiveKey | null {
  const requested = Array.isArray(view) ? view[0] : view
  if (typeof requested === 'string') {
    const matched = perspectives.find(perspective => perspective.key === requested)
    // 显式 view 只在该视角确实包含当前页面时生效，避免过期链接错高亮。
    if (matched && (matched.key === canonicalProductPerspective(perspectives, path)
      || [...matched.items, ...matched.more].some(item => productNavItemMatches(path, item)))) {
      return matched.key
    }
  }
  return canonicalProductPerspective(perspectives, path)
}

/**
 * 入口链接。跨视角复用的页面带上 `view`，归属视角自身的页面保持干净 URL。
 */
export function productNavTo(
  perspectives: ProductPerspective[],
  perspectiveKey: ProductPerspectiveKey,
  path: string
) {
  return canonicalProductPerspective(perspectives, path) === perspectiveKey
    ? { path }
    : { path, query: { view: perspectiveKey } }
}

/** 旧需求模块链接先规范化，避免 useListPage 用默认值覆盖 componentId 上下文。 */
export function normalizeProductRequestQuery<T extends Record<string, unknown>>(query: T) {
  if (!Object.hasOwn(query, 'componentId')) return null
  const normalized: Record<string, unknown> = { ...query }
  if (!Object.hasOwn(query, 'moduleId')) normalized.moduleId = query.componentId
  delete normalized.componentId
  return normalized as Omit<T, 'componentId'> & { moduleId?: T[keyof T] }
}
