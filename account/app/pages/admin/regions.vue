<script setup lang="ts">
import { getPCA } from 'lcn'

usePageTitle('区域管理')

interface Region {
  id: number
  companyCode: string
  regionCode: string
  regionName: string
  description: string | null
  sortOrder: number
  divisionCount: number
}

interface DivisionMapping {
  id: number
  divisionCode: string
  includeChildren: boolean
}

interface ApiResponse<T> {
  code: number
  message?: string
  data: T
}

const toast = useToast()
const loading = ref(false)
const saving = ref(false)
const companyCode = 'C000001'

const regions = ref<Region[]>([])

// 创建区域弹窗
const showCreateModal = ref(false)
const createForm = ref({
  regionCode: '',
  regionName: '',
  description: '',
  sortOrder: 0
})

// 编辑区域弹窗
const showEditModal = ref(false)
const editingRegion = ref<Region | null>(null)
const editForm = ref({ regionName: '', description: '', sortOrder: 0 })

// 行政区划配置弹窗
const showDivisionModal = ref(false)
const divisionRegion = ref<Region | null>(null)
const divisionMappings = ref<DivisionMapping[]>([])
const divisionLoading = ref(false)

// lcn 省市区级联数据
const pcaData = getPCA({ emptyChildrenValue: 'none' })
const provinceData = pcaData

// 已选的区划代码（省级或市级）
const selectedCodes = ref<string[]>([])
// 展开的省份
const expandedProvinces = ref<string[]>([])

// 判断一个省是否全选（所有市都选中）
function isProvinceAllSelected(provCode: string): boolean {
  const prov = pcaData.find(p => p.code === provCode)
  if (!prov?.children || prov.children.length === 0) {
    return selectedCodes.value.includes(provCode)
  }
  return prov.children.every(c => selectedCodes.value.includes(c.code || ''))
}

// 判断一个省是否部分选中
function isProvincePartialSelected(provCode: string): boolean {
  const prov = pcaData.find(p => p.code === provCode)
  if (!prov?.children || prov.children.length === 0) return false
  const codes = prov.children.map(c => c.code || '')
  const selectedCount = codes.filter(c => selectedCodes.value.includes(c)).length
  return selectedCount > 0 && selectedCount < codes.length
}

// 切换省份选中状态
function toggleProvince(provCode: string) {
  const prov = pcaData.find(p => p.code === provCode)
  if (!prov?.children || prov.children.length === 0) {
    // 直辖市等无下级的，直接切换省级代码
    if (selectedCodes.value.includes(provCode)) {
      selectedCodes.value = selectedCodes.value.filter(c => c !== provCode)
    } else {
      selectedCodes.value.push(provCode)
    }
    return
  }
  const cityCodes = prov.children.map(c => c.code || '')
  if (isProvinceAllSelected(provCode)) {
    // 取消全选
    selectedCodes.value = selectedCodes.value.filter(c => !cityCodes.includes(c))
  } else {
    // 全选：加入所有未选的市
    const toAdd = cityCodes.filter(c => !selectedCodes.value.includes(c))
    selectedCodes.value.push(...toAdd)
  }
}

// 切换城市选中状态
function toggleCity(cityCode: string) {
  if (selectedCodes.value.includes(cityCode)) {
    selectedCodes.value = selectedCodes.value.filter(c => c !== cityCode)
  } else {
    selectedCodes.value.push(cityCode)
  }
}

// 展开/折叠省份
function toggleExpand(provCode: string) {
  if (expandedProvinces.value.includes(provCode)) {
    expandedProvinces.value = expandedProvinces.value.filter(c => c !== provCode)
  } else {
    expandedProvinces.value.push(provCode)
  }
}

