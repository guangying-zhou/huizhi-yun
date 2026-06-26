<script setup lang="ts">
import { getPCA } from 'lcn'
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('区域管理')

type ApiResponse<T> = {
  code?: number
  data: T
  message?: string
}

type Company = {
  companyCode: string
  companyName: string
}

type Region = {
  id: number
  companyCode: string | null
  regionCode: string
  regionName: string
  description: string | null
  sortOrder: number
  divisionCount: number
}

type DivisionMapping = {
  id: number
  divisionCode: string
  includeChildren: boolean
}

const toast = useToast()
const loading = ref(false)
const saving = ref(false)
const companyCode = ref('')
const regions = ref<Region[]>([])
const search = ref('')

const showCreateModal = ref(false)
const showEditModal = ref(false)
const showDivisionModal = ref(false)
const editingRegion = ref<Region | null>(null)
const divisionRegion = ref<Region | null>(null)
const divisionLoading = ref(false)
const selectedCodes = ref<string[]>([])
const expandedProvinces = ref<string[]>([])

const createForm = ref({
  regionCode: '',
  regionName: '',
  description: '',
  sortOrder: 100
})

const editForm = ref({
  regionName: '',
  description: '',
  sortOrder: 100
})

const provinceData = getPCA({ emptyChildrenValue: 'none' })

const visibleRegions = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  if (!keyword) return regions.value
  return regions.value.filter(region => [
    region.regionCode,
    region.regionName,
    region.description || ''
  ].join(' ').toLowerCase().includes(keyword))
})

const selectedSummary = computed(() => {
  let provinceCount = 0
  let cityCount = 0
  for (const province of provinceData) {
    const provinceCode = province.code || ''
    const children = province.children || []
    if (!children.length) {
      if (selectedCodes.value.includes(provinceCode)) provinceCount++
    } else if (isProvinceAllSelected(provinceCode)) {
      provinceCount++
    } else {
      cityCount += children.filter(city => selectedCodes.value.includes(city.code || '')).length
    }
  }
  return { provinceCount, cityCount, total: selectedCodes.value.length }
})

async function loadCompanyCode() {
  if (companyCode.value) return companyCode.value
  const res = await $fetch<ApiResponse<Company[]>>('/api/v1/companies')
  const company = res.data[0]
  if (!company?.companyCode) throw new Error('未找到企业资料，请先完成 Console 激活')
  companyCode.value = company.companyCode
  return companyCode.value
}

async function loadRegions() {
  loading.value = true
  try {
    const code = await loadCompanyCode()
    const res = await $fetch<ApiResponse<Region[]>>(`/api/v1/companies/${code}/regions`)
    regions.value = res.data
  } catch (error) {
    toast.add({ color: 'error', title: '加载失败', description: error instanceof Error ? error.message : String(error) })
  } finally {
    loading.value = false
  }
}

async function initFromTemplate() {
  if (!confirm('将从标准七大区模板初始化，已有区域不会被覆盖。继续？')) return
  saving.value = true
  try {
    const code = await loadCompanyCode()
    await $fetch(`/api/v1/companies/${code}/regions`, {
      method: 'POST',
      query: { fromTemplate: 'STANDARD_7' }
    })
    toast.add({ color: 'success', title: '初始化成功' })
    await loadRegions()
  } catch (error) {
    toast.add({ color: 'error', title: '初始化失败', description: error instanceof Error ? error.message : String(error) })
  } finally {
    saving.value = false
  }
}

function openCreateModal() {
  createForm.value = { regionCode: '', regionName: '', description: '', sortOrder: 100 }
  showCreateModal.value = true
}

async function createRegion() {
  if (!createForm.value.regionCode || !createForm.value.regionName) {
    toast.add({ color: 'warning', title: '编码和名称不能为空' })
    return
  }

  saving.value = true
  try {
    const code = await loadCompanyCode()
    await $fetch(`/api/v1/companies/${code}/regions`, {
      method: 'POST',
      body: createForm.value
    })
    toast.add({ color: 'success', title: '创建成功' })
    showCreateModal.value = false
    await loadRegions()
  } catch (error) {
    toast.add({ color: 'error', title: '创建失败', description: error instanceof Error ? error.message : String(error) })
  } finally {
    saving.value = false
  }
}

