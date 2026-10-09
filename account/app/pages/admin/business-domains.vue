<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

usePageTitle('业务域管理')

interface DomainDict {
  id: number
  domainCode: string
  domainName: string
  category: string
  parentCode: string | null
  sortOrder: number
}

interface CompanyDomain {
  id: number
  companyCode: string
  domainCode: string
  domainName: string
  category: string
  aliasName: string | null
  displayName: string
  source: string
  sortOrder: number
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

const companyDomains = ref<CompanyDomain[]>([])
const dictDomains = ref<DomainDict[]>([])

// 选择字典领域的弹窗
const showSelectModal = ref(false)
const selectedDomainCodes = ref<string[]>([])

// 自建领域弹窗
const showCustomModal = ref(false)
const customForm = ref({
  domainCode: '',
  domainName: '',
  category: '2B' as '2G' | '2B' | '2C'
})

// 编辑别名弹窗
const showAliasModal = ref(false)
const editingDomain = ref<CompanyDomain | null>(null)
const aliasForm = ref({ aliasName: '', sortOrder: 0 })

const categoryLabels: Record<string, { label: string, color: 'primary' | 'success' | 'warning' }> = {
  '2G': { label: '政务', color: 'primary' },
  '2B': { label: '企业', color: 'success' },
  '2C': { label: '个人', color: 'warning' }
}

const categoryOptions = [
  { label: '2G 政务领域', value: '2G' },
  { label: '2B 企业领域', value: '2B' },
  { label: '2C 个人领域', value: '2C' }
]

async function loadCompanyDomains() {
  loading.value = true
  try {
    const res = await $fetch<ApiResponse<CompanyDomain[]>>(`/api/v1/companies/${companyCode}/business-domains`)
    companyDomains.value = res.data
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '加载失败', description: error.data?.message || error.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

async function loadDictDomains() {
  try {
    const res = await $fetch<ApiResponse<DomainDict[]>>('/api/v1/business-domains')
    dictDomains.value = res.data
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '加载字典失败', description: error.data?.message || error.message, color: 'error' })
  }
}

function openSelectModal() {
  const subDomainCodes = new Set(dictSubDomains.value.map(d => d.domainCode))
  selectedDomainCodes.value = companyDomains.value
    .filter(domain => domain.source === 'preset' && subDomainCodes.has(domain.domainCode))
    .map(domain => domain.domainCode)
  showSelectModal.value = true
}

// 字典中的子领域（有 parentCode 的）
const dictSubDomains = computed(() => dictDomains.value.filter(d => d.parentCode))

// 按大类分组
const groupedDictDomains = computed(() => {
  const groups: Record<string, DomainDict[]> = { '2G': [], '2B': [], '2C': [] }
  for (const d of dictSubDomains.value) {
    if (groups[d.category]) {
      groups[d.category]!.push(d)
    }
  }
  return groups
})

async function saveSelected() {
  const subDomainCodes = new Set(dictSubDomains.value.map(d => d.domainCode))
  const existingPresetSubCodes = new Set(
    companyDomains.value
      .filter(domain => domain.source === 'preset' && subDomainCodes.has(domain.domainCode))
      .map(domain => domain.domainCode)
  )
  const toAdd = selectedDomainCodes.value.filter(code => !existingPresetSubCodes.has(code))
  const toRemove = [...existingPresetSubCodes].filter(code => !selectedDomainCodes.value.includes(code))

  saving.value = true
  try {
    // 添加新选中的
    if (toAdd.length > 0) {
      const domains = toAdd.map((code) => {
        const dict = dictDomains.value.find(d => d.domainCode === code)!
        return {
          domainCode: dict.domainCode,
          domainName: dict.domainName,
          category: dict.category,
          source: 'preset'
        }
      })
      await $fetch(`/api/v1/companies/${companyCode}/business-domains`, {
        method: 'POST',
        body: { domains }
      })
    }

    // 删除取消选中的（仅限 preset 来源）
    for (const code of toRemove) {
      const d = companyDomains.value.find(x => x.domainCode === code)
      if (d && d.source === 'preset') {
        await $fetch(`/api/v1/companies/${companyCode}/business-domains/${code}`, {
          method: 'DELETE'
        })
      }
    }

    toast.add({ title: '保存成功', color: 'success' })
    showSelectModal.value = false
    await loadCompanyDomains()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '保存失败', description: error.data?.message || error.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

function openCustomModal() {
  customForm.value = { domainCode: '', domainName: '', category: '2B' }
  showCustomModal.value = true
}

async function saveCustomDomain() {
  if (!customForm.value.domainCode || !customForm.value.domainName) {
    toast.add({ title: '编码和名称不能为空', color: 'warning' })
    return
  }

  saving.value = true
  try {
    await $fetch(`/api/v1/companies/${companyCode}/business-domains`, {
      method: 'POST',
      body: {
        domainCode: customForm.value.domainCode,
        domainName: customForm.value.domainName,
        category: customForm.value.category,
        source: 'custom'
      }
    })
    toast.add({ title: '添加成功', color: 'success' })
    showCustomModal.value = false
    await loadCompanyDomains()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '添加失败', description: error.data?.message || error.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

function openAliasModal(domain: CompanyDomain) {
  editingDomain.value = domain
  aliasForm.value = {
    aliasName: domain.aliasName || '',
    sortOrder: domain.sortOrder
  }
  showAliasModal.value = true
}

async function saveAlias() {
  if (!editingDomain.value) return

  saving.value = true
  try {
    await $fetch(`/api/v1/companies/${companyCode}/business-domains/${editingDomain.value.domainCode}`, {
      method: 'PATCH',
      body: {
        aliasName: aliasForm.value.aliasName || null,
        sortOrder: aliasForm.value.sortOrder
      }
    })
    toast.add({ title: '更新成功', color: 'success' })
    showAliasModal.value = false
    await loadCompanyDomains()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '更新失败', description: error.data?.message || error.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

async function removeDomain(domain: CompanyDomain) {
  if (!confirm(`确定删除"${domain.displayName}"？`)) return

  try {
    await $fetch(`/api/v1/companies/${companyCode}/business-domains/${domain.domainCode}`, {
      method: 'DELETE'
    })
    toast.add({ title: '删除成功', color: 'success' })
    await loadCompanyDomains()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '删除失败', description: error.data?.message || error.message, color: 'error' })
  }
}

const columns: TableColumn<CompanyDomain>[] = [
  { accessorKey: 'domainCode', header: '编码' },
  { accessorKey: 'domainName', header: '名称' },
  { accessorKey: 'category', header: '大类' },
  { accessorKey: 'aliasName', header: '别名' },
  { accessorKey: 'source', header: '来源' },
  { accessorKey: 'sortOrder', header: '排序' },
  { id: 'actions', header: '操作' }
]

onMounted(() => {
  loadCompanyDomains()
  loadDictDomains()
})
</script>

<template>
  <div class="flex flex-col flex-1 w-full min-w-0">
    <UDashboardPanel id="business-domains" :ui="{ body: 'gap-1 sm:p-3' }">
      <template #header>
        <div class="flex justify-end gap-2 px-4 py-2">
          <UButton
            color="primary"
            size="sm"
            icon="i-lucide-check-square"
            @click="openSelectModal"
          >
            从字典选择
          </UButton>
          <UButton
            color="neutral"
            size="sm"
            variant="outline"
            icon="i-lucide-plus"
            @click="openCustomModal"
          >
            自建领域
          </UButton>
          <UButton
            color="neutral"
            size="sm"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            :loading="loading"
            @click="loadCompanyDomains()"
          >
            刷新
          </UButton>
        </div>
      </template>

      <template #body>
        <UCard :ui="{ body: 'p-0' }">
          <UTable
            :data="companyDomains"
            :columns="columns"
            :loading="loading"
            empty-state-title="暂未配置业务领域"
            sticky
            class="w-full h-[calc(100vh-200px)]"
          >
            <template #domainCode-cell="{ row }">
              <code class="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">{{ row.original.domainCode }}</code>
            </template>

            <template #domainName-cell="{ row }">
              <span class="font-medium">{{ row.original.domainName }}</span>
            </template>

            <template #category-cell="{ row }">
              <UBadge
                :color="categoryLabels[row.original.category]?.color || 'neutral'"
                size="xs"
                variant="subtle"
              >
                {{ categoryLabels[row.original.category]?.label || row.original.category }}
              </UBadge>
            </template>

            <template #aliasName-cell="{ row }">
              <span v-if="row.original.aliasName" class="text-sm">{{ row.original.aliasName }}</span>
              <span v-else class="text-sm text-gray-400">-</span>
            </template>

            <template #source-cell="{ row }">
              <UBadge
                :color="row.original.source === 'preset' ? 'info' : 'neutral'"
                size="xs"
                variant="subtle"
              >
                {{ row.original.source === 'preset' ? '字典' : '自建' }}
              </UBadge>
            </template>

            <template #actions-cell="{ row }">
              <div class="flex items-center gap-2">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-pencil"
                  @click="openAliasModal(row.original)"
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

          <div v-if="!loading && companyDomains.length > 0" class="px-4 py-3 border-t border-default">
            <span class="text-sm text-gray-500">共 {{ companyDomains.length }} 个领域</span>
          </div>
        </UCard>
      </template>
    </UDashboardPanel>

    <!-- 从字典选择弹窗 -->
    <UModal v-model:open="showSelectModal" title="选择业务领域" :ui="{ content: 'sm:max-w-3xl' }">
      <template #body>
        <div class="space-y-6">
          <div v-for="(domains, cat) in groupedDictDomains" :key="cat">
            <h4 class="font-medium mb-2 flex items-center gap-2">
              <UBadge :color="categoryLabels[cat]?.color || 'neutral'" size="xs" variant="subtle">
                {{ categoryLabels[cat]?.label }}
              </UBadge>
              <span class="text-sm text-gray-500">({{ cat }})</span>
            </h4>
            <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
              <label
                v-for="d in domains"
                :key="d.domainCode"
                class="flex items-center gap-2 px-3 py-2 rounded-lg border border-default hover:bg-elevated cursor-pointer transition-colors"
                :class="{ 'bg-primary-50 dark:bg-primary-950 border-primary': selectedDomainCodes.includes(d.domainCode) }"
              >
                <input
                  v-model="selectedDomainCodes"
                  type="checkbox"
                  :value="d.domainCode"
                  class="rounded"
                >
                <span class="text-sm">{{ d.domainName }}</span>
              </label>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="showSelectModal = false">
            取消
          </UButton>
          <UButton color="primary" :loading="saving" @click="saveSelected">
            确认选择
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 自建领域弹窗 -->
    <UModal v-model:open="showCustomModal" title="自建业务领域" :ui="{ content: 'sm:max-w-lg' }">
      <template #body>
        <div class="space-y-4">
          <UFormField label="领域编码" required>
            <UInput v-model="customForm.domainCode" placeholder="如：CUS_001" class="w-full" />
          </UFormField>
          <UFormField label="领域名称" required>
            <UInput v-model="customForm.domainName" placeholder="请输入领域名称" class="w-full" />
          </UFormField>
          <UFormField label="所属大类" required>
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
          <UButton color="primary" :loading="saving" @click="saveCustomDomain">
            添加
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 编辑别名弹窗 -->
    <UModal v-model:open="showAliasModal" title="编辑领域" :ui="{ content: 'sm:max-w-lg' }">
      <template #body>
        <div class="space-y-4">
          <UFormField label="原名称">
            <span class="text-sm text-gray-600">{{ editingDomain?.domainName }}</span>
          </UFormField>
          <UFormField label="自定义别名">
            <UInput v-model="aliasForm.aliasName" placeholder="留空则使用原名称" class="w-full" />
          </UFormField>
          <UFormField label="排序">
            <UInput v-model.number="aliasForm.sortOrder" type="number" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="showAliasModal = false">
            取消
          </UButton>
          <UButton color="primary" :loading="saving" @click="saveAlias">
            保存
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
