<script setup lang="ts">
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

const products = ref<ProjectProduct[]>([])
const releases = ref<ProductVersion[]>([])
const selectedRelease = ref<ProductVersion | null>(null)
const targetOptions = ref<WorkItemOption[]>([])
const loading = ref(false)
const detailLoading = ref(false)
const savingProduct = ref(false)
const savingRelease = ref(false)
const savingFeature = ref(false)
const attachingItems = ref(false)
const loadingProductAssets = ref(false)
const showProductModal = ref(false)
const showReleaseModal = ref(false)
const showFeatureModal = ref(false)
const showAttachModal = ref(false)
const productAssetSearch = ref('')
const productAssetOptions = ref<ProductAssetOption[]>([])
const selectedProductCode = ref('')

const productForm = reactive({
  productCode: '',
  productName: '',
  isPrimary: true
})

const releaseForm = reactive({
  productCode: '',
  versionCode: '',
  name: '',
  plannedReleaseDate: ''
})

const featureForm = reactive({
  title: '',
  category: '',
  isPublic: true
})

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

const canManageVersions = computed(() => {
  const project = projectStore.currentProject
  return project?.category === 'product_dev' && project.currentUserRole === 'manager'
})

const productOptions = computed(() => products.value.map(product => ({
  label: `${product.product_name || product.product_code} (${product.product_code})`,
  value: product.product_code
})))

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

async function openRelease(release: ProductVersion) {
  selectedRelease.value = release
  detailLoading.value = true
  try {
    const res = await $fetch<ApiResponse<ProductVersion>>(projectApiPath(`/releases/${release.id}`))
    selectedRelease.value = res.data
  } catch (error) {
    toast.add({ title: errorMessage(error, '加载版本详情失败'), color: 'error' })
  } finally {
    detailLoading.value = false
  }
}

async function saveProduct() {
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
  if (!releaseForm.productCode || !releaseForm.versionCode.trim()) return
  savingRelease.value = true
  try {
    const res = await $fetch<ApiResponse<ProductVersion>>(projectApiPath('/releases'), {
      method: 'POST',
      body: {
        product_code: releaseForm.productCode,
        version_code: releaseForm.versionCode.trim(),
        name: releaseForm.name.trim() || null,
        planned_release_date: releaseForm.plannedReleaseDate || null
      }
    })
    showReleaseModal.value = false
    releaseForm.versionCode = ''
    releaseForm.name = ''
    releaseForm.plannedReleaseDate = ''
    await loadAll()
    await openRelease(res.data)
    toast.add({ title: '版本已创建', color: 'success' })
  } catch (error) {
    toast.add({ title: errorMessage(error, '创建版本失败'), color: 'error' })
  } finally {
    savingRelease.value = false
  }
}

async function transitionRelease(toStatus: string) {
  if (!selectedRelease.value) return
  try {
    const res = await $fetch<ApiResponse<ProductVersion>>(projectApiPath(`/releases/${selectedRelease.value.id}/transition`), {
      method: 'POST',
      body: { to_status: toStatus }
    })
    selectedRelease.value = res.data
    await loadAll()
    toast.add({ title: '版本状态已更新', color: 'success' })
  } catch (error) {
    toast.add({ title: errorMessage(error, '版本状态更新失败'), color: 'error' })
  }
}

async function createFeature() {
  if (!selectedRelease.value || !featureForm.title.trim()) return
  savingFeature.value = true
  try {
    await $fetch(projectApiPath(`/releases/${selectedRelease.value.id}/features`), {
      method: 'POST',
      body: {
        title: featureForm.title.trim(),
        category: featureForm.category.trim() || null,
        is_public: featureForm.isPublic
      }
    })
    showFeatureModal.value = false
    featureForm.title = ''
    featureForm.category = ''
    featureForm.isPublic = true
    await openRelease(selectedRelease.value)
    toast.add({ title: '特性已添加', color: 'success' })
  } catch (error) {
    toast.add({ title: errorMessage(error, '添加特性失败'), color: 'error' })
  } finally {
    savingFeature.value = false
  }
}

