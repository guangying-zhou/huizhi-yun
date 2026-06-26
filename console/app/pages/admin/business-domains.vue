<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('业务领域')

type ApiResponse<T> = {
  code?: number
  data: T
  message?: string
}

type Company = {
  companyCode: string
  companyName: string
}

type DomainCategory = '2G' | '2B' | '2C'

type DomainPreset = {
  domainCode: string
  domainName: string
  category: DomainCategory
  parentCode: string | null
  sortOrder: number
}

type CompanyDomain = {
  id: number
  companyCode: string | null
  domainCode: string
  domainName: string
  category: DomainCategory
  aliasName: string | null
  displayName: string
  source: 'preset' | 'custom'
  sortOrder: number
}

const presets: DomainPreset[] = [
  { domainCode: 'GOV_NR', domainName: '自然资源', category: '2G', parentCode: 'GOV', sortOrder: 1 },
  { domainCode: 'GOV_HC', domainName: '住房城乡建设', category: '2G', parentCode: 'GOV', sortOrder: 2 },
  { domainCode: 'GOV_AG', domainName: '农业农村', category: '2G', parentCode: 'GOV', sortOrder: 3 },
  { domainCode: 'GOV_AP', domainName: '行政审批', category: '2G', parentCode: 'GOV', sortOrder: 4 },
  { domainCode: 'GOV_EC', domainName: '生态环境', category: '2G', parentCode: 'GOV', sortOrder: 5 },
  { domainCode: 'GOV_TR', domainName: '交通运输', category: '2G', parentCode: 'GOV', sortOrder: 6 },
  { domainCode: 'GOV_WR', domainName: '水利', category: '2G', parentCode: 'GOV', sortOrder: 7 },
  { domainCode: 'GOV_ED', domainName: '教育', category: '2G', parentCode: 'GOV', sortOrder: 8 },
  { domainCode: 'GOV_HE', domainName: '卫生健康', category: '2G', parentCode: 'GOV', sortOrder: 9 },
  { domainCode: 'GOV_HR', domainName: '人力资源和社会保障', category: '2G', parentCode: 'GOV', sortOrder: 10 },
  { domainCode: 'GOV_PS', domainName: '公安', category: '2G', parentCode: 'GOV', sortOrder: 11 },
  { domainCode: 'GOV_FI', domainName: '财政', category: '2G', parentCode: 'GOV', sortOrder: 12 },
  { domainCode: 'GOV_TX', domainName: '税务', category: '2G', parentCode: 'GOV', sortOrder: 13 },
  { domainCode: 'GOV_MR', domainName: '市场监管', category: '2G', parentCode: 'GOV', sortOrder: 14 },
  { domainCode: 'GOV_CA', domainName: '民政', category: '2G', parentCode: 'GOV', sortOrder: 15 },
  { domainCode: 'GOV_JU', domainName: '司法', category: '2G', parentCode: 'GOV', sortOrder: 16 },
  { domainCode: 'BIZ_A', domainName: '农、林、牧、渔业', category: '2B', parentCode: 'BIZ', sortOrder: 1 },
  { domainCode: 'BIZ_B', domainName: '采矿业', category: '2B', parentCode: 'BIZ', sortOrder: 2 },
  { domainCode: 'BIZ_C', domainName: '制造业', category: '2B', parentCode: 'BIZ', sortOrder: 3 },
  { domainCode: 'BIZ_D', domainName: '电力、热力、燃气及水生产和供应业', category: '2B', parentCode: 'BIZ', sortOrder: 4 },
  { domainCode: 'BIZ_E', domainName: '建筑业', category: '2B', parentCode: 'BIZ', sortOrder: 5 },
  { domainCode: 'BIZ_F', domainName: '批发和零售业', category: '2B', parentCode: 'BIZ', sortOrder: 6 },
  { domainCode: 'BIZ_G', domainName: '交通运输、仓储和邮政业', category: '2B', parentCode: 'BIZ', sortOrder: 7 },
  { domainCode: 'BIZ_H', domainName: '住宿和餐饮业', category: '2B', parentCode: 'BIZ', sortOrder: 8 },
  { domainCode: 'BIZ_I', domainName: '信息传输、软件和信息技术服务业', category: '2B', parentCode: 'BIZ', sortOrder: 9 },
  { domainCode: 'BIZ_J', domainName: '金融业', category: '2B', parentCode: 'BIZ', sortOrder: 10 },
  { domainCode: 'BIZ_K', domainName: '房地产业', category: '2B', parentCode: 'BIZ', sortOrder: 11 },
  { domainCode: 'BIZ_L', domainName: '租赁和商务服务业', category: '2B', parentCode: 'BIZ', sortOrder: 12 },
  { domainCode: 'BIZ_M', domainName: '科学研究和技术服务业', category: '2B', parentCode: 'BIZ', sortOrder: 13 },
  { domainCode: 'BIZ_N', domainName: '水利、环境和公共设施管理业', category: '2B', parentCode: 'BIZ', sortOrder: 14 },
  { domainCode: 'BIZ_O', domainName: '居民服务、修理和其他服务业', category: '2B', parentCode: 'BIZ', sortOrder: 15 },
  { domainCode: 'BIZ_P', domainName: '教育', category: '2B', parentCode: 'BIZ', sortOrder: 16 },
  { domainCode: 'BIZ_Q', domainName: '卫生和社会工作', category: '2B', parentCode: 'BIZ', sortOrder: 17 },
  { domainCode: 'BIZ_R', domainName: '文化、体育和娱乐业', category: '2B', parentCode: 'BIZ', sortOrder: 18 },
  { domainCode: 'BIZ_S', domainName: '公共管理、社会保障和社会组织', category: '2B', parentCode: 'BIZ', sortOrder: 19 },
  { domainCode: 'BIZ_T', domainName: '国际组织', category: '2B', parentCode: 'BIZ', sortOrder: 20 },
  { domainCode: 'CON_EDU', domainName: '教育培训', category: '2C', parentCode: 'CON', sortOrder: 1 },
  { domainCode: 'CON_HE', domainName: '医疗健康', category: '2C', parentCode: 'CON', sortOrder: 2 },
  { domainCode: 'CON_FI', domainName: '个人金融', category: '2C', parentCode: 'CON', sortOrder: 3 },
  { domainCode: 'CON_TR', domainName: '出行旅游', category: '2C', parentCode: 'CON', sortOrder: 4 },
  { domainCode: 'CON_EC', domainName: '电子商务', category: '2C', parentCode: 'CON', sortOrder: 5 },
  { domainCode: 'CON_EN', domainName: '文化娱乐', category: '2C', parentCode: 'CON', sortOrder: 6 },
  { domainCode: 'CON_LF', domainName: '生活服务', category: '2C', parentCode: 'CON', sortOrder: 7 },
  { domainCode: 'CON_SO', domainName: '社交通讯', category: '2C', parentCode: 'CON', sortOrder: 8 }
]

