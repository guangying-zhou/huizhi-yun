<script setup lang="ts">
import type { TimelineItem } from '@nuxt/ui'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '产品管理',
  layoutHeaderProjectSwitcher: false
})

interface ApiResponse<T> {
  code: number
  data: T
  message?: string
}

interface ProductAsset {
  id?: number | null
  productCode: string
  productName: string | null
  productLine?: string | null
  customerDomain?: string | null
  businessDomain?: string | null
  productLevel?: string | null
  assetLevel?: string | null
  productizationValueLevel?: string | null
  status?: string | null
  buildStage?: string | null
  projectCode?: string | null
  currentVersion?: string | null
  targetVersion?: string | null
  summary?: string | null
  businessOwnerUid?: string | null
  technicalOwnerUid?: string | null
  assetCount?: number | string | null
  baseCount?: number | string | null
}

interface ProductVersion {
  id: number
  product_code: string
  version_code: string
  name: string | null
  description?: string | null
  status: string
  planned_release_date: string | null
  released_at: string | null
  released_by?: string | null
  milestone_id?: number | null
  owner_project_id: number | null
  owner_project_code?: string | null
  owner_project_name?: string | null
  sort_order?: number | null
  target_count?: number | string
  targetCount?: number | string
  completed_count?: number | string
  completedCount?: number | string
  progress_percent?: number | string
  progressPercent?: number | string
  feature_count?: number | string
  featureCount?: number | string
  delivered_feature_count?: number | string
  deliveredFeatureCount?: number | string
  completed_feature_count?: number | string
  completedFeatureCount?: number | string
  features?: VersionFeature[]
  projects?: Array<Record<string, unknown>>
}

interface VersionFeature {
  id: number
  version_id: number
  title: string
  description?: string | null
  category?: string | null
  status: string
  is_public: number | boolean
  isPublic?: number | boolean
  sort_order?: number | null
  sortOrder?: number | null
  target_count?: number | string
  targetCount?: number | string
  completed_count?: number | string
  completedCount?: number | string
}

interface VersionPage {
  items?: ProductVersion[]
  adminApiAvailable?: boolean
  readonlyFallback?: boolean
}

interface VersionTimelineItem extends TimelineItem {
  version: ProductVersion
}

type ProductBadgeColor = 'primary' | 'secondary' | 'info' | 'warning'

const toast = useToast()

const products = ref<ProductAsset[]>([])
const versions = ref<ProductVersion[]>([])
const selectedProductCode = ref('')
const selectedVersion = ref<ProductVersion | null>(null)
const adminVersionApiAvailable = ref(true)
const productDomainFilter = ref('all')
const productAssetValueFilter = ref('all')
const loadingProducts = ref(false)
const loadingVersions = ref(false)
const loadingDetail = ref(false)
const savingVersion = ref(false)
const savingFeature = ref(false)
const mutatingVersionStatus = ref(false)

const versionModalOpen = ref(false)
const versionModalMode = ref<'create' | 'edit'>('create')
const featureModalOpen = ref(false)
const featureModalMode = ref<'create' | 'edit'>('create')
const editingFeatureId = ref<number | null>(null)

const versionForm = reactive({
  versionCode: '',
  name: '',
  description: '',
  plannedReleaseDate: '',
  ownerProjectId: '',
  sortOrder: '0'
})

// 版本号格式：大写 V + 带 1 位小数点的数字，例如 V1.0、V2.5、V10.3
const VERSION_CODE_PATTERN = /^V\d+\.\d$/
const versionCodeError = computed(() => {
  const value = versionForm.versionCode.trim()
  if (!value) return undefined
  return VERSION_CODE_PATTERN.test(value) ? undefined : '格式应为 V + 1 位小数，如 V1.0'
})

const featureForm = reactive({
  title: '',
  category: '功能',
  description: '',
  status: 'planned',
  isPublic: true,
  sortOrder: '0'
})

const statusLabel: Record<string, string> = {
  planning: '规划中',
  developing: '开发中',
  released: '已发布',
  archived: '已归档'
}

const statusColor: Record<string, string> = {
  planning: 'neutral',
  developing: 'info',
  released: 'success',
  archived: 'neutral'
}

const featureStatusLabel: Record<string, string> = {
  planned: '规划',
  delivered: '已交付',
  deferred: '顺延'
}

const featureStatusOptions = [
  { label: '规划', value: 'planned' },
  { label: '已交付', value: 'delivered' },
  { label: '顺延', value: 'deferred' }
]

const featureCategoryOptions = [
  { label: '功能', value: '功能' },
  { label: '特性', value: '特性' }
]

const productAssetValueRank: Record<string, number> = {
  core_asset: 400,
  operating_asset: 300,
  deposited_asset: 200,
  pending_eval: 100,
  a: 400,
  b: 300,
  c: 200,
  d: 100
} as const

const productAssetValueLabel: Record<string, string> = {
  core_asset: '核心资产',
  operating_asset: '经营资产',
  deposited_asset: '沉淀资产',
  pending_eval: '待评估',
  a: 'A 级',
  b: 'B 级',
  c: 'C 级',
  d: 'D 级'
} as const

const productAssetValueBadgeColor: Record<string, ProductBadgeColor> = {
  core_asset: 'primary',
  operating_asset: 'secondary',
  deposited_asset: 'info',
  pending_eval: 'warning',
  a: 'primary',
  b: 'secondary',
  c: 'info',
  d: 'warning'
} as const

