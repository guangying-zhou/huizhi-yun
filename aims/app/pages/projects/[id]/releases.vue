<script setup lang="ts">
import { projectModuleEnabled } from '~/utils/projectModuleConfig'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '版本',
  layoutHeaderProjectSwitcher: true
})

interface ApiResponse<T> {
  code: number
  data: T
  message?: string
}

interface ProjectProduct {
  id: number
  product_code: string
  product_name: string | null
  version_id: number | null
  is_primary: number
  version_code?: string | null
  version_status?: string | null
}

interface ProductVersion {
  id: number
  product_code: string
  product_name?: string | null
  version_code: string
  name: string | null
  description?: string | null
  status: string
  planned_release_date: string | null
  released_at: string | null
  owner_project_id: number | null
  target_count?: number
  completed_count?: number
  progress_percent?: number
  features?: VersionFeature[]
  items?: VersionWorkItem[]
}

interface VersionFeature {
  id: number
  title: string
  category: string | null
  status: string
  is_public: number
  target_count?: number
  completed_count?: number
}

interface VersionWorkItem {
  id: number
  item_key: string
  title: string
  status: string
  feature_id: number | null
}

interface WorkItemOption {
  id: number
  item_key?: string
  itemKey?: string
  title: string
  version_id?: number | null
  versionId?: number | null
}

interface ProductAssetOption {
  productCode: string
  productName: string | null
  productLine?: string | null
  status?: string | null
  currentVersion?: string | null
  targetVersion?: string | null
}

const route = useRoute()
const toast = useToast()
const projectStore = useProjectStore()
const projectId = computed(() => Number(route.params.id))
const project = computed(() => projectStore.currentProject)
const moduleEnabled = computed(() =>
  projectModuleEnabled(project.value?.moduleConfig, project.value?.category, 'releases')
)

const products = ref<ProjectProduct[]>([])
const releases = ref<ProductVersion[]>([])
const selectedRelease = ref<ProductVersion | null>(null)
const targetOptions = ref<WorkItemOption[]>([])
const loading = ref(false)
const detailLoading = ref(false)
const savingProduct = ref(false)
const attachingItems = ref(false)
const loadingProductAssets = ref(false)
const showProductModal = ref(false)
const showReleaseModal = ref(false)
const showAttachModal = ref(false)
const productAssetSearch = ref('')
const productAssetOptions = ref<ProductAssetOption[]>([])
const selectedProductCode = ref('')

const productForm = reactive({
  productCode: '',
  productName: '',
  isPrimary: true
})

const releaseForm = reactive({ productCode: '' })