function openEditModal(region: Region) {
  editingRegion.value = region
  editForm.value = {
    regionName: region.regionName,
    description: region.description || '',
    sortOrder: region.sortOrder
  }
  showEditModal.value = true
}

async function saveEdit() {
  if (!editingRegion.value) return
  saving.value = true
  try {
    const code = await loadCompanyCode()
    await $fetch(`/api/v1/companies/${code}/regions/${encodeURIComponent(editingRegion.value.regionCode)}`, {
      method: 'PATCH',
      body: editForm.value
    })
    toast.add({ color: 'success', title: '更新成功' })
    showEditModal.value = false
    await loadRegions()
  } catch (error) {
    toast.add({ color: 'error', title: '更新失败', description: error instanceof Error ? error.message : String(error) })
  } finally {
    saving.value = false
  }
}

async function deleteRegion(region: Region) {
  if (!confirm(`确定删除区域“${region.regionName}”及其行政区划映射？`)) return
  try {
    const code = await loadCompanyCode()
    await $fetch(`/api/v1/companies/${code}/regions/${encodeURIComponent(region.regionCode)}`, { method: 'DELETE' })
    toast.add({ color: 'success', title: '删除成功' })
    await loadRegions()
  } catch (error) {
    toast.add({ color: 'error', title: '删除失败', description: error instanceof Error ? error.message : String(error) })
  }
}

async function openDivisionModal(region: Region) {
  divisionRegion.value = region
  divisionLoading.value = true
  selectedCodes.value = []
  expandedProvinces.value = []
  showDivisionModal.value = true

  try {
    const code = await loadCompanyCode()
    const res = await $fetch<ApiResponse<DivisionMapping[]>>(`/api/v1/companies/${code}/regions/${encodeURIComponent(region.regionCode)}/divisions`)
    const codes: string[] = []
    for (const item of res.data) {
      const province = provinceData.find(provinceItem => provinceItem.code === item.divisionCode)
      if (province?.children?.length && item.includeChildren) {
        codes.push(...province.children.map(city => city.code || '').filter(Boolean))
      } else {
        codes.push(item.divisionCode)
      }
    }
    selectedCodes.value = [...new Set(codes)]
  } catch (error) {
    toast.add({ color: 'error', title: '加载区划失败', description: error instanceof Error ? error.message : String(error) })
  } finally {
    divisionLoading.value = false
  }
}

function isProvinceAllSelected(provinceCode: string) {
  const province = provinceData.find(item => item.code === provinceCode)
  const children = province?.children || []
  if (!children.length) return selectedCodes.value.includes(provinceCode)
  return children.every(city => selectedCodes.value.includes(city.code || ''))
}

function isProvincePartialSelected(provinceCode: string) {
  const province = provinceData.find(item => item.code === provinceCode)
  const children = province?.children || []
  if (!children.length) return false
  const selectedCount = children.filter(city => selectedCodes.value.includes(city.code || '')).length
  return selectedCount > 0 && selectedCount < children.length
}

function toggleProvince(provinceCode: string) {
  const province = provinceData.find(item => item.code === provinceCode)
  const children = province?.children || []
  if (!children.length) {
    selectedCodes.value = selectedCodes.value.includes(provinceCode)
      ? selectedCodes.value.filter(code => code !== provinceCode)
      : [...selectedCodes.value, provinceCode]
    return
  }

  const cityCodes = children.map(city => city.code || '').filter(Boolean)
  selectedCodes.value = isProvinceAllSelected(provinceCode)
    ? selectedCodes.value.filter(code => !cityCodes.includes(code))
    : [...new Set([...selectedCodes.value, ...cityCodes])]
}

function toggleCity(cityCode: string) {
  selectedCodes.value = selectedCodes.value.includes(cityCode)
    ? selectedCodes.value.filter(code => code !== cityCode)
    : [...selectedCodes.value, cityCode]
}

function toggleExpand(provinceCode: string) {
  expandedProvinces.value = expandedProvinces.value.includes(provinceCode)
    ? expandedProvinces.value.filter(code => code !== provinceCode)
    : [...expandedProvinces.value, provinceCode]
}