const productDomainLabel: Record<string, string> = {
  fc: '智慧房产 FC',
  bdc: '不动产登记 BDC',
  ty: '通用领域 TY',
  jd: '特定领域 JD',
  ny: '农业农村 NY',
  gz: '公证处 GZ',
  jy: '交易监管 JY',
  dj: '登记服务 DJ',
  wy: '物业管理 WY',
  bz: '住房保障 BZ',
  zj: '资金监管 ZJ',
  fx: '分析决策 FX',
  jc: '基础支撑 JC',
  gx: '共享服务 GX',
  pending: '待分类'
} as const

const productInvestmentStrategyLabel: Record<string, string> = {
  focus_invest: '重点投入',
  continue_operate: '持续经营',
  control_maintain: '控制维护',
  orderly_exit: '有序退出',
  pending_eval: '待评估',
  star: '重点投入',
  cash_cow: '持续经营',
  question: '重点投入',
  dog: '有序退出'
} as const

const productInvestmentStrategyBadgeColor: Record<string, ProductBadgeColor> = {
  focus_invest: 'primary',
  continue_operate: 'secondary',
  control_maintain: 'info',
  orderly_exit: 'warning',
  pending_eval: 'warning',
  star: 'primary',
  cash_cow: 'secondary',
  question: 'primary',
  dog: 'warning'
} as const

const productStatusLabel: Record<string, string> = {
  poc: '规划POC',
  mvp: '核心MVP',
  mmp: '商用MMP',
  pmf: '市场PMF',
  eol: '退市EOL',
  planning: '规划POC',
  iterating: '核心MVP',
  maintenance: '商用MMP',
  refactor_pending: '商用MMP',
  retire_pending: '退市EOL'
} as const

const selectedProduct = computed(() =>
  products.value.find(product => product.productCode === selectedProductCode.value) || null
)

const productDomainFilterOptions = computed(() => {
  const values = Array.from(new Set(products.value.map(productDomainValue).filter(Boolean)))
  values.sort((left, right) => productDomainRank(left) - productDomainRank(right) || productDomainDisplayLabel(left).localeCompare(productDomainDisplayLabel(right), 'zh-Hans-CN'))
  return [
    { label: '全部领域', value: 'all' },
    ...values.map(value => ({ label: productDomainDisplayLabel(value), value }))
  ]
})

const productAssetValueFilterOptions = computed(() => {
  const values = Array.from(new Set(products.value.map(product => normalizeAssetValue(product.assetLevel)).filter(Boolean)))
  values.sort((left, right) => assetValueRankFromValue(right) - assetValueRankFromValue(left) || assetValueDisplayLabel(left).localeCompare(assetValueDisplayLabel(right), 'zh-Hans-CN'))
  return [
    { label: '全部资产价值', value: 'all' },
    ...values.map(value => ({ label: assetValueDisplayLabel(value), value }))
  ]
})

const filteredProducts = computed(() => {
  const items = [...products.value].sort(compareProductAssetValue)
  return items.filter((product) => {
    if (productDomainFilter.value !== 'all' && productDomainValue(product) !== productDomainFilter.value) return false
    if (productAssetValueFilter.value !== 'all' && normalizeAssetValue(product.assetLevel) !== productAssetValueFilter.value) return false
    return true
  })
})

const sortedFeatures = computed(() => [...(selectedVersion.value?.features || [])].sort((left, right) =>
  featureCategorySortRank(left) - featureCategorySortRank(right)
  || Number(left.sort_order || 0) - Number(right.sort_order || 0)
  || left.id - right.id
))

const featuresLocked = computed(() => {
  const status = selectedVersion.value?.status
  return status === 'released' || status === 'archived'
})

const selectedVersionTimelineValue = computed(() => selectedVersion.value ? String(selectedVersion.value.id) : undefined)

const versionTimelineItems = computed<VersionTimelineItem[]>(() => versions.value.map(version => ({
  value: String(version.id),
  date: formatDate(version.planned_release_date),
  title: version.version_code,
  description: versionName(version) || undefined,
  icon: versionTimelineIcon(version),
  version,
  ui: {
    item: 'min-w-[15rem] flex-1 cursor-pointer',
    wrapper: 'min-w-0',
    title: selectedVersion.value?.id === version.id ? 'text-primary' : undefined
  }
})))

const versionModalTitle = computed(() => versionModalMode.value === 'create' ? '新建版本' : '编辑版本')
const featureModalTitle = computed(() => featureModalMode.value === 'create' ? '新建功能特性' : '编辑功能特性')

async function loadProducts() {
  loadingProducts.value = true
  try {
    const res = await $fetch<ApiResponse<{ items: ProductAsset[] }>>('/api/v1/product-assets', {
      params: { pageSize: 200 }
    })
    products.value = (res.data.items || []).filter(product => Boolean(product.productCode))
    const currentExists = products.value.some(product => product.productCode === selectedProductCode.value)
    if (!currentExists) {
      selectedProductCode.value = filteredProducts.value[0]?.productCode || ''
    }
    if (selectedProductCode.value) {
      await loadVersions(selectedProductCode.value)
    }
  } catch (error) {
    products.value = []
    versions.value = []
    selectedVersion.value = null
    toast.add({ title: errorMessage(error, '加载产品列表失败'), color: 'error' })
  } finally {
    loadingProducts.value = false
  }
}

async function selectProduct(productCode: string) {
  if (selectedProductCode.value === productCode) return
  selectedProductCode.value = productCode
  selectedVersion.value = null
  await loadVersions(productCode)
}