// 统计已选的省市数量
const selectedSummary = computed(() => {
  let provCount = 0
  let cityCount = 0
  for (const prov of pcaData) {
    const code = prov.code || ''
    if (!prov.children || prov.children.length === 0) {
      if (selectedCodes.value.includes(code)) provCount++
    } else if (isProvinceAllSelected(code)) {
      provCount++
    } else {
      const count = prov.children.filter(c => selectedCodes.value.includes(c.code || '')).length
      if (count > 0) cityCount += count
    }
  }
  return { provCount, cityCount, total: selectedCodes.value.length }
})

async function loadRegions() {
  loading.value = true
  try {
    const res = await $fetch<ApiResponse<Region[]>>(`/api/v1/companies/${companyCode}/regions`)
    regions.value = res.data
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '加载失败', description: error.data?.message || error.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

async function initFromTemplate() {
  if (!confirm('将从标准七大区模板初始化，已有的区域不会被覆盖。继续？')) return

  saving.value = true
  try {
    await $fetch(`/api/v1/companies/${companyCode}/regions?fromTemplate=STANDARD_7`, {
      method: 'POST'
    })
    toast.add({ title: '初始化成功', color: 'success' })
    await loadRegions()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '初始化失败', description: error.data?.message || error.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

function openCreateModal() {
  createForm.value = { regionCode: '', regionName: '', description: '', sortOrder: 0 }
  showCreateModal.value = true
}

async function createRegion() {
  if (!createForm.value.regionCode || !createForm.value.regionName) {
    toast.add({ title: '编码和名称不能为空', color: 'warning' })
    return
  }

  saving.value = true
  try {
    await $fetch(`/api/v1/companies/${companyCode}/regions`, {
      method: 'POST',
      body: createForm.value
    })
    toast.add({ title: '创建成功', color: 'success' })
    showCreateModal.value = false
    await loadRegions()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '创建失败', description: error.data?.message || error.message, color: 'error' })
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
    await $fetch(`/api/v1/companies/${companyCode}/regions/${editingRegion.value.regionCode}`, {
      method: 'PATCH',
      body: editForm.value
    })
    toast.add({ title: '更新成功', color: 'success' })
    showEditModal.value = false
    await loadRegions()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '更新失败', description: error.data?.message || error.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

async function deleteRegion(region: Region) {
  if (!confirm(`确定删除区域"${region.regionName}"及其所有行政区划映射？`)) return

  try {
    await $fetch(`/api/v1/companies/${companyCode}/regions/${region.regionCode}`, {
      method: 'DELETE'
    })
    toast.add({ title: '删除成功', color: 'success' })
    await loadRegions()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '删除失败', description: error.data?.message || error.message, color: 'error' })
  }
}

async function openDivisionModal(region: Region) {
  divisionRegion.value = region
  divisionLoading.value = true
  showDivisionModal.value = true

  try {
    const res = await $fetch<ApiResponse<DivisionMapping[]>>(
      `/api/v1/companies/${companyCode}/regions/${region.regionCode}/divisions`
    )
    divisionMappings.value = res.data
    // 将已有映射转为选中代码列表
    // 省级代码（include_children=true）展开为其所有市级代码
    const codes: string[] = []
    for (const d of res.data) {
      const prov = pcaData.find(p => p.code === d.divisionCode)
      if (prov && prov.children && prov.children.length > 0 && d.includeChildren) {
        // 省级且含下级 → 展开为所有市
        codes.push(...prov.children.map(c => c.code || ''))
      } else {
        codes.push(d.divisionCode)
      }
    }
    selectedCodes.value = [...new Set(codes)]
    expandedProvinces.value = []
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '加载区划失败', description: error.data?.message || error.message, color: 'error' })
  } finally {
    divisionLoading.value = false
  }
}

