<script setup lang="ts">
import { useAimsModule } from '../../../../layer/useAimsModule'
import ProductsStructureModuleManager from '../../../components/products/StructureModuleManager.vue'
import ProductsStructureModuleTree from '../../../components/products/StructureModuleTree.vue'

const { moduleUrl, hosted, cacheKey } = useAimsModule()
definePageMeta({ layoutHeader: true, layoutHeaderTitle: '产品结构', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const productPath = computed(() => moduleUrl(`/products/${encodeURIComponent(code.value)}`))
const base = computed(() => moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}`))
const states = { candidate: '候选', active: '已生效', deprecated: '已弃用' }
interface Feature { component_id: number | null, biz_id: string, product_code: string, title: string, description: string | null, lifecycle: keyof typeof states, revision: number }
const { search, debounced, flush } = useDebouncedSearch()
const lifecycle = ref('all'), moduleFilter = ref('all')
const { page, pageSize } = useListPage({ pageSize: 20, filters: { keyword: search, lifecycle, module: moduleFilter }, defaults: { keyword: '', lifecycle: 'all', module: 'all' } })
flush()
const selectedModule = ref<{ id: number, name: string } | null>(null)
const selectedId = computed(() => /^[1-9]\d*$/.test(moduleFilter.value) && Number.isSafeInteger(Number(moduleFilter.value)) ? Number(moduleFilter.value) : null)
const invalidModule = computed(() => !['all', 'ungrouped'].includes(moduleFilter.value) && selectedId.value === null)
const moduleLabel = computed(() => moduleFilter.value === 'all' ? '全部功能' : moduleFilter.value === 'ungrouped' ? '未分类功能' : selectedModule.value?.id === selectedId.value ? selectedModule.value.name : '当前模块')
const query = computed(() => ({ page: page.value, pageSize, keyword: debounced.value || undefined, lifecycle: lifecycle.value === 'all' ? undefined : lifecycle.value, componentId: selectedId.value ?? undefined, ungrouped: moduleFilter.value === 'ungrouped' ? 'true' : undefined }))
const { data, status, error, refresh } = await useFetch(() => `${base.value}/features`, { ...(hosted ? { key: computed(() => cacheKey('structure:1' + ':' + String(code.value))) } : {}),
  server: false,
  query,
  transform: (response: { code: number, data: { items: Feature[], total: number } }) => {
    if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0 || response.data.items.length > pageSize || response.data.items.some(item => item.product_code !== code.value || (item.component_id !== null && (!Number.isSafeInteger(item.component_id) || item.component_id < 1)) || (moduleFilter.value === 'ungrouped' && item.component_id !== null) || (selectedId.value !== null && item.component_id !== selectedId.value) || !item.biz_id || !Object.hasOwn(states, item.lifecycle))) throw new Error('功能列表响应不完整')
    return response.data
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '功能列表加载失败' })
const { data: requestPermission } = await useFetch<{ code: number, data: { product_code: string, status: string, create: boolean } }>(() => `${base.value}/requests/permissions`, { ...(hosted ? { key: computed(() => cacheKey('structure:2' + ':' + String(code.value))) } : {}), server: false })
const canCreateRequest = computed(() => requestPermission.value?.code === 0 && requestPermission.value.data?.product_code === code.value && requestPermission.value.data.status === 'active' && requestPermission.value.data.create === true)
const { data: permissions } = await useFetch<{ code: number, data: { product_code: string, status: string, edit: boolean, delete: boolean } }>(() => `${base.value}/components/permissions`, { ...(hosted ? { key: computed(() => cacheKey('structure:3' + ':' + String(code.value))) } : {}), server: false })
const canManage = computed(() => permissions.value?.code === 0 && permissions.value.data?.product_code === code.value && permissions.value.data.status === 'active' && (permissions.value.data.edit === true || permissions.value.data.delete === true))
const { data: featurePermission, status: featurePermissionStatus, refresh: refreshFeaturePermission } = await useFetch<{ code: number, data: { product_code: string, status: string, revision: number, edit: boolean } }>(() => `${base.value}/features/permissions`, { ...(hosted ? { key: computed(() => cacheKey('structure:4' + ':' + String(code.value))) } : {}), server: false })
const canCreateFeature = computed(() => featurePermissionStatus.value === 'success' && featurePermission.value?.code === 0 && featurePermission.value.data.product_code === code.value && featurePermission.value.data.status === 'active' && featurePermission.value.data.edit === true && Number.isSafeInteger(featurePermission.value.data.revision) && featurePermission.value.data.revision > 0)
const featureCreateOpen = ref(false), featureCreateBusy = ref(false), featureExpectedRevision = ref(0)
const featureDraft = reactive({ title: '', description: '' })
const featureCreateError = ref<Error | null>(null)
const featureCreateAlert = useApiErrorAlert(featureCreateError, { fallbackTitle: '新增功能失败' })
const toast = useToast()
let featureRetry: { payload: string, key: string } | undefined
async function openFeatureCreate() {
  await refreshFeaturePermission()
  if (!canCreateFeature.value) return
  featureExpectedRevision.value = featurePermission.value!.data.revision
  Object.assign(featureDraft, { title: '', description: '' })
  featureCreateError.value = null
  featureRetry = undefined
  featureCreateOpen.value = true
}
async function createFeature() {
  if (!featureCreateOpen.value || featureCreateBusy.value || !canCreateFeature.value || !featureDraft.title.trim()) return
  const body = { expectedRevision: featureExpectedRevision.value, title: featureDraft.title.trim(), description: featureDraft.description.trim() }
  const payload = JSON.stringify({ productCode: code.value, body })
  if (featureRetry?.payload !== payload) featureRetry = { payload, key: crypto.randomUUID() }
  featureCreateBusy.value = true
  featureCreateError.value = null
  try {
    const result = await $fetch<{ code: number, data: { value: { biz_id: string, product_code: string, title: string, lifecycle: string, revision: number } } }>(`${base.value}/features`, { method: 'POST', body, headers: { 'Idempotency-Key': featureRetry.key } })
    const value = result.data?.value
    if (result.code !== 0 || value?.product_code !== code.value || value.title !== body.title || value.lifecycle !== 'candidate' || value.revision !== 1 || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(value.biz_id)) throw new Error('功能创建结果不完整，请用原请求重试')
    featureCreateOpen.value = false
    featureRetry = undefined
    toast.add({ title: '产品功能已创建', color: 'success' })
    search.value = ''
    lifecycle.value = 'all'
    moduleFilter.value = 'all'
    page.value = 1
    flush()
    await Promise.allSettled([refresh(), refreshFeaturePermission()])
  } catch (cause) {
    featureCreateError.value = cause instanceof Error ? cause : new Error('新增功能失败，请用原请求重试')
  } finally {
    featureCreateBusy.value = false
  }
}
const managing = ref(false), managingBusy = ref(false), mobileTree = ref(false), treeRevision = ref(0)
const requestModuleContext = computed(() => selectedId.value ? { moduleId: String(selectedId.value), ...(selectedModule.value?.id === selectedId.value ? { moduleNameId: String(selectedId.value), moduleName: selectedModule.value.name } : {}) } : {})
const requestPath = computed(() => ({ path: `${productPath.value}/requests`, query: selectedId.value ? { ...requestModuleContext.value, includeDescendants: 'true' } : moduleFilter.value === 'ungrouped' ? { unassigned: 'true' } : {} }))
function selectModule(value: { id: number, name: string }) {
  selectedModule.value = value
  moduleFilter.value = String(value.id)
  mobileTree.value = false
}
async function modulesChanged() {
  treeRevision.value++
  // 模块可能已改名、移动或删除；清除旧选择，展示刷新后的完整结构。
  selectedModule.value = null
  moduleFilter.value = 'all'
  await refresh()
}
onBeforeRouteLeave(() => !managingBusy.value && !featureCreateBusy.value)
onBeforeRouteUpdate(() => !managingBusy.value && !featureCreateBusy.value)
</script>

<template>
  <div class="mx-auto min-w-0 max-w-7xl space-y-4 p-4 sm:p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="max-w-2xl text-sm text-muted">
        按模块查看和维护产品的长期功能。待评估的新想法可先登记到需求池，再安排版本实现。
      </p>
      <div class="flex flex-wrap gap-2">
        <UButton v-if="canCreateFeature" icon="i-lucide-plus" @click="openFeatureCreate">
          新增功能
        </UButton>
        <UButton
          v-if="canCreateRequest"
          :to="{ path: `${productPath}/requests`, query: { ...requestModuleContext, create: 'true' } }"
          icon="i-lucide-plus"
          color="neutral"
          variant="outline"
        >
          新增需求
        </UButton>
      </div>
    </div>
    <div class="grid min-w-0 gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside class="min-w-0 self-start rounded-lg border border-default p-3" aria-label="产品模块选择">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-sm font-semibold">
            产品模块
          </h2>
          <UButton
            v-if="canManage"
            size="sm"
            color="neutral"
            variant="ghost"
            icon="i-lucide-settings-2"
            @click="managing = true"
          >
            管理模块
          </UButton>
        </div>
        <UButton
          color="neutral"
          variant="outline"
          class="mt-3 w-full justify-between lg:hidden"
          trailing-icon="i-lucide-chevron-down"
          :aria-expanded="mobileTree"
          @click="mobileTree = !mobileTree"
        >
          {{ moduleLabel }}
        </UButton>
        <div class="mt-3 space-y-2" :class="mobileTree ? '' : 'hidden lg:block'">
          <UButton
            class="w-full justify-start"
            :color="moduleFilter === 'all' ? 'primary' : 'neutral'"
            variant="ghost"
            :aria-pressed="moduleFilter === 'all'"
            icon="i-lucide-boxes"
            @click="moduleFilter = 'all'; mobileTree = false"
          >
            全部功能
          </UButton>
          <UButton
            class="w-full justify-start"
            :color="moduleFilter === 'ungrouped' ? 'primary' : 'neutral'"
            variant="ghost"
            :aria-pressed="moduleFilter === 'ungrouped'"
            icon="i-lucide-inbox"
            @click="moduleFilter = 'ungrouped'; mobileTree = false"
          >
            未分类功能
          </UButton>
          <ProductsStructureModuleTree
            :key="`${code}:${treeRevision}`"
            :product-code="code"
            :selected="moduleFilter"
            @select="selectModule"
          />
        </div>
      </aside>
      <section class="min-w-0 space-y-4" aria-label="模块功能清单">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0">
            <h2 class="break-words text-base font-semibold">
              {{ moduleLabel }}
            </h2>
            <p v-if="selectedId" class="mt-1 text-xs text-muted">
              仅显示直接归属此模块的功能；子模块可展开后选择。
            </p>
          </div>
          <UButton
            :to="requestPath"
            color="neutral"
            variant="outline"
            size="sm"
          >
            查看相关需求
          </UButton>
        </div>
        <form class="flex flex-wrap items-end gap-3" @submit.prevent="flush">
          <UFormField label="搜索功能" class="min-w-0 basis-48 grow">
            <UInput
              v-model="search"
              class="w-full"
              placeholder="标题或说明"
              @keydown.enter="flush"
            />
          </UFormField>
          <UFormField label="生命周期">
            <USelect v-model="lifecycle" :items="[{ label: '全部', value: 'all' }, ...Object.entries(states).map(([value, label]) => ({ value, label }))]" />
          </UFormField>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-refresh-cw"
            :loading="status === 'pending'"
            @click="refresh()"
          >
            刷新
          </UButton>
        </form>
        <UAlert
          v-if="invalidModule"
          color="warning"
          title="模块筛选无效"
          description="请从左侧模块列表重新选择。"
        />
        <UAlert v-else-if="alert" v-bind="alert" />
        <p v-else-if="status === 'pending'" role="status" class="text-sm text-muted">
          正在加载功能…
        </p>
        <template v-else-if="status === 'success' && data">
          <CommonEmptyState
            v-if="!data.items.length"
            icon="i-lucide-box"
            title="暂无符合条件的功能"
            description="可调整模块、搜索或生命周期筛选；待建设的新想法请先登记到需求池。"
          />
          <article v-for="item in data.items" :key="item.biz_id" class="min-w-0 space-y-2 rounded-lg border border-default p-4">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <NuxtLink :to="`${productPath}/features/${encodeURIComponent(item.biz_id)}`" class="min-w-0 break-words font-medium text-primary hover:underline">{{ item.title }}</NuxtLink>
              <UBadge color="neutral" variant="subtle">
                {{ states[item.lifecycle] }}
              </UBadge>
            </div>
            <p class="line-clamp-3 whitespace-pre-wrap break-words text-sm text-muted">
              {{ item.description || '暂无说明' }}
            </p>
          </article>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="text-sm text-muted">
              共 {{ data.total }} 项功能
            </p>
            <UPagination
              v-if="data.total > pageSize"
              v-model:page="page"
              :total="data.total"
              :items-per-page="pageSize"
              :sibling-count="0"
            />
          </div>
        </template>
      </section>
    </div>
    <USlideover
      v-model:open="managing"
      title="管理产品模块"
      description="维护模块名称、层级与排序，功能清单仍在产品结构中查看。"
      :dismissible="!managingBusy"
      :close="!managingBusy"
      :ui="{ content: 'sm:max-w-2xl' }"
    >
      <template #body>
        <ProductsStructureModuleManager
          v-if="managing"
          @busy="managingBusy = $event"
          @changed="modulesChanged"
          @select="value => { selectModule(value); managing = false }"
        />
      </template>
    </USlideover>
    <UModal
      v-model:open="featureCreateOpen"
      title="新增产品功能"
      description="先创建候选功能，之后可在功能详情中归入产品模块。"
      :dismissible="!featureCreateBusy"
      :close="!featureCreateBusy"
    >
      <template #body>
        <div class="space-y-4 p-4">
          <UAlert v-if="featureCreateAlert" v-bind="featureCreateAlert" />
          <UFormField label="功能名称" required>
            <UInput
              v-model="featureDraft.title"
              class="w-full"
              :maxlength="500"
              placeholder="例如：用户登录"
            />
          </UFormField>
          <UFormField label="说明">
            <UTextarea
              v-model="featureDraft.description"
              class="w-full"
              :maxlength="10000"
              :rows="4"
              placeholder="描述功能边界与用途"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="outline"
            :disabled="featureCreateBusy"
            @click="featureCreateOpen = false"
          >
            取消
          </UButton>
          <UButton :loading="featureCreateBusy" :disabled="!featureDraft.title.trim()" @click="createFeature">
            创建功能
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