async function loadVersions(productCode = selectedProductCode.value) {
  if (!productCode) {
    versions.value = []
    selectedVersion.value = null
    return
  }
  loadingVersions.value = true
  try {
    const res = await $fetch<ApiResponse<VersionPage>>(`/api/v1/admin/products/${encodeURIComponent(productCode)}/versions`)
    adminVersionApiAvailable.value = res.data.adminApiAvailable !== false
    versions.value = res.data.items || []
    const current = selectedVersion.value
      ? versions.value.find(version => version.id === selectedVersion.value?.id)
      : null
    const next = current || versions.value[0] || null
    if (next) {
      await openVersion(next)
    } else {
      selectedVersion.value = null
    }
  } catch (error) {
    versions.value = []
    selectedVersion.value = null
    toast.add({ title: errorMessage(error, '加载版本列表失败'), color: 'error' })
  } finally {
    loadingVersions.value = false
  }
}

async function openVersion(version: ProductVersion) {
  selectedVersion.value = version
  if (!adminVersionApiAvailable.value) return
  loadingDetail.value = true
  try {
    const res = await $fetch<ApiResponse<ProductVersion>>(`/api/v1/admin/product-versions/${version.id}`)
    selectedVersion.value = res.data
    const index = versions.value.findIndex(item => item.id === res.data.id)
    if (index >= 0) {
      versions.value[index] = { ...versions.value[index], ...res.data }
    }
  } catch (error) {
    toast.add({ title: errorMessage(error, '加载版本详情失败'), color: 'error' })
  } finally {
    loadingDetail.value = false
  }
}

async function selectTimelineVersion(_event: Event, item: VersionTimelineItem) {
  await openVersion(item.version)
}

function openCreateVersionModal() {
  if (!adminVersionApiAvailable.value) {
    toast.add({ title: '当前 data-runtime 尚未启用产品管理写接口，请先升级后再维护版本', color: 'warning' })
    return
  }
  if (!selectedProduct.value) return
  versionModalMode.value = 'create'
  versionForm.versionCode = ''
  versionForm.name = ''
  versionForm.description = ''
  versionForm.plannedReleaseDate = ''
  versionForm.ownerProjectId = ''
  versionForm.sortOrder = String(versions.value.length + 1)
  versionModalOpen.value = true
}

function openEditVersionModal() {
  if (!adminVersionApiAvailable.value) {
    toast.add({ title: '当前 data-runtime 尚未启用产品管理写接口，请先升级后再维护版本', color: 'warning' })
    return
  }
  if (!selectedVersion.value) return
  versionModalMode.value = 'edit'
  versionForm.versionCode = selectedVersion.value.version_code || ''
  versionForm.name = selectedVersion.value.name || ''
  versionForm.description = selectedVersion.value.description || ''
  versionForm.plannedReleaseDate = selectedVersion.value.planned_release_date || ''
  versionForm.ownerProjectId = selectedVersion.value.owner_project_id ? String(selectedVersion.value.owner_project_id) : ''
  versionForm.sortOrder = String(selectedVersion.value.sort_order ?? 0)
  versionModalOpen.value = true
}

async function saveVersion() {
  if (!adminVersionApiAvailable.value) return
  const product = selectedProduct.value
  const version = selectedVersion.value
  const versionCode = versionForm.versionCode.trim()
  if (!product || !versionCode) return
  if (!VERSION_CODE_PATTERN.test(versionCode)) {
    toast.add({ title: '版本号格式应为 V + 1 位小数，如 V1.0', color: 'error' })
    return
  }
  savingVersion.value = true
  try {
    const body = {
      version_code: versionCode,
      name: versionForm.name.trim() || null,
      description: versionForm.description.trim() || null,
      planned_release_date: versionForm.plannedReleaseDate || null,
      owner_project_id: parseOptionalNumber(versionForm.ownerProjectId),
      sort_order: Number(versionForm.sortOrder || 0)
    }
    let saved: ProductVersion
    if (versionModalMode.value === 'create') {
      const res = await $fetch<ApiResponse<ProductVersion>>(`/api/v1/admin/products/${encodeURIComponent(product.productCode)}/versions`, {
        method: 'POST',
        body
      })
      saved = res.data
    } else {
      if (!version) return
      const res = await $fetch<ApiResponse<ProductVersion>>(`/api/v1/admin/product-versions/${version.id}`, {
        method: 'PATCH',
        body
      })
      saved = res.data
    }
    versionModalOpen.value = false
    await loadVersions(product.productCode)
    await openVersion(saved)
    toast.add({ title: versionModalMode.value === 'create' ? '版本已创建' : '版本已保存', color: 'success' })
  } catch (error) {
    toast.add({ title: errorMessage(error, '保存版本失败'), color: 'error' })
  } finally {
    savingVersion.value = false
  }
}

async function deleteVersion() {
  if (!adminVersionApiAvailable.value) return
  const version = selectedVersion.value
  const product = selectedProduct.value
  if (!version || !product) return
  if (version.status !== 'planning') {
    toast.add({ title: '只能删除规划中的版本', color: 'warning' })
    return
  }
  if (!window.confirm(`确认删除版本 ${version.version_code}？`)) return
  savingVersion.value = true
  try {
    await $fetch(`/api/v1/admin/product-versions/${version.id}`, {
      method: 'DELETE'
    })
    selectedVersion.value = null
    await loadVersions(product.productCode)
    toast.add({ title: '版本已删除', color: 'success' })
  } catch (error) {
    toast.add({ title: errorMessage(error, '删除版本失败'), color: 'error' })
  } finally {
    savingVersion.value = false
  }
}