async function saveDivisions() {
  if (!divisionRegion.value) return

  saving.value = true
  try {
    // 智能合并：如果某省所有市都选中，存为省级（include_children=true）
    // 否则存单独的市级代码
    const divisions: { divisionCode: string, includeChildren: boolean }[] = []
    for (const prov of pcaData) {
      const provCode = prov.code || ''
      if (!prov.children || prov.children.length === 0) {
        // 无下级（直辖市等特殊情况）
        if (selectedCodes.value.includes(provCode)) {
          divisions.push({ divisionCode: provCode, includeChildren: true })
        }
      } else if (isProvinceAllSelected(provCode)) {
        // 全选 → 存省级
        divisions.push({ divisionCode: provCode, includeChildren: true })
      } else {
        // 部分选 → 存各市
        for (const city of prov.children) {
          if (selectedCodes.value.includes(city.code || '')) {
            divisions.push({ divisionCode: city.code || '', includeChildren: true })
          }
        }
      }
    }

    await $fetch(
      `/api/v1/companies/${companyCode}/regions/${divisionRegion.value.regionCode}/divisions`,
      {
        method: 'PUT',
        body: { divisions }
      }
    )
    toast.add({ title: '保存成功', color: 'success' })
    showDivisionModal.value = false
    await loadRegions()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '保存失败', description: error.data?.message || error.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  loadRegions()
})
</script>