const attachForm = reactive({
  workItemIds: [] as number[],
  featureId: null as number | null
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

const featureStatusColor: Record<string, string> = {
  planned: 'neutral',
  delivered: 'success',
  deferred: 'warning'
}

const canManageProducts = computed(() => {
  const project = projectStore.currentProject
  return project?.currentUserRole === 'manager'
    && ['product_dev', 'delivery', 'maintenance'].includes(project.category || '')
})

const canManageVersions = computed(() => {
  const project = projectStore.currentProject
  return canManageProducts.value && project?.category === 'product_dev'
})

const productOptions = computed(() => products.value.map(product => ({
  label: `${product.product_name || product.product_code} (${product.product_code})`,
  value: product.product_code
})))

const canAttachItems = computed(() => !!selectedRelease.value
  && ['planning', 'developing'].includes(selectedRelease.value.status))
const attachError = ref('')

const featureOptions = computed(() => [
  { label: '不归入特性', value: null },
  ...((selectedRelease.value?.features || []).map(feature => ({
    label: feature.title,
    value: feature.id
  })))
])

const targetSelectOptions = computed(() => targetOptions.value
  .filter(item => !item.version_id && !item.versionId)
  .map(item => ({
    label: `${item.item_key || item.itemKey || item.id} ${item.title}`,
    value: item.id
  })))

const productAssetSelectOptions = computed(() => productAssetOptions.value.map(product => ({
  label: `${product.productName || product.productCode} (${product.productCode})`,
  value: product.productCode,
  product
})))

let productAssetSearchTimer: ReturnType<typeof setTimeout> | null = null

function projectApiPath(path: string): string {
  return `/api/v1/projects/${projectId.value}${path}`
}

async function loadProductAssets(keyword = '') {
  loadingProductAssets.value = true
  try {
    const res = await $fetch<ApiResponse<{ items: ProductAssetOption[] }>>('/api/v1/product-assets', {
      params: {
        keyword: keyword.trim() || undefined,
        pageSize: 50
      }
    })
    productAssetOptions.value = res.data.items || []
  } catch (error) {
    productAssetOptions.value = []
    toast.add({ title: errorMessage(error, '加载产品列表失败'), color: 'error' })
  } finally {
    loadingProductAssets.value = false
  }
}

function openProductModal() {
  if (!canManageProducts.value) return
  productForm.productCode = ''
  productForm.productName = ''
  productForm.isPrimary = products.value.length === 0
  selectedProductCode.value = ''
  productAssetSearch.value = ''
  showProductModal.value = true
  loadProductAssets()
}

function applySelectedProduct(productCode: string) {
  selectedProductCode.value = productCode
  const selected = productAssetOptions.value.find(product => product.productCode === productCode)
  productForm.productCode = selected?.productCode || productCode
  productForm.productName = selected?.productName || ''
}

watch(productAssetSearch, (keyword) => {
  if (!showProductModal.value) return
  if (productAssetSearchTimer) clearTimeout(productAssetSearchTimer)
  productAssetSearchTimer = setTimeout(() => {
    loadProductAssets(keyword)
  }, 300)
})

async function loadAll() {
  if (!projectId.value) return
  loading.value = true
  try {
    if (!projectStore.currentProject || projectStore.currentProject.id !== projectId.value) {
      await projectStore.fetchProject(projectId.value)
    }
    if (!moduleEnabled.value) {
      products.value = []
      releases.value = []
      selectedRelease.value = null
      return
    }
    const [productRes, releaseRes] = await Promise.all([
      $fetch<ApiResponse<{ items: ProjectProduct[] }>>(projectApiPath('/products')),
      $fetch<ApiResponse<{ items: ProductVersion[] }>>(projectApiPath('/releases'))
    ])
    products.value = productRes.data.items || []
    releases.value = releaseRes.data.items || []
    if (!releaseForm.productCode && products.value[0]) {
      releaseForm.productCode = products.value.find(item => item.is_primary)?.product_code || products.value[0].product_code
    }
  } catch (error) {
    toast.add({ title: errorMessage(error, '加载版本数据失败'), color: 'error' })
  } finally {
    loading.value = false
  }
}

let releaseDetailRequest = 0

async function openRelease(release: ProductVersion) {
  const request = ++releaseDetailRequest
  selectedRelease.value = release
  detailLoading.value = true
  try {
    const res = await $fetch<ApiResponse<ProductVersion>>(projectApiPath(`/releases/${release.id}`))
    if (request !== releaseDetailRequest) return
    selectedRelease.value = res.data
  } catch (error) {
    if (request === releaseDetailRequest) toast.add({ title: errorMessage(error, '加载版本详情失败'), color: 'error' })
  } finally {
    if (request === releaseDetailRequest) detailLoading.value = false
  }
}

async function saveProduct() {
  if (!canManageProducts.value) return
  if (!productForm.productCode.trim()) return
  savingProduct.value = true
  try {
    await $fetch(projectApiPath('/products'), {
      method: 'POST',
      body: {
        product_code: productForm.productCode.trim(),
        product_name: productForm.productName.trim() || null,
        is_primary: productForm.isPrimary
      }
    })
    showProductModal.value = false
    productForm.productCode = ''
    productForm.productName = ''
    productForm.isPrimary = true
    await loadAll()
    toast.add({ title: '产品关联已保存', color: 'success' })
  } catch (error) {
    toast.add({ title: errorMessage(error, '保存产品关联失败'), color: 'error' })
  } finally {
    savingProduct.value = false
  }
}

async function createRelease() {
  if (!releaseForm.productCode) return
  showReleaseModal.value = false
  await navigateTo(`/products/${encodeURIComponent(releaseForm.productCode)}/versions`)
}

async function openAttachModal() {
  if (!selectedRelease.value || !canAttachItems.value || attachingItems.value) return
  attachError.value = ''
  attachForm.workItemIds = []
  attachForm.featureId = null
  const releaseId = selectedRelease.value.id
  try {
    const res = await $fetch<ApiResponse<{ items: WorkItemOption[] }>>(projectApiPath('/work-items'), {
      params: { tier: 'target', pageSize: 100 }
    })
    if (selectedRelease.value?.id !== releaseId || !canAttachItems.value) return
    targetOptions.value = res.data.items || []
    showAttachModal.value = true
  } catch (error) {
    toast.add({ title: errorMessage(error, '读取目标工作项失败，请重试'), color: 'error' })
  }
}

async function attachItems() {
  if (!selectedRelease.value || !canAttachItems.value || attachingItems.value || attachForm.workItemIds.length === 0) return
  const release = selectedRelease.value
  const requestPath = projectApiPath(`/releases/${release.id}/items`)
  const payload = { work_item_ids: [...attachForm.workItemIds], feature_id: attachForm.featureId }
  attachError.value = ''
  attachingItems.value = true
  try {
    const response = await $fetch<ApiResponse<{ attached: number, version_id: number }>>(requestPath, {
      method: 'POST',
      body: payload
    })
    if (response.code !== 0 || Number(response.data?.version_id) !== release.id || Number(response.data?.attached) !== new Set(payload.work_item_ids).size) {
      throw new Error('关联回执无效，请刷新版本后核对')
    }
    showAttachModal.value = false
    if (selectedRelease.value?.id === release.id) await openRelease(release)
    await loadAll()
    toast.add({ title: '目标已挂接到版本', color: 'success' })
  } catch (error) {
    attachError.value = errorMessage(error, '挂接目标失败，请刷新版本后重试；选择已保留')
  } finally {
    attachingItems.value = false
  }
}

function formatDate(value: string | null | undefined) {
  return value ? String(value).slice(0, 10) : '-'
}

function errorMessage(error: unknown, fallback: string) {
  const err = error as { data?: { message?: string }, message?: string }
  return err?.data?.message || err?.message || fallback
}

onMounted(loadAll)
</script>

<template>
  <UDashboardPanel id="project-releases" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex flex-col h-full min-h-0">
        <ProjectNavbar>
          <template v-if="!loading && moduleEnabled" #actions>
            <UButton
              v-if="canManageProducts"
              icon="i-lucide-box"
              color="neutral"
              variant="soft"
              @click="openProductModal"
            >
              关联产品
            </UButton>
            <UButton
              v-if="canManageVersions"
              icon="i-lucide-plus"
              color="primary"
              @click="showReleaseModal = true"
            >
              新建版本
            </UButton>
          </template>
        </ProjectNavbar>

        <ProjectModuleDisabledState
          v-if="project && !moduleEnabled"
          title="版本模块未启用"
        />
        <div
          v-else
          class="flex-1 min-h-0 overflow-y-auto p-4"
        >
          <div v-if="loading" class="flex justify-center py-12">
            <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
          </div>

          <div v-else class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div class="space-y-4">
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <span class="font-semibold">关联产品</span>
                    <UBadge color="neutral" variant="subtle">
                      {{ products.length }}
                    </UBadge>
                  </div>
                </template>
                <div v-if="products.length === 0" class="text-sm text-muted py-6 text-center">
                  当前项目尚未关联产品
                </div>
                <div v-else class="grid gap-2 sm:grid-cols-2">
                  <div v-for="product in products" :key="product.id" class="rounded-md border border-default p-3">
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <div class="font-medium truncate">
                          {{ product.product_name || product.product_code }}
                        </div>
                        <div class="text-xs text-muted font-mono">
                          {{ product.product_code }}
                        </div>
                      </div>
                      <UBadge v-if="product.is_primary" color="primary" variant="soft">
                        主产品
                      </UBadge>
                    </div>
                    <div class="mt-2 text-xs text-muted">
                      {{ product.version_code ? `限定 ${product.version_code}` : '全版本' }}
                    </div>
                  </div>
                </div>
              </UCard>

              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <span class="font-semibold">版本列表</span>
                    <UBadge color="neutral" variant="subtle">
                      {{ releases.length }}
                    </UBadge>
                  </div>
                </template>
                <div v-if="releases.length === 0" class="text-sm text-muted py-10 text-center">
                  暂无版本
                </div>
                <div v-else class="divide-y divide-default">
                  <button
                    v-for="release in releases"
                    :key="release.id"
                    type="button"
                    class="w-full text-left py-3 hover:bg-elevated/50 px-2 rounded-md"
                    @click="openRelease(release)"
                  >
                    <div class="flex items-center justify-between gap-4">
                      <div class="min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="font-semibold">{{ release.version_code }}</span>
                          <UBadge :color="(statusColor[release.status] as any)" variant="subtle">
                            {{ statusLabel[release.status] || release.status }}
                          </UBadge>
                        </div>
                        <div class="text-sm text-muted truncate">
                          {{ release.product_name || release.product_code }} · {{ release.name || '未命名版本' }}
                        </div>
                      </div>
                      <div class="w-36">
                        <UProgress :model-value="Number(release.progress_percent || 0)" />
                        <div class="text-xs text-muted mt-1 text-right">
                          {{ release.completed_count || 0 }}/{{ release.target_count || 0 }}
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
              </UCard>
            </div>

            <UCard>
              <template #header>
                <div class="flex items-center justify-between">
                  <span class="font-semibold">版本详情</span>
                  <div v-if="selectedRelease && canManageVersions" class="flex items-center gap-1">
                    <UButton
                      :to="`/products/${encodeURIComponent(selectedRelease.product_code)}/versions/${selectedRelease.id}`"
                      size="xs"
                      variant="soft"
                      color="primary"
                    >
                      在产品中心管理版本
                    </UButton>
                  </div>
                </div>
              </template>

              <div v-if="!selectedRelease" class="text-sm text-muted py-12 text-center">
                选择一个版本查看详情
              </div>
              <div v-else-if="detailLoading" class="flex justify-center py-12">
                <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
              </div>
              <div v-else class="space-y-5">
                <div>
                  <div class="flex items-center gap-2">
                    <h2 class="text-lg font-semibold">
                      {{ selectedRelease.version_code }}
                    </h2>
                    <UBadge :color="(statusColor[selectedRelease.status] as any)" variant="subtle">
                      {{ statusLabel[selectedRelease.status] || selectedRelease.status }}
                    </UBadge>
                  </div>
                  <p class="text-sm text-muted">
                    {{ selectedRelease.name || '未命名版本' }}
                  </p>
                  <p class="text-xs text-muted mt-1">
                    计划发布日期：{{ formatDate(selectedRelease.planned_release_date) }}
                  </p>
                </div>

                <div>
                  <div class="flex items-center justify-between mb-2">
                    <span class="font-medium">功能特性</span>
                    <UButton
                      v-if="canManageVersions"
                      size="xs"
                      icon="i-lucide-plus"
                      variant="soft"
                      :to="`/products/${encodeURIComponent(selectedRelease.product_code)}/versions/${selectedRelease.id}/features`"
                    >
                      添加
                    </UButton>
                  </div>
                  <div v-if="!(selectedRelease.features || []).length" class="text-sm text-muted py-4">
                    暂无特性
                  </div>
                  <div v-else class="space-y-2">
                    <div v-for="feature in selectedRelease.features" :key="feature.id" class="rounded-md border border-default p-3">
                      <div class="flex items-center justify-between gap-3">
                        <span class="font-medium">{{ feature.title }}</span>
                        <UBadge :color="(featureStatusColor[feature.status] as any)" variant="subtle">
                          {{ featureStatusLabel[feature.status] || feature.status }}
                        </UBadge>
                      </div>
                      <div class="mt-1 text-xs text-muted">
                        {{ feature.category || '未分类' }} · {{ feature.is_public ? '对外可见' : '内部' }} · {{ feature.completed_count || 0 }}/{{ feature.target_count || 0 }}
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div class="flex items-center justify-between mb-2">
                    <span class="font-medium">功能清单</span>
                    <UButton
                      v-if="canAttachItems"
                      size="xs"
                      icon="i-lucide-link"
                      variant="soft"
                      @click="openAttachModal"
                    >
                      挂接目标
                    </UButton>
                  </div>
                  <div v-if="!(selectedRelease.items || []).length" class="text-sm text-muted py-4">
                    暂无 target 工作项
                  </div>
                  <div v-else class="space-y-2">
                    <div v-for="item in selectedRelease.items" :key="item.id" class="rounded-md border border-default p-3">
                      <div class="font-medium">
                        {{ item.item_key }} {{ item.title }}
                      </div>
                      <div class="text-xs text-muted mt-1">
                        {{ item.status }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </UCard>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="showProductModal">
    <template #header>
      <div class="font-semibold">
        关联产品
      </div>
    </template>
    <template #body>
      <div class="space-y-4">
        <UFormField label="搜索产品">
          <UInput
            v-model="productAssetSearch"
            icon="i-lucide-search"
            placeholder="输入产品名称或编码搜索"
            class="w-full"
          />
        </UFormField>
        <UFormField label="产品" required>
          <USelectMenu
            :model-value="selectedProductCode"
            :items="productAssetSelectOptions"
            :loading="loadingProductAssets"
            value-key="value"
            label-key="label"
            searchable
            placeholder="请选择产品"
            class="w-full"
            @update:model-value="applySelectedProduct(String($event || ''))"
          />
        </UFormField>
        <div v-if="productForm.productCode" class="rounded-md border border-default p-3 text-sm">
          <div class="font-medium">
            {{ productForm.productName || productForm.productCode }}
          </div>
          <div class="text-xs text-muted font-mono mt-1">
            {{ productForm.productCode }}
          </div>
        </div>
        <UCheckbox v-model="productForm.isPrimary" label="设为主产品" />
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="showProductModal = false">
          取消
        </UButton>
        <UButton :loading="savingProduct" @click="saveProduct">
          保存
        </UButton>
      </div>
    </template>
  </UModal>

  <UModal v-model:open="showReleaseModal">
    <template #header>
      <div class="font-semibold">
        选择要规划版本的产品
      </div>
    </template>
    <template #body>
      <div class="space-y-4">
        <UFormField label="产品" required>
          <USelect v-model="releaseForm.productCode" :items="productOptions" class="w-full" />
        </UFormField>
        <p class="text-sm text-muted">
          在产品中心规划版本，再按选定范围安排交付项目。创建版本需要对应产品权限。
        </p>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="showReleaseModal = false">
          取消
        </UButton>
        <UButton :disabled="!releaseForm.productCode" @click="createRelease">
          前往产品中心
        </UButton>
      </div>
    </template>
  </UModal>

  <UModal v-model:open="showAttachModal" :dismissible="!attachingItems" :close="!attachingItems">
    <template #header>
      <div class="font-semibold">
        挂接目标
      </div>
    </template>
    <template #body>
      <div class="space-y-4">
        <UAlert v-if="attachError" color="error" :title="attachError" />
        <UFormField label="目标工作项" required>
          <USelectMenu
            v-model="attachForm.workItemIds"
            :disabled="attachingItems"
            multiple
            :items="targetSelectOptions"
            value-key="value"
            label-key="label"
            class="w-full"
          />
        </UFormField>
        <UFormField label="归入特性">
          <USelect
            v-model="attachForm.featureId"
            :items="featureOptions"
            :disabled="attachingItems"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="attachingItems"
          @click="showAttachModal = false"
        >
          取消
        </UButton>
        <UButton :loading="attachingItems" :disabled="!canAttachItems || !attachForm.workItemIds.length" @click="attachItems">
          挂接
        </UButton>
      </div>
    </template>
  </UModal>
</template>