async function transitionVersion(toStatus: string) {
  if (!adminVersionApiAvailable.value) return
  const version = selectedVersion.value
  const product = selectedProduct.value
  if (!version || !product) return
  mutatingVersionStatus.value = true
  try {
    const res = await $fetch<ApiResponse<ProductVersion>>(`/api/v1/admin/product-versions/${version.id}/transition`, {
      method: 'POST',
      body: { to_status: toStatus }
    })
    selectedVersion.value = res.data
    await loadVersions(product.productCode)
    await openVersion(res.data)
    toast.add({ title: '版本状态已更新', color: 'success' })
  } catch (error) {
    toast.add({ title: errorMessage(error, '版本状态更新失败'), color: 'error' })
  } finally {
    mutatingVersionStatus.value = false
  }
}

function openCreateFeatureModal() {
  if (!adminVersionApiAvailable.value) {
    toast.add({ title: '当前 data-runtime 尚未启用产品管理写接口，请先升级后再维护特性', color: 'warning' })
    return
  }
  if (!selectedVersion.value || featuresLocked.value) return
  featureModalMode.value = 'create'
  editingFeatureId.value = null
  featureForm.title = ''
  featureForm.category = '功能'
  featureForm.description = ''
  featureForm.status = 'planned'
  featureForm.isPublic = true
  featureForm.sortOrder = String((selectedVersion.value.features || []).length + 1)
  featureModalOpen.value = true
}

function openEditFeatureModal(feature: VersionFeature) {
  if (!adminVersionApiAvailable.value) {
    toast.add({ title: '当前 data-runtime 尚未启用产品管理写接口，请先升级后再维护特性', color: 'warning' })
    return
  }
  if (featuresLocked.value) return
  featureModalMode.value = 'edit'
  editingFeatureId.value = feature.id
  featureForm.title = feature.title || ''
  featureForm.category = normalizeFeatureCategoryForForm(feature.category)
  featureForm.description = feature.description || ''
  featureForm.status = feature.status || 'planned'
  featureForm.isPublic = Boolean(feature.is_public)
  featureForm.sortOrder = String(feature.sort_order ?? 0)
  featureModalOpen.value = true
}

async function saveFeature() {
  if (!adminVersionApiAvailable.value) return
  const version = selectedVersion.value
  if (!version || !featureForm.title.trim()) return
  savingFeature.value = true
  try {
    const body = {
      title: featureForm.title.trim(),
      category: featureForm.category || '功能',
      description: featureForm.description.trim() || null,
      status: featureForm.status,
      is_public: featureForm.isPublic,
      sort_order: Number(featureForm.sortOrder || 0)
    }
    if (featureModalMode.value === 'create') {
      await $fetch(`/api/v1/admin/product-versions/${version.id}/features`, {
        method: 'POST',
        body
      })
    } else if (editingFeatureId.value) {
      await $fetch(`/api/v1/admin/product-versions/${version.id}/features/${editingFeatureId.value}`, {
        method: 'PATCH',
        body
      })
    }
    featureModalOpen.value = false
    await openVersion(version)
    await loadVersions(version.product_code)
    toast.add({ title: featureModalMode.value === 'create' ? '特性已创建' : '特性已保存', color: 'success' })
  } catch (error) {
    toast.add({ title: errorMessage(error, '保存功能特性失败'), color: 'error' })
  } finally {
    savingFeature.value = false
  }
}

async function deleteFeature(feature: VersionFeature) {
  if (!adminVersionApiAvailable.value) return
  const version = selectedVersion.value
  if (!version || featuresLocked.value) return
  if (!window.confirm(`确认删除特性 ${feature.title}？`)) return
  savingFeature.value = true
  try {
    await $fetch(`/api/v1/admin/product-versions/${version.id}/features/${feature.id}`, {
      method: 'DELETE'
    })
    await openVersion(version)
    await loadVersions(version.product_code)
    toast.add({ title: '特性已删除', color: 'success' })
  } catch (error) {
    toast.add({ title: errorMessage(error, '删除功能特性失败'), color: 'error' })
  } finally {
    savingFeature.value = false
  }
}

function nextStatuses(status: string) {
  if (status === 'planning') return [{ label: '进入开发', value: 'developing' }]
  if (status === 'developing') return [{ label: '发布版本', value: 'released' }]
  if (status === 'released') return [{ label: '回退开发', value: 'developing' }, { label: '归档', value: 'archived' }]
  return []
}

function productDomainValue(product: ProductAsset) {
  return normalizeDictionaryValue(product.productLine || product.businessDomain || 'pending') || 'pending'
}

function productDomainRank(value: string) {
  const order = ['fc', 'bdc', 'ty', 'jd', 'ny', 'gz', 'jy', 'dj', 'wy', 'bz', 'zj', 'fx', 'jc', 'gx', 'pending']
  const index = order.indexOf(normalizeDictionaryValue(value))
  return index >= 0 ? index : 999
}

function productDomainDisplayLabel(value: unknown) {
  const normalized = normalizeDictionaryValue(value)
  return productDomainLabel[normalized] || String(value || '').trim() || '待分类'
}

function productInvestmentStrategyDisplayLabel(product: ProductAsset) {
  const normalized = normalizeDictionaryValue(product.productLevel)
  return productInvestmentStrategyLabel[normalized] || String(product.productLevel || '').trim() || '投资策略待评估'
}

function productInvestmentStrategyColor(product: ProductAsset): ProductBadgeColor {
  const normalized = normalizeDictionaryValue(product.productLevel)
  return productInvestmentStrategyBadgeColor[normalized] || 'warning'
}

function productStatusDisplayLabel(product: ProductAsset) {
  const normalized = normalizeDictionaryValue(product.status)
  return productStatusLabel[normalized] || String(product.status || '').trim() || '状态待评估'
}