async function saveDivisions() {
  if (!divisionRegion.value) return
  saving.value = true
  try {
    const divisions: Array<{ divisionCode: string, includeChildren: boolean }> = []
    for (const province of provinceData) {
      const provinceCode = province.code || ''
      const children = province.children || []
      if (!children.length) {
        if (selectedCodes.value.includes(provinceCode)) {
          divisions.push({ divisionCode: provinceCode, includeChildren: true })
        }
      } else if (isProvinceAllSelected(provinceCode)) {
        divisions.push({ divisionCode: provinceCode, includeChildren: true })
      } else {
        for (const city of children) {
          const cityCode = city.code || ''
          if (selectedCodes.value.includes(cityCode)) {
            divisions.push({ divisionCode: cityCode, includeChildren: true })
          }
        }
      }
    }

    const code = await loadCompanyCode()
    await $fetch(`/api/v1/companies/${code}/regions/${encodeURIComponent(divisionRegion.value.regionCode)}/divisions`, {
      method: 'PUT',
      body: { divisions }
    })
    toast.add({ color: 'success', title: '保存成功' })
    showDivisionModal.value = false
    await loadRegions()
  } catch (error) {
    toast.add({ color: 'error', title: '保存失败', description: error instanceof Error ? error.message : String(error) })
  } finally {
    saving.value = false
  }
}

onMounted(loadRegions)
</script>

