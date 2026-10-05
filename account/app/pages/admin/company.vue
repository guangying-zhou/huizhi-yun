<script setup lang="ts">
import { getPC } from 'lcn'

usePageTitle('企业信息')

interface Company {
  id: number
  companyCode: string
  companyName: string
  shortName: string | null
  logo: string | null
  industry: string | null
  scale: string | null
  province: string | null
  city: string | null
  address: string | null
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  website: string | null
  description: string | null
  status: number
}

interface ApiResponse<T> {
  code: number
  message?: string
  data: T
}

const toast = useToast()
const loading = ref(false)
const saving = ref(false)

// 当前只有一家公司（后续 SaaS 化再支持多公司切换）
const companyCode = ref('C000001')
const company = ref<Company | null>(null)

const formData = ref({
  companyName: '',
  shortName: '',
  industry: '',
  scale: '',
  province: '',
  city: '',
  address: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  website: '',
  description: ''
})

const scaleOptions = [
  { label: '微型企业', value: 'micro' },
  { label: '小型企业', value: 'small' },
  { label: '中型企业', value: 'medium' },
  { label: '大型企业', value: 'large' }
]

// 行业分类（GB/T 4754—2017 门类）
const industryOptions = [
  { label: 'A 农、林、牧、渔业', value: '农、林、牧、渔业' },
  { label: 'B 采矿业', value: '采矿业' },
  { label: 'C 制造业', value: '制造业' },
  { label: 'D 电力、热力、燃气及水生产和供应业', value: '电力、热力、燃气及水生产和供应业' },
  { label: 'E 建筑业', value: '建筑业' },
  { label: 'F 批发和零售业', value: '批发和零售业' },
  { label: 'G 交通运输、仓储和邮政业', value: '交通运输、仓储和邮政业' },
  { label: 'H 住宿和餐饮业', value: '住宿和餐饮业' },
  { label: 'I 信息传输、软件和信息技术服务业', value: '信息传输、软件和信息技术服务业' },
  { label: 'J 金融业', value: '金融业' },
  { label: 'K 房地产业', value: '房地产业' },
  { label: 'L 租赁和商务服务业', value: '租赁和商务服务业' },
  { label: 'M 科学研究和技术服务业', value: '科学研究和技术服务业' },
  { label: 'N 水利、环境和公共设施管理业', value: '水利、环境和公共设施管理业' },
  { label: 'O 居民服务、修理和其他服务业', value: '居民服务、修理和其他服务业' },
  { label: 'P 教育', value: '教育' },
  { label: 'Q 卫生和社会工作', value: '卫生和社会工作' },
  { label: 'R 文化、体育和娱乐业', value: '文化、体育和娱乐业' },
  { label: 'S 公共管理、社会保障和社会组织', value: '公共管理、社会保障和社会组织' },
  { label: 'T 国际组织', value: '国际组织' }
]

// 省市联动（lcn）
const pcData = getPC({ emptyChildrenValue: 'none' })
const provinceOptions = computed(() =>
  pcData.map(p => ({ label: p.name || '', value: p.name || '' }))
)
const cityOptions = computed(() => {
  if (!formData.value.province) return []
  const prov = pcData.find(p => p.name === formData.value.province)
  if (!prov?.children) return []
  return prov.children.map(c => ({ label: c.name || '', value: c.name || '' }))
})

function onProvinceChange() {
  formData.value.city = ''
}

async function loadCompany() {
  loading.value = true
  try {
    const res = await $fetch<ApiResponse<Company>>(`/api/v1/companies/${companyCode.value}`)
    company.value = res.data
    formData.value = {
      companyName: res.data.companyName || '',
      shortName: res.data.shortName || '',
      industry: res.data.industry || '',
      scale: res.data.scale || '',
      province: res.data.province || '',
      city: res.data.city || '',
      address: res.data.address || '',
      contactName: res.data.contactName || '',
      contactPhone: res.data.contactPhone || '',
      contactEmail: res.data.contactEmail || '',
      website: res.data.website || '',
      description: res.data.description || ''
    }
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '加载失败', description: error.data?.message || error.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

async function saveCompany() {
  if (!formData.value.companyName) {
    toast.add({ title: '公司名称不能为空', color: 'warning' })
    return
  }

  saving.value = true
  try {
    await $fetch(`/api/v1/companies/${companyCode.value}`, {
      method: 'PATCH',
      body: formData.value
    })
    toast.add({ title: '保存成功', color: 'success' })
    await loadCompany()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '保存失败', description: error.data?.message || error.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  loadCompany()
})
</script>

<template>
  <div class="flex flex-col flex-1 w-full min-w-0">
    <UDashboardPanel id="company-settings" :ui="{ body: 'gap-1 sm:p-3' }">
      <template #body>
        <UCard v-if="!loading && company" class="max-w-4xl">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <UFormField label="公司全称" required class="md:col-span-2">
              <UInput v-model="formData.companyName" placeholder="请输入公司全称" class="w-full" />
            </UFormField>

            <UFormField label="公司简称">
              <UInput v-model="formData.shortName" placeholder="请输入简称" class="w-full" />
            </UFormField>

            <UFormField label="所属行业">
              <USelect
                v-model="formData.industry"
                :items="industryOptions"
                value-key="value"
                placeholder="请选择行业"
                class="w-full"
              />
            </UFormField>

            <UFormField label="公司规模">
              <USelect
                v-model="formData.scale"
                :items="scaleOptions"
                value-key="value"
                placeholder="请选择规模"
                class="w-full"
              />
            </UFormField>

            <UFormField label="所在省份">
              <USelect
                v-model="formData.province"
                :items="provinceOptions"
                value-key="value"
                placeholder="请选择省份"
                class="w-full"
                @update:model-value="onProvinceChange"
              />
            </UFormField>

            <UFormField label="所在城市">
              <USelect
                v-model="formData.city"
                :items="cityOptions"
                value-key="value"
                placeholder="请先选择省份"
                :disabled="!formData.province"
                class="w-full"
              />
            </UFormField>

            <UFormField label="详细地址" class="md:col-span-2">
              <UInput v-model="formData.address" placeholder="请输入详细地址" class="w-full" />
            </UFormField>

            <UFormField label="联系人">
              <UInput v-model="formData.contactName" placeholder="请输入联系人" class="w-full" />
            </UFormField>

            <UFormField label="联系电话">
              <UInput v-model="formData.contactPhone" placeholder="请输入电话" class="w-full" />
            </UFormField>

            <UFormField label="联系邮箱">
              <UInput v-model="formData.contactEmail" placeholder="请输入邮箱" class="w-full" />
            </UFormField>

            <UFormField label="官网">
              <UInput v-model="formData.website" placeholder="如：https://example.com" class="w-full" />
            </UFormField>

            <UFormField label="公司简介" class="md:col-span-2">
              <UTextarea
                v-model="formData.description"
                placeholder="请输入公司简介"
                :rows="3"
                class="w-full"
              />
            </UFormField>
          </div>

          <div class="flex justify-end mt-6 pt-4 border-t border-default">
            <UButton
              color="primary"
              :loading="saving"
              icon="i-lucide-save"
              @click="saveCompany"
            >
              保存
            </UButton>
          </div>
        </UCard>

        <div v-if="loading" class="flex items-center justify-center py-20">
          <UIcon name="i-lucide-loader-2" class="animate-spin text-2xl text-gray-400" />
        </div>
      </template>
    </UDashboardPanel>
  </div>
</template>