function compareProductAssetValue(left: ProductAsset, right: ProductAsset) {
  const rankDiff = assetValueRank(right) - assetValueRank(left)
  if (rankDiff !== 0) return rankDiff
  return String(left.productName || left.productCode).localeCompare(String(right.productName || right.productCode), 'zh-Hans-CN')
}

function assetValueRank(product: ProductAsset): number {
  return assetValueRankFromValue(product.assetLevel)
}

function assetValueRankFromValue(value: unknown): number {
  const normalized = normalizeAssetValue(value)
  const explicitRank = productAssetValueRank[normalized]
  if (explicitRank !== undefined) return explicitRank
  if (normalized.includes('核心')) return productAssetValueRank.core_asset || 400
  if (normalized.includes('经营')) return productAssetValueRank.operating_asset || 300
  if (normalized.includes('沉淀')) return productAssetValueRank.deposited_asset || 200
  if (normalized.includes('待评估')) return productAssetValueRank.pending_eval || 100
  return 0
}

function assetValueDisplayLabel(value: unknown) {
  const normalized = normalizeAssetValue(value)
  return productAssetValueLabel[normalized] || String(value || '').trim() || '未评级'
}

function assetValueDisplayColor(value: unknown): ProductBadgeColor {
  const normalized = normalizeAssetValue(value)
  const color = productAssetValueBadgeColor[normalized]
  if (color) return color
  if (normalized.includes('核心')) return 'primary'
  if (normalized.includes('经营')) return 'secondary'
  if (normalized.includes('沉淀')) return 'info'
  return 'warning'
}

function assetValueLabel(product: ProductAsset) {
  return assetValueDisplayLabel(product.assetLevel)
}

function assetValueColor(product: ProductAsset): ProductBadgeColor {
  return assetValueDisplayColor(product.assetLevel)
}