<template>
  <UDashboardPanel id="regions" :ui="dashboardPanelUi">
    <template #body>
      <div class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <UInput
            v-model="search"
            icon="i-lucide-search"
            placeholder="搜索区域编码、名称或描述"
            class="w-full sm:w-80"
          />
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              v-if="regions.length === 0"
              icon="i-lucide-wand-2"
              label="从标准模板初始化"
              :loading="saving"
              @click="initFromTemplate"
            />
            <UButton icon="i-lucide-plus" label="新建区域" @click="openCreateModal" />
            <UButton
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              :loading="loading"
              @click="loadRegions"
            />
          </div>
        </div>

        <div v-if="loading" class="flex min-h-80 items-center justify-center">
          <UIcon name="i-lucide-loader-2" class="size-7 animate-spin text-muted" />
        </div>

        <div v-else-if="visibleRegions.length === 0" class="flex min-h-80 flex-col items-center justify-center text-center">
          <UIcon name="i-lucide-map" class="mb-3 size-10 text-dimmed" />
          <p class="text-sm font-medium">
            暂未配置区域
          </p>
          <p class="mt-1 text-xs text-muted">
            可从标准七大区模板初始化，或按企业自己的经营区域创建。
          </p>
        </div>

        <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <UCard v-for="region in visibleRegions" :key="region.regionCode">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h3 class="truncate text-base font-semibold">
                  {{ region.regionName }}
                </h3>
                <code class="mt-1 inline-flex rounded bg-elevated px-2 py-0.5 text-xs">{{ region.regionCode }}</code>
              </div>
              <UBadge color="info" variant="subtle">
                {{ region.divisionCount }} 个区划
              </UBadge>
            </div>
            <p v-if="region.description" class="mt-3 line-clamp-2 text-sm text-muted">
              {{ region.description }}
            </p>
            <div class="mt-4 flex items-center gap-1 border-t border-default pt-3">
              <UButton
                size="xs"
                icon="i-lucide-map-pin"
                variant="ghost"
                @click="openDivisionModal(region)"
              >
                配置区划
              </UButton>
              <UButton
                size="xs"
                color="neutral"
                icon="i-lucide-pencil"
                variant="ghost"
                @click="openEditModal(region)"
              >
                编辑
              </UButton>
              <UButton
                size="xs"
                color="neutral"
                icon="i-lucide-trash-2"
                variant="ghost"
                @click="deleteRegion(region)"
              >
                删除
              </UButton>
            </div>
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="showCreateModal" title="新建区域" :ui="{ content: 'sm:max-w-lg' }">
    <template #body>
      <div class="space-y-4">
        <UFormField label="区域编码" required>
          <UInput v-model="createForm.regionCode" placeholder="如：NORTH_CHINA" class="w-full" />
        </UFormField>
        <UFormField label="区域名称" required>
          <UInput v-model="createForm.regionName" placeholder="如：华北" class="w-full" />
        </UFormField>
        <UFormField label="描述">
          <UInput v-model="createForm.description" class="w-full" />
        </UFormField>
        <UFormField label="排序">
          <UInput v-model.number="createForm.sortOrder" type="number" class="w-full" />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="outline" @click="showCreateModal = false">
          取消
        </UButton>
        <UButton :loading="saving" @click="createRegion">
          创建
        </UButton>
      </div>
    </template>
  </UModal>

  <UModal v-model:open="showEditModal" title="编辑区域" :ui="{ content: 'sm:max-w-lg' }">
    <template #body>
      <div class="space-y-4">
        <UFormField label="区域名称" required>
          <UInput v-model="editForm.regionName" class="w-full" />
        </UFormField>
        <UFormField label="描述">
          <UInput v-model="editForm.description" class="w-full" />
        </UFormField>
        <UFormField label="排序">
          <UInput v-model.number="editForm.sortOrder" type="number" class="w-full" />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="outline" @click="showEditModal = false">
          取消
        </UButton>
        <UButton :loading="saving" @click="saveEdit">
          保存
        </UButton>
      </div>
    </template>
  </UModal>

  <UModal v-model:open="showDivisionModal" :title="`${divisionRegion?.regionName || ''} - 行政区划配置`" :ui="{ content: 'sm:max-w-4xl' }">
    <template #body>
      <div v-if="divisionLoading" class="flex min-h-60 items-center justify-center">
        <UIcon name="i-lucide-loader-2" class="size-7 animate-spin text-muted" />
      </div>

      <div v-else class="max-h-[62vh] overflow-y-auto pr-1">
        <div class="space-y-1">
          <div v-for="province in provinceData" :key="province.code || ''" class="overflow-hidden rounded-md border border-default">
            <div
              class="flex items-center gap-2 px-3 py-2 hover:bg-elevated"
              :class="{ 'bg-primary/5': isProvinceAllSelected(province.code || '') || isProvincePartialSelected(province.code || '') }"
            >
              <input
                type="checkbox"
                class="rounded"
                :checked="isProvinceAllSelected(province.code || '')"
                :indeterminate="isProvincePartialSelected(province.code || '')"
                @change="toggleProvince(province.code || '')"
              >
              <button class="min-w-0 flex-1 truncate text-left text-sm font-medium" type="button" @click="toggleProvince(province.code || '')">
                {{ province.name }}
              </button>
              <span v-if="province.children?.length" class="text-xs text-muted">
                {{ province.children.filter(city => selectedCodes.includes(city.code || '')).length }}/{{ province.children.length }}
              </span>
              <UButton
                v-if="province.children?.length"
                size="xs"
                color="neutral"
                variant="ghost"
                :icon="expandedProvinces.includes(province.code || '') ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                @click.stop="toggleExpand(province.code || '')"
              />
            </div>

            <div v-if="expandedProvinces.includes(province.code || '') && province.children?.length" class="border-t border-default bg-elevated/40 p-2">
              <div class="grid gap-1 sm:grid-cols-2 md:grid-cols-4">
                <label
                  v-for="city in province.children"
                  :key="city.code || ''"
                  class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-elevated"
                  :class="{ 'bg-primary/5': selectedCodes.includes(city.code || '') }"
                >
                  <input
                    type="checkbox"
                    class="rounded"
                    :checked="selectedCodes.includes(city.code || '')"
                    @change="toggleCity(city.code || '')"
                  >
                  <span>{{ city.name }}</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full items-center justify-between gap-3">
        <span class="text-sm text-muted">
          已选 {{ selectedSummary.provinceCount }} 个省级范围，{{ selectedSummary.cityCount }} 个市级范围
        </span>
        <div class="flex gap-2">
          <UButton color="neutral" variant="outline" @click="showDivisionModal = false">
            取消
          </UButton>
          <UButton :loading="saving" @click="saveDivisions">
            保存
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