const toast = useToast()
const loading = ref(false)
const saving = ref(false)
const companyCode = ref('')
const domains = ref<CompanyDomain[]>([])
const selectedPresetCodes = ref<string[]>([])
const showPresetModal = ref(false)
const showCustomModal = ref(false)
const showEditModal = ref(false)
const editingDomain = ref<CompanyDomain | null>(null)
const search = ref('')

const customForm = ref({
  domainCode: '',
  domainName: '',
  category: '2B' as DomainCategory
})

const editForm = ref({
  aliasName: '',
  sortOrder: 100
})

const columns = [
  { accessorKey: 'domainCode', header: '编码' },
  { accessorKey: 'displayName', header: '显示名称' },
  { accessorKey: 'category', header: '类型' },
  { accessorKey: 'source', header: '来源' },
  { accessorKey: 'sortOrder', header: '排序' },
  { id: 'actions', header: '操作' }
]

const categoryOptions = [
  { label: '2G 政务', value: '2G' },
  { label: '2B 企业', value: '2B' },
  { label: '2C 个人', value: '2C' }
]

const categoryMeta: Record<DomainCategory, { label: string, color: 'primary' | 'success' | 'warning' }> = {
  '2G': { label: '政务', color: 'primary' },
  '2B': { label: '企业', color: 'success' },
  '2C': { label: '个人', color: 'warning' }
}

const groupedPresets = computed(() => {
  return presets.reduce<Record<DomainCategory, DomainPreset[]>>((groups, item) => {
    groups[item.category].push(item)
    return groups
  }, { '2G': [], '2B': [], '2C': [] })
})

const visibleDomains = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  if (!keyword) return domains.value
  return domains.value.filter(item => [
    item.domainCode,
    item.domainName,
    item.displayName,
    item.category,
    item.source
  ].join(' ').toLowerCase().includes(keyword))
})

async function loadCompanyCode() {
  if (companyCode.value) return companyCode.value
  const res = await $fetch<ApiResponse<Company[]>>('/api/v1/companies')
  const company = res.data[0]
  if (!company?.companyCode) throw new Error('未找到企业资料，请先完成 Console 激活')
  companyCode.value = company.companyCode
  return companyCode.value
}