function normalizeDictionaryValue(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function normalizeAssetValue(value: unknown) {
  return normalizeDictionaryValue(value)
}

function numericValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function recordValue(record: Record<string, unknown> | null | undefined, ...keys: string[]) {
  if (!record) return undefined
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function countValue(record: Record<string, unknown> | null | undefined, ...keys: string[]) {
  return numericValue(recordValue(record, ...keys))
}

function versionName(version: ProductVersion | null | undefined) {
  return String(version?.name || '').trim()
}

function versionTitle(version: ProductVersion | null | undefined) {
  if (!version) return ''
  const name = versionName(version)
  return name ? `${version.version_code} · ${name}` : version.version_code
}

function versionTargetCount(version: ProductVersion | null | undefined) {
  return countValue(version as Record<string, unknown> | null | undefined, 'target_count', 'targetCount')
}

function versionCompletedCount(version: ProductVersion | null | undefined) {
  return countValue(version as Record<string, unknown> | null | undefined, 'completed_count', 'completedCount')
}

function versionFeatureCount(version: ProductVersion | null | undefined) {
  const explicit = recordValue(version as Record<string, unknown> | null | undefined, 'feature_count', 'featureCount')
  if (explicit !== undefined) return numericValue(explicit)
  return version?.features?.length || 0
}

function versionDeliveredFeatureCount(version: ProductVersion | null | undefined) {
  const explicit = recordValue(
    version as Record<string, unknown> | null | undefined,
    'delivered_feature_count',
    'deliveredFeatureCount',
    'completed_feature_count',
    'completedFeatureCount'
  )
  if (explicit !== undefined) return numericValue(explicit)
  return (version?.features || []).filter(feature => feature.status === 'delivered').length
}

function versionFeatureProgressValue(version: ProductVersion | null | undefined) {
  const total = versionFeatureCount(version)
  if (total <= 0) return 0
  return Math.round(versionDeliveredFeatureCount(version) / total * 100)
}

function versionTimelineIcon(version: ProductVersion) {
  if (version.status === 'released') return 'i-lucide-circle-check'
  if (version.status === 'developing') return 'i-lucide-code-2'
  if (version.status === 'archived') return 'i-lucide-archive'
  return 'i-lucide-clock-3'
}

function featureTargetCount(feature: VersionFeature | null | undefined) {
  return countValue(feature as unknown as Record<string, unknown> | null | undefined, 'target_count', 'targetCount')
}

function featureCompletedCount(feature: VersionFeature | null | undefined) {
  return countValue(feature as unknown as Record<string, unknown> | null | undefined, 'completed_count', 'completedCount')
}

function featureCategorySortRank(feature: VersionFeature | null | undefined) {
  return normalizeFeatureCategoryForForm(feature?.category) === '特性' ? 1 : 0
}

function isFeatureCompleted(feature: VersionFeature) {
  const target = featureTargetCount(feature)
  return feature.status === 'delivered' || (target > 0 && featureCompletedCount(feature) >= target)
}

function featureTitleColorClass(feature: VersionFeature) {
  return normalizeFeatureCategoryForForm(feature.category) === '特性' ? 'text-secondary' : 'text-primary'
}

function parseOptionalNumber(value: string) {
  const text = value.trim()
  if (!text) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function formatDate(value: string | null | undefined) {
  return value ? String(value).slice(0, 10) : '-'
}

function isPublicFeature(feature: VersionFeature) {
  const value = recordValue(feature as unknown as Record<string, unknown>, 'is_public', 'isPublic')
  return value === true || Number(value) === 1
}

function normalizeFeatureCategoryForForm(value: unknown) {
  const text = String(value || '').trim()
  if (text === '特性' || text.toLowerCase() === 'feature') return '特性'
  return '功能'
}

function featureCategoryLabel(value: unknown) {
  const text = String(value || '').trim()
  if (!text) return '功能'
  if (text.toLowerCase() === 'function' || text.toLowerCase() === 'functionality') return '功能'
  if (text.toLowerCase() === 'feature') return '特性'
  return text
}

function errorMessage(error: unknown, fallback: string) {
  const err = error as { data?: { message?: string }, message?: string }
  return err?.data?.message || err?.message || fallback
}

watch([productDomainFilter, productAssetValueFilter], async () => {
  const nextProductCode = filteredProducts.value[0]?.productCode || ''
  if (selectedProductCode.value === nextProductCode) return
  selectedProductCode.value = nextProductCode
  selectedVersion.value = null
  if (nextProductCode) {
    await loadVersions(nextProductCode)
  } else {
    versions.value = []
  }
})

onMounted(loadProducts)
</script>

<template>
  <UDashboardPanel
    id="admin-products"
    :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }"
  >
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <div class="grid flex-1 min-h-0 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside class="flex min-h-0 flex-col border-b border-default lg:border-b-0 lg:border-r">
            <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 border-b border-default p-3">
              <USelect
                v-model="productDomainFilter"
                :items="productDomainFilterOptions"
                size="sm"
                class="min-w-0"
              />
              <USelect
                v-model="productAssetValueFilter"
                :items="productAssetValueFilterOptions"
                size="sm"
                class="min-w-0"
              />
              <span class="shrink-0 text-right text-xs tabular-nums leading-8 text-muted">
                {{ filteredProducts.length }} / {{ products.length }}
              </span>
            </div>

            <div v-if="loadingProducts" class="flex flex-1 items-center justify-center">
              <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
            </div>
            <div v-else-if="filteredProducts.length === 0" class="p-6 text-center text-sm text-muted">
              暂无可选产品
            </div>
            <div v-else class="flex-1 space-y-2 overflow-y-auto p-3">
              <button
                v-for="product in filteredProducts"
                :key="product.productCode"
                type="button"
                class="w-full rounded-md border px-3 py-2 text-left transition hover:bg-elevated/60"
                :class="product.productCode === selectedProductCode ? 'border-primary bg-primary/5' : 'border-default bg-default'"
                @click="selectProduct(product.productCode)"
              >
                <div class="min-w-0">
                  <div class="truncate text-sm font-semibold text-highlighted">
                    {{ product.productName }}
                  </div>
                  <div class="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                    <span class="truncate font-mono text-xs text-muted">
                      {{ product.productCode }}
                    </span>
                    <UBadge :color="assetValueColor(product)" variant="soft" size="sm">
                      {{ assetValueLabel(product) }}
                    </UBadge>
                    <UBadge :color="productInvestmentStrategyColor(product)" variant="soft" size="sm">
                      {{ productInvestmentStrategyDisplayLabel(product) }}
                    </UBadge>
                  </div>
                </div>
                <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span class="truncate">{{ productDomainDisplayLabel(productDomainValue(product)) }}</span>
                  <UBadge color="neutral" variant="subtle" size="sm">
                    {{ productStatusDisplayLabel(product) }}
                  </UBadge>
                </div>
              </button>
            </div>
          </aside>

          <main class="flex min-h-0 flex-col">
            <section class="min-h-[240px] border-b border-default">
              <div class="flex items-center justify-between gap-4 border-b border-default px-4 py-1">
                <div class="min-w-0 flex-1">
                  <h2 class="truncate text-sm font-semibold text-highlighted">
                    {{ selectedProduct ? `${selectedProduct.productName || selectedProduct.productCode} · ${selectedProduct.productCode}` : '选择产品后维护版本和功能特性' }}
                  </h2>
                  <UPopover
                    v-if="selectedProduct?.summary"
                    mode="hover"
                    :open-delay="150"
                    :content="{ side: 'bottom', align: 'start', sideOffset: 8 }"
                    :ui="{ content: 'max-w-[min(44rem,calc(100vw-2rem))] whitespace-normal break-words p-3 text-sm leading-6 text-toned' }"
                  >
                    <p class="mt-0.5 cursor-help truncate text-xs text-muted">
                      {{ selectedProduct.summary }}
                    </p>
                    <template #content>
                      <div class="max-w-[42rem] whitespace-normal break-words">
                        {{ selectedProduct.summary }}
                      </div>
                    </template>
                  </UPopover>
                  <p v-else class="mt-0.5 truncate text-xs text-muted">
                    {{ selectedProduct ? '-' : '' }}
                  </p>
                </div>
                <div v-if="selectedVersion" class="flex shrink-0 flex-nowrap items-center gap-2">
                  <UButton
                    icon="i-lucide-plus"
                    color="primary"
                    size="sm"
                    class="min-w-[5.5rem] shrink-0 whitespace-nowrap"
                    :disabled="!selectedProduct || !adminVersionApiAvailable"
                    @click="openCreateVersionModal"
                  >
                    新建版本
                  </UButton>
                </div>
              </div>

              <div
                v-if="!adminVersionApiAvailable"
                class="border-b border-warning/30 bg-warning/5 px-4 py-1 text-xs text-warning"
              >
                当前 data-runtime 尚未启用产品管理写接口，版本和特性以只读模式显示。
              </div>

              <div v-if="loadingVersions" class="flex h-48 items-center justify-center">
                <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
              </div>
              <div v-else-if="!selectedProduct" class="p-10 text-center text-sm text-muted">
                请先选择左侧产品
              </div>
              <div v-else-if="versions.length === 0" class="flex h-48 flex-col items-center justify-center gap-3 text-sm text-muted">
                <span>当前产品暂无版本</span>
                <UButton
                  icon="i-lucide-plus"
                  size="sm"
                  color="primary"
                  variant="soft"
                  @click="openCreateVersionModal"
                >
                  新建版本
                </UButton>
              </div>
              <div v-else class="overflow-x-auto overflow-y-hidden px-4 py-5">
                <UTimeline
                  :model-value="selectedVersionTimelineValue"
                  :items="versionTimelineItems"
                  orientation="horizontal"
                  size="sm"
                  class="min-w-max"
                  :ui="{ root: 'gap-0', item: 'min-w-[15rem]', wrapper: 'pr-4' }"
                  @select="selectTimelineVersion"
                >
                  <template #date="{ item }">
                    <div class="text-xs text-muted">
                      {{ item.date }}
                    </div>
                  </template>
                  <template #title="{ item }">
                    <div class="flex min-w-0 flex-wrap items-center gap-2">
                      <span class="truncate font-semibold text-highlighted">{{ item.version.version_code }}</span>
                      <UBadge :color="(statusColor[item.version.status] as any)" variant="subtle" size="sm">
                        {{ statusLabel[item.version.status] || item.version.status }}
                      </UBadge>
                    </div>
                  </template>
                  <template #description="{ item }">
                    <div class="mt-2 min-w-0">
                      <div v-if="versionName(item.version)" class="truncate text-sm text-muted">
                        {{ versionName(item.version) }}
                      </div>
                      <div class="mt-2 w-44">
                        <UProgress :model-value="versionFeatureProgressValue(item.version)" />
                        <div class="mt-1 text-xs text-muted">
                          {{ versionDeliveredFeatureCount(item.version) }}/{{ versionFeatureCount(item.version) }} 功能特性
                        </div>
                        <div class="mt-0.5 text-[11px] text-dimmed">
                          {{ versionCompletedCount(item.version) }}/{{ versionTargetCount(item.version) }} 目标
                        </div>
                      </div>
                    </div>
                  </template>
                </UTimeline>
              </div>
            </section>

            <section class="flex min-h-0 flex-1 flex-col">
              <div class="flex items-center justify-between gap-3 border-b border-default px-4 py-3">
                <div class="min-w-0">
                  <h2 class="text-sm font-semibold text-highlighted">
                    功能特性
                  </h2>
                  <p class="mt-0.5 truncate text-xs text-muted">
                    {{ selectedVersion ? versionTitle(selectedVersion) : '选择版本后查看功能特性' }}
                  </p>
                </div>
                <div v-if="selectedVersion" class="flex shrink-0 flex-nowrap items-center gap-2">
                  <UButton
                    icon="i-lucide-plus"
                    color="primary"
                    variant="soft"
                    size="sm"
                    :disabled="!selectedVersion || featuresLocked || !adminVersionApiAvailable"
                    @click="openCreateFeatureModal"
                  >
                    新建特性
                  </UButton>
                  <UButton
                    v-for="action in nextStatuses(selectedVersion.status)"
                    :key="action.value"
                    size="sm"
                    color="primary"
                    variant="soft"
                    class="min-w-[5.5rem] shrink-0 whitespace-nowrap"
                    :disabled="!adminVersionApiAvailable"
                    :loading="mutatingVersionStatus"
                    @click="transitionVersion(action.value)"
                  >
                    {{ action.label }}
                  </UButton>
                  <UButton
                    icon="i-lucide-pencil"
                    size="sm"
                    color="neutral"
                    variant="soft"
                    class="shrink-0"
                    :disabled="!adminVersionApiAvailable"
                    @click="openEditVersionModal"
                  />
                  <UButton
                    v-if="sortedFeatures.length === 0"
                    icon="i-lucide-trash-2"
                    size="sm"
                    color="error"
                    variant="soft"
                    class="shrink-0"
                    :disabled="!adminVersionApiAvailable || selectedVersion.status !== 'planning'"
                    :loading="savingVersion"
                    @click="deleteVersion"
                  />
                </div>
              </div>

              <div v-if="loadingDetail" class="flex flex-1 items-center justify-center">
                <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
              </div>
              <div v-else-if="!selectedVersion" class="flex flex-1 items-center justify-center text-sm text-muted">
                选择一个版本查看特性
              </div>
              <div v-else class="flex-1 overflow-y-auto p-4">
                <div class="mb-4 grid gap-3 md:grid-cols-4">
                  <div class="rounded-md bg-muted/40 px-3 py-2">
                    <div class="text-xs text-muted">
                      计划发布
                    </div>
                    <div class="mt-1 text-sm font-medium">
                      {{ formatDate(selectedVersion.planned_release_date) }}
                    </div>
                  </div>
                  <div class="rounded-md bg-muted/40 px-3 py-2">
                    <div class="text-xs text-muted">
                      实际发布
                    </div>
                    <div class="mt-1 text-sm font-medium">
                      {{ formatDate(selectedVersion.released_at) }}
                    </div>
                  </div>
                  <div class="rounded-md bg-muted/40 px-3 py-2">
                    <div class="text-xs text-muted">
                      归属项目
                    </div>
                    <div class="mt-1 truncate text-sm font-medium">
                      {{ selectedVersion.owner_project_name || selectedVersion.owner_project_code || '-' }}
                    </div>
                  </div>
                  <div class="rounded-md bg-muted/40 px-3 py-2">
                    <div class="text-xs text-muted">
                      完成度
                    </div>
                    <div class="mt-1 text-sm font-medium">
                      {{ versionFeatureProgressValue(selectedVersion) }}%
                    </div>
                  </div>
                </div>

                <div
                  v-if="featuresLocked || !adminVersionApiAvailable"
                  class="mb-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning"
                >
                  {{ !adminVersionApiAvailable ? '当前为只读兜底模式，暂不能维护特性。' : '已发布或已归档版本的特性已锁定。' }}
                </div>

                <div v-if="sortedFeatures.length === 0" class="rounded-md border border-dashed border-default py-12 text-center text-sm text-muted">
                  当前版本暂无功能特性
                </div>
                <div v-else class="overflow-hidden rounded-md border border-default">
                  <div
                    v-for="feature in sortedFeatures"
                    :key="feature.id"
                    class="flex min-h-11 items-center gap-3 border-b border-default px-3 py-2 last:border-b-0 hover:bg-elevated/40"
                  >
                    <UIcon
                      :name="isFeatureCompleted(feature) ? 'i-lucide-circle-check-big' : 'i-lucide-circle'"
                      class="size-4 shrink-0"
                      :class="isFeatureCompleted(feature) ? 'text-success' : 'text-muted'"
                    />
                    <div class="flex min-w-0 flex-1 items-center gap-2">
                      <span class="truncate text-sm font-medium" :class="featureTitleColorClass(feature)">
                        {{ feature.title }}
                      </span>
                      <span class="shrink-0 text-xs text-muted">{{ featureCategoryLabel(feature.category) }}</span>
                      <span class="shrink-0 text-xs text-muted">
                        {{ featureStatusLabel[feature.status] || feature.status }}
                      </span>
                      <span class="shrink-0 text-xs text-muted">{{ isPublicFeature(feature) ? '对外可见' : '内部' }}</span>
                      <span class="shrink-0 text-xs text-muted">{{ featureCompletedCount(feature) }}/{{ featureTargetCount(feature) }} 目标</span>
                      <span v-if="feature.description" class="min-w-0 truncate text-xs text-dimmed">
                        {{ feature.description }}
                      </span>
                    </div>
                    <div class="flex shrink-0 justify-end gap-1">
                      <UButton
                        icon="i-lucide-pencil"
                        size="xs"
                        color="neutral"
                        variant="soft"
                        :disabled="featuresLocked || !adminVersionApiAvailable"
                        @click="openEditFeatureModal(feature)"
                      />
                      <UButton
                        icon="i-lucide-trash-2"
                        size="xs"
                        color="error"
                        variant="soft"
                        :disabled="featuresLocked || !adminVersionApiAvailable"
                        :loading="savingFeature"
                        @click="deleteFeature(feature)"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="versionModalOpen" :ui="{ content: 'sm:max-w-2xl' }">
    <template #header>
      <div>
        <h3 class="text-lg font-semibold text-highlighted">
          {{ versionModalTitle }}
        </h3>
        <p class="mt-1 text-xs text-muted">
          {{ selectedProduct?.productName || selectedProduct?.productCode }}
        </p>
      </div>
    </template>
    <template #body>
      <div class="grid gap-4 md:grid-cols-2">
        <UFormField
          label="版本号"
          required
          :error="versionCodeError"
          help="格式：V + 1 位小数，如 V1.0"
        >
          <UInput v-model="versionForm.versionCode" class="w-full" placeholder="V1.0" />
        </UFormField>
        <UFormField label="版本名称">
          <UInput v-model="versionForm.name" class="w-full" />
        </UFormField>
        <UFormField label="计划发布日期">
          <UInput v-model="versionForm.plannedReleaseDate" type="date" class="w-full" />
        </UFormField>
        <UFormField label="排序">
          <UInput v-model="versionForm.sortOrder" type="number" class="w-full" />
        </UFormField>
        <UFormField label="归属项目 ID">
          <UInput v-model="versionForm.ownerProjectId" type="number" class="w-full" />
        </UFormField>
        <UFormField label="说明" class="md:col-span-2">
          <UTextarea v-model="versionForm.description" :rows="4" class="w-full" />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="versionModalOpen = false">
          取消
        </UButton>
        <UButton
          color="primary"
          :loading="savingVersion"
          :disabled="!!versionCodeError"
          @click="saveVersion"
        >
          保存
        </UButton>
      </div>
    </template>
  </UModal>

  <UModal v-model:open="featureModalOpen" :ui="{ content: 'sm:max-w-2xl' }">
    <template #header>
      <div>
        <h3 class="text-lg font-semibold text-highlighted">
          {{ featureModalTitle }}
        </h3>
        <p class="mt-1 text-xs text-muted">
          {{ selectedVersion?.version_code }}
        </p>
      </div>
    </template>
    <template #body>
      <div class="grid gap-4 md:grid-cols-2">
        <UFormField label="标题" required class="md:col-span-2">
          <UInput v-model="featureForm.title" class="w-full" />
        </UFormField>
        <UFormField label="分类">
          <URadioGroup
            v-model="featureForm.category"
            :items="featureCategoryOptions"
            orientation="horizontal"
            size="sm"
          />
        </UFormField>
        <UFormField label="状态">
          <USelect v-model="featureForm.status" :items="featureStatusOptions" class="w-full" />
        </UFormField>
        <UFormField label="排序">
          <UInput v-model="featureForm.sortOrder" type="number" class="w-full" />
        </UFormField>
        <UFormField label="可见性">
          <UCheckbox v-model="featureForm.isPublic" label="对外可见" />
        </UFormField>
        <UFormField label="说明" class="md:col-span-2">
          <UTextarea v-model="featureForm.description" :rows="4" class="w-full" />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="featureModalOpen = false">
          取消
        </UButton>
        <UButton color="primary" :loading="savingFeature" @click="saveFeature">
          保存
        </UButton>
      </div>
    </template>
  </UModal>
</template>