<template>
  <div class="flex flex-col flex-1 w-full min-w-0">
    <UDashboardPanel id="regions" :ui="{ body: 'gap-1 sm:p-3' }">
      <template #header>
        <div class="flex justify-end gap-2 px-4 py-2">
          <UButton
            v-if="regions.length === 0"
            color="primary"
            size="sm"
            icon="i-lucide-wand-2"
            :loading="saving"
            @click="initFromTemplate"
          >
            从标准模板初始化
          </UButton>
          <UButton
            color="primary"
            size="sm"
            icon="i-lucide-plus"
            @click="openCreateModal"
          >
            新建区域
          </UButton>
          <UButton
            color="neutral"
            size="sm"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            :loading="loading"
            @click="loadRegions()"
          >
            刷新
          </UButton>
        </div>
      </template>

      <template #body>
        <!-- 区域卡片列表 -->
        <div v-if="!loading && regions.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <UCard v-for="region in regions" :key="region.regionCode">
            <div class="flex items-start justify-between">
              <div>
                <h3 class="font-semibold text-lg">
                  {{ region.regionName }}
                </h3>
                <p class="text-sm text-gray-500 mt-1">
                  <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{{ region.regionCode }}</code>
                </p>
              </div>
              <UBadge color="info" variant="subtle" size="sm">
                {{ region.divisionCount }} 个区划
              </UBadge>
            </div>

            <p v-if="region.description" class="text-sm text-gray-500 mt-2">
              {{ region.description }}
            </p>

            <div class="flex items-center gap-2 mt-4 pt-3 border-t border-default">
              <UButton
                size="xs"
                color="primary"
                variant="ghost"
                icon="i-lucide-map-pin"
                @click="openDivisionModal(region)"
              >
                配置区划
              </UButton>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-pencil"
                @click="openEditModal(region)"
              >
                编辑
              </UButton>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-trash-2"
                @click="deleteRegion(region)"
              >
                删除
              </UButton>
            </div>
          </UCard>
        </div>

        <div v-if="!loading && regions.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
          <UIcon name="i-lucide-map" class="text-4xl text-gray-300 mb-4" />
          <p class="text-gray-500 mb-4">
            暂未配置区域
          </p>
          <p class="text-sm text-gray-400">
            点击"从标准模板初始化"快速创建华北/东北/华东/中南/西南/西北/港澳台七大区域
          </p>
        </div>

        <div v-if="loading" class="flex items-center justify-center py-20">
          <UIcon name="i-lucide-loader-2" class="animate-spin text-2xl text-gray-400" />
        </div>
      </template>
    </UDashboardPanel>

    <!-- 创建区域弹窗 -->
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
            <UInput v-model="createForm.description" placeholder="可选" class="w-full" />
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
          <UButton color="primary" :loading="saving" @click="createRegion">
            创建
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 编辑区域弹窗 -->
    <UModal v-model:open="showEditModal" title="编辑区域" :ui="{ content: 'sm:max-w-lg' }">
      <template #body>
        <div class="space-y-4">
          <UFormField label="区域名称">
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
          <UButton color="primary" :loading="saving" @click="saveEdit">
            保存
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 行政区划配置弹窗 -->
    <UModal v-model:open="showDivisionModal" :title="`${divisionRegion?.regionName} - 行政区划配置`" :ui="{ content: 'sm:max-w-4xl' }">
      <template #body>
        <div v-if="divisionLoading" class="flex items-center justify-center py-10">
          <UIcon name="i-lucide-loader-2" class="animate-spin text-2xl text-gray-400" />
        </div>

        <div v-else class="max-h-[60vh] overflow-y-auto">
          <p class="text-sm text-gray-500 mb-4">
            勾选省份可全选其下所有城市，也可展开后单独增减城市。
          </p>

          <div class="space-y-1">
            <div v-for="prov in provinceData" :key="prov.code || ''" class="border border-default rounded-lg overflow-hidden">
              <!-- 省份行 -->
              <div
                class="flex items-center gap-2 px-3 py-2 hover:bg-elevated transition-colors"
                :class="{
                  'bg-primary-50 dark:bg-primary-950': isProvinceAllSelected(prov.code || ''),
                  'bg-primary-50/50 dark:bg-primary-950/50': isProvincePartialSelected(prov.code || '')
                }"
              >
                <input
                  type="checkbox"
                  class="rounded"
                  :checked="isProvinceAllSelected(prov.code || '')"
                  :indeterminate="isProvincePartialSelected(prov.code || '')"
                  @change="toggleProvince(prov.code || '')"
                >
                <span
                  class="text-sm font-medium flex-1 cursor-pointer select-none"
                  @click="toggleProvince(prov.code || '')"
                >
                  {{ prov.name }}
                </span>

                <!-- 已选市数 / 总市数 -->
                <span v-if="prov.children && prov.children.length > 0" class="text-xs text-gray-400 mr-1">
                  {{ prov.children.filter(c => selectedCodes.includes(c.code || '')).length }}/{{ prov.children.length }}
                </span>

                <!-- 展开按钮 -->
                <UButton
                  v-if="prov.children && prov.children.length > 0"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  :icon="expandedProvinces.includes(prov.code || '') ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                  @click.stop="toggleExpand(prov.code || '')"
                />
              </div>

              <!-- 城市列表（展开后显示） -->
              <div
                v-if="expandedProvinces.includes(prov.code || '') && prov.children && prov.children.length > 0"
                class="px-3 py-2 border-t border-default bg-elevated/50"
              >
                <div class="grid grid-cols-2 md:grid-cols-4 gap-1">
                  <label
                    v-for="city in prov.children"
                    :key="city.code || ''"
                    class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-elevated cursor-pointer transition-colors"
                    :class="{ 'bg-primary-50 dark:bg-primary-950': selectedCodes.includes(city.code || '') }"
                  >
                    <input
                      type="checkbox"
                      class="rounded"
                      :checked="selectedCodes.includes(city.code || '')"
                      @change="toggleCity(city.code || '')"
                    >
                    <span class="text-xs">{{ city.name }}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex items-center justify-between">
          <span class="text-sm text-gray-500">
            已选
            <template v-if="selectedSummary.provCount > 0">{{ selectedSummary.provCount }} 个省（全选）</template>
            <template v-if="selectedSummary.provCount > 0 && selectedSummary.cityCount > 0">、</template>
            <template v-if="selectedSummary.cityCount > 0">{{ selectedSummary.cityCount }} 个市</template>
            <template v-if="selectedSummary.total === 0">0 个区划</template>
          </span>
          <div class="flex gap-2">
            <UButton color="neutral" variant="outline" @click="showDivisionModal = false">
              取消
            </UButton>
            <UButton color="primary" :loading="saving" @click="saveDivisions">
              保存
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