async function loadDomains() {
  loading.value = true
  try {
    const code = await loadCompanyCode()
    const res = await $fetch<ApiResponse<CompanyDomain[]>>(`/api/v1/companies/${code}/business-domains`)
    domains.value = res.data
  } catch (error) {
    toast.add({ color: 'error', title: '加载失败', description: error instanceof Error ? error.message : String(error) })
  } finally {
    loading.value = false
  }
}

function openPresetModal() {
  selectedPresetCodes.value = domains.value
    .filter(item => item.source === 'preset')
    .map(item => item.domainCode)
  showPresetModal.value = true
}

function openCustomModal() {
  customForm.value = { domainCode: '', domainName: '', category: '2B' }
  showCustomModal.value = true
}

function openEditModal(domain: CompanyDomain) {
  editingDomain.value = domain
  editForm.value = {
    aliasName: domain.aliasName || '',
    sortOrder: domain.sortOrder
  }
  showEditModal.value = true
}

async function savePresets() {
  saving.value = true
  try {
    const code = await loadCompanyCode()
    const existingPresetCodes = new Set(domains.value.filter(item => item.source === 'preset').map(item => item.domainCode))
    const toAdd = selectedPresetCodes.value.filter(domainCode => !existingPresetCodes.has(domainCode))
    const toRemove = [...existingPresetCodes].filter(domainCode => !selectedPresetCodes.value.includes(domainCode))

    if (toAdd.length > 0) {
      await $fetch(`/api/v1/companies/${code}/business-domains`, {
        method: 'POST',
        body: {
          domains: toAdd.map((domainCode) => {
            const preset = presets.find(item => item.domainCode === domainCode)!
            return {
              domainCode: preset.domainCode,
              domainName: preset.domainName,
              category: preset.category,
              source: 'preset',
              sortOrder: preset.sortOrder
            }
          })
        }
      })
    }

    for (const domainCode of toRemove) {
      await $fetch(`/api/v1/companies/${code}/business-domains/${encodeURIComponent(domainCode)}`, { method: 'DELETE' })
    }

    toast.add({ color: 'success', title: '保存成功' })
    showPresetModal.value = false
    await loadDomains()
  } catch (error) {
    toast.add({ color: 'error', title: '保存失败', description: error instanceof Error ? error.message : String(error) })
  } finally {
    saving.value = false
  }
}

async function saveCustom() {
  if (!customForm.value.domainCode || !customForm.value.domainName) {
    toast.add({ color: 'warning', title: '编码和名称不能为空' })
    return
  }

  saving.value = true
  try {
    const code = await loadCompanyCode()
    await $fetch(`/api/v1/companies/${code}/business-domains`, {
      method: 'POST',
      body: {
        domainCode: customForm.value.domainCode,
        domainName: customForm.value.domainName,
        category: customForm.value.category,
        source: 'custom'
      }
    })
    toast.add({ color: 'success', title: '添加成功' })
    showCustomModal.value = false
    await loadDomains()
  } catch (error) {
    toast.add({ color: 'error', title: '添加失败', description: error instanceof Error ? error.message : String(error) })
  } finally {
    saving.value = false
  }
}

async function saveEdit() {
  if (!editingDomain.value) return
  saving.value = true
  try {
    const code = await loadCompanyCode()
    await $fetch(`/api/v1/companies/${code}/business-domains/${encodeURIComponent(editingDomain.value.domainCode)}`, {
      method: 'PATCH',
      body: {
        aliasName: editForm.value.aliasName || null,
        sortOrder: editForm.value.sortOrder
      }
    })
    toast.add({ color: 'success', title: '更新成功' })
    showEditModal.value = false
    await loadDomains()
  } catch (error) {
    toast.add({ color: 'error', title: '更新失败', description: error instanceof Error ? error.message : String(error) })
  } finally {
    saving.value = false
  }
}

async function removeDomain(domain: CompanyDomain) {
  if (!confirm(`确定删除“${domain.displayName}”？`)) return
  try {
    const code = await loadCompanyCode()
    await $fetch(`/api/v1/companies/${code}/business-domains/${encodeURIComponent(domain.domainCode)}`, { method: 'DELETE' })
    toast.add({ color: 'success', title: '删除成功' })
    await loadDomains()
  } catch (error) {
    toast.add({ color: 'error', title: '删除失败', description: error instanceof Error ? error.message : String(error) })
  }
}

onMounted(loadDomains)
</script>