async function openAttachModal() {
  if (!selectedRelease.value) return
  attachForm.workItemIds = []
  attachForm.featureId = null
  const res = await $fetch<ApiResponse<{ items: WorkItemOption[] }>>(projectApiPath('/work-items'), {
    params: { tier: 'target', pageSize: 100 }
  })
  targetOptions.value = res.data.items || []
  showAttachModal.value = true
}

async function attachItems() {
  if (!selectedRelease.value || attachForm.workItemIds.length === 0) return
  attachingItems.value = true
  try {
    await $fetch(projectApiPath(`/releases/${selectedRelease.value.id}/items`), {
      method: 'POST',
      body: {
        work_item_ids: attachForm.workItemIds,
        feature_id: attachForm.featureId
      }
    })
    showAttachModal.value = false
    await openRelease(selectedRelease.value)
    await loadAll()
    toast.add({ title: '目标已挂接到版本', color: 'success' })
  } catch (error) {
    toast.add({ title: errorMessage(error, '挂接目标失败'), color: 'error' })
  } finally {
    attachingItems.value = false
  }
}

function nextStatuses(status: string) {
  if (status === 'planning') return [{ label: '进入开发', value: 'developing' }]
  if (status === 'developing') return [{ label: '发布版本', value: 'released' }]
  if (status === 'released') return [{ label: '回退开发', value: 'developing' }, { label: '归档', value: 'archived' }]
  return []
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
          <template v-if="!loading" #actions>
            <UButton
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

        <div class="flex-1 min-h-0 overflow-y-auto p-4">
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
                      v-for="action in nextStatuses(selectedRelease.status)"
                      :key="action.value"
                      size="xs"
                      variant="soft"
                      color="primary"
                      @click="transitionRelease(action.value)"
                    >
                      {{ action.label }}
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
                      @click="showFeatureModal = true"
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
        新建版本
      </div>
    </template>
    <template #body>
      <div class="space-y-4">
        <UFormField label="产品" required>
          <USelect v-model="releaseForm.productCode" :items="productOptions" class="w-full" />
        </UFormField>
        <UFormField label="版本号" required>
          <UInput v-model="releaseForm.versionCode" placeholder="v2.1.0" class="w-full" />
        </UFormField>
        <UFormField label="版本名称">
          <UInput v-model="releaseForm.name" class="w-full" />
        </UFormField>
        <UFormField label="计划发布日期">
          <UInput v-model="releaseForm.plannedReleaseDate" type="date" class="w-full" />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="showReleaseModal = false">
          取消
        </UButton>
        <UButton :loading="savingRelease" @click="createRelease">
          创建
        </UButton>
      </div>
    </template>
  </UModal>

  <UModal v-model:open="showFeatureModal">
    <template #header>
      <div class="font-semibold">
        添加功能特性
      </div>
    </template>
    <template #body>
      <div class="space-y-4">
        <UFormField label="标题" required>
          <UInput v-model="featureForm.title" class="w-full" />
        </UFormField>
        <UFormField label="分类">
          <UInput v-model="featureForm.category" class="w-full" />
        </UFormField>
        <UCheckbox v-model="featureForm.isPublic" label="对外可见" />
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="showFeatureModal = false">
          取消
        </UButton>
        <UButton :loading="savingFeature" @click="createFeature">
          添加
        </UButton>
      </div>
    </template>
  </UModal>

  <UModal v-model:open="showAttachModal">
    <template #header>
      <div class="font-semibold">
        挂接目标
      </div>
    </template>
    <template #body>
      <div class="space-y-4">
        <UFormField label="目标工作项" required>
          <USelectMenu
            v-model="attachForm.workItemIds"
            multiple
            :items="targetSelectOptions"
            value-key="value"
            label-key="label"
            class="w-full"
          />
        </UFormField>
        <UFormField label="归入特性">
          <USelect v-model="attachForm.featureId" :items="featureOptions" class="w-full" />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="showAttachModal = false">
          取消
        </UButton>
        <UButton :loading="attachingItems" @click="attachItems">
          挂接
        </UButton>
      </div>
    </template>
  </UModal>
</template>