<template>
  <UDashboardPanel id="business-domains" :ui="dashboardPanelUi">
    <template #body>
      <div class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <UInput
            v-model="search"
            icon="i-lucide-search"
            placeholder="搜索编码、名称或类型"
            class="w-full sm:w-80"
          />
          <div class="flex flex-wrap items-center gap-2">
            <UButton icon="i-lucide-check-square" label="从字典选择" @click="openPresetModal" />
            <UButton
              icon="i-lucide-plus"
              color="neutral"
              variant="outline"
              label="自建领域"
              @click="openCustomModal"
            />
            <UButton
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              :loading="loading"
              @click="loadDomains"
            />
          </div>
        </div>

        <UCard :ui="{ body: 'p-0' }">
          <UTable
            :data="visibleDomains"
            :columns="columns"
            :loading="loading"
            class="h-[calc(100vh-220px)]"
          >
            <template #domainCode-cell="{ row }">
              <code class="rounded bg-elevated px-2 py-0.5 text-xs">{{ row.original.domainCode }}</code>
            </template>
            <template #displayName-cell="{ row }">
              <div class="min-w-0">
                <p class="font-medium">
                  {{ row.original.displayName }}
                </p>
                <p v-if="row.original.aliasName" class="text-xs text-muted">
                  原名：{{ row.original.domainName }}
                </p>
              </div>
            </template>
            <template #category-cell="{ row }">
              <UBadge :color="categoryMeta[row.original.category]?.color || 'neutral'" variant="subtle">
                {{ categoryMeta[row.original.category]?.label || row.original.category }}
              </UBadge>
            </template>
            <template #source-cell="{ row }">
              <UBadge :color="row.original.source === 'custom' ? 'neutral' : 'info'" variant="subtle">
                {{ row.original.source === 'custom' ? '自建' : '字典' }}
              </UBadge>
            </template>
            <template #actions-cell="{ row }">
              <div class="flex items-center gap-1">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-pencil"
                  @click="openEditModal(row.original)"
                />
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  @click="removeDomain(row.original)"
                />
              </div>
            </template>
          </UTable>
          <template #footer>
            <span class="text-sm text-muted">共 {{ visibleDomains.length }} 个业务领域</span>
          </template>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="showPresetModal" title="从字典选择业务领域" :ui="{ content: 'sm:max-w-4xl' }">
    <template #body>
      <div class="max-h-[62vh] space-y-6 overflow-y-auto pr-1">
        <div v-for="(items, category) in groupedPresets" :key="category" class="space-y-2">
          <div class="flex items-center gap-2">
            <UBadge :color="categoryMeta[category].color" variant="subtle">
              {{ categoryMeta[category].label }}
            </UBadge>
            <span class="text-sm text-muted">{{ category }}</span>
          </div>
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label
              v-for="preset in items"
              :key="preset.domainCode"
              class="flex cursor-pointer items-center gap-2 rounded-md border border-default px-3 py-2 text-sm hover:bg-elevated"
              :class="{ 'border-primary bg-primary/5': selectedPresetCodes.includes(preset.domainCode) }"
            >
              <input
                v-model="selectedPresetCodes"
                type="checkbox"
                :value="preset.domainCode"
                class="rounded"
              >
              <span>{{ preset.domainName }}</span>
            </label>
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="outline" @click="showPresetModal = false">
          取消
        </UButton>
        <UButton :loading="saving" @click="savePresets">
          保存
        </UButton>
      </div>
    </template>
  </UModal>

  <UModal v-model:open="showCustomModal" title="自建业务领域" :ui="{ content: 'sm:max-w-lg' }">
    <template #body>
      <div class="space-y-4">
        <UFormField label="领域编码" required>
          <UInput v-model="customForm.domainCode" placeholder="如：CUS_001" class="w-full" />
        </UFormField>
        <UFormField label="领域名称" required>
          <UInput v-model="customForm.domainName" placeholder="请输入领域名称" class="w-full" />
        </UFormField>
        <UFormField label="所属类型" required>
          <USelect
            v-model="customForm.category"
            :items="categoryOptions"
            value-key="value"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="outline" @click="showCustomModal = false">
          取消
        </UButton>
        <UButton :loading="saving" @click="saveCustom">
          添加
        </UButton>
      </div>
    </template>
  </UModal>

  <UModal v-model:open="showEditModal" title="编辑业务领域" :ui="{ content: 'sm:max-w-lg' }">
    <template #body>
      <div class="space-y-4">
        <UFormField label="原名称">
          <p class="text-sm">
            {{ editingDomain?.domainName }}
          </p>
        </UFormField>
        <UFormField label="显示别名">
          <UInput v-model="editForm.aliasName" placeholder="留空则使用原名称" class="w-full" />
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
</template>
