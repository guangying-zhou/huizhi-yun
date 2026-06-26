<script setup lang="ts">
import type { CustomerLevel, CustomerType, Industry, Region } from '~/types/altoc'
import { SOURCE_TYPE_OPTIONS, CREDIT_LEVEL_OPTIONS, CUSTOMER_STATUS_OPTIONS } from '~/types/altoc'
import { unwrapApiList } from '~/utils/apiResponse'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const customerId = computed(() => String(route.params.id || ''))

const loading = ref(false)

// 加载配置
const { data: industries } = useFetch('/api/v1/config/industries', { transform: (res: unknown) => unwrapApiList<Industry>(res) })
const { data: regions } = useFetch('/api/v1/config/regions', { transform: (res: unknown) => unwrapApiList<Region>(res) })
const { data: levels } = useFetch('/api/v1/config/customer-levels', { transform: (res: unknown) => unwrapApiList<CustomerLevel>(res) })
const { data: types } = useFetch('/api/v1/config/customer-types', { transform: (res: unknown) => unwrapApiList<CustomerType>(res) })

// 加载客户数据（非阻塞）
const { data: customer, status: fetchStatus } = useFetch(() => `/api/v1/customers/${customerId.value}`, {
  transform: (res: any) => res.data
})

const form = reactive({
  name: '',
  short_name: '',
  customer_type_id: undefined as number | undefined,
  industry_code: undefined as string | undefined,
  region_code: undefined as string | undefined,
  customer_level_id: undefined as number | undefined,
  source_type: undefined as string | undefined,
  status: 'draft',
  owner_user_id: '',
  website: '',
  province: '',
  city: '',
  address: '',
  description: '',
  credit_level: undefined as string | undefined,
  remark: ''
})

// 数据加载完成后填充表单
watch(customer, (val) => {
  if (!val) return
  if (val.status === 'approval_pending') {
    toast.add({ title: '审批中客户不可编辑', color: 'warning' })
    router.replace(`/customers/${customerId.value}`)
    return
  }
  form.name = val.name || ''
  form.short_name = val.short_name || ''
  form.customer_type_id = val.customer_type_id || undefined
  form.industry_code = val.industry_code || undefined
  form.region_code = val.region_code || undefined
  form.customer_level_id = val.customer_level_id || undefined
  form.source_type = val.source_type || undefined
  form.status = val.status || 'draft'
  form.owner_user_id = val.owner_user_id || ''
  form.website = val.website || ''
  form.province = val.province || ''
  form.city = val.city || ''
  form.address = val.address || ''
  form.description = val.description || ''
  form.credit_level = val.credit_level || undefined
  form.remark = val.remark || ''
}, { immediate: true })

const typeOptions = computed(() => (types.value || []).map((t: any) => ({ label: t.name, value: t.id })))
const industryOptions = computed(() => (industries.value || []).map((i: any) => ({ label: i.name, value: i.code })))
const regionOptions = computed(() => (regions.value || []).map((r: any) => ({ label: r.name, value: r.code })))
const levelOptions = computed(() => (levels.value || []).map((l: any) => ({ label: l.name, value: l.id })))
const sourceOptions = SOURCE_TYPE_OPTIONS.map(o => ({ label: o.label, value: o.value }))
const creditOptions = CREDIT_LEVEL_OPTIONS.map(o => ({ label: o.label, value: o.value }))
const statusOptions = CUSTOMER_STATUS_OPTIONS.map(o => ({
  label: o.label,
  value: o.value,
  disabled: o.value === 'approval_pending' || o.value === 'approved'
}))

async function handleSubmit() {
  if (!form.name.trim()) {
    toast.add({ title: '请输入客户名称', color: 'error' })
    return
  }
  loading.value = true
  try {
    await $fetch(`/api/v1/customers/${customerId.value}`, {
      method: 'PUT',
      body: form
    })
    toast.add({ title: '更新成功', color: 'success' })
    router.push(`/customers/${customerId.value}`)
  } catch (err: any) {
    toast.add({ title: err?.data?.statusMessage || '更新失败', color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="customer-edit">
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <UButton
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
          @click="router.back()"
        />
        <h1 class="truncate text-base font-semibold">
          编辑客户
        </h1>
      </Teleport>
      <Teleport to="#altoc-layout-header-actions">
        <UButton
          label="保存"
          icon="i-lucide-check"
          color="primary"
          :loading="loading"
          :disabled="fetchStatus === 'pending'"
          @click="handleSubmit"
        />
      </Teleport>

      <div v-if="fetchStatus === 'pending'" class="p-6">
        <USkeleton class="h-64 w-full" />
      </div>
      <div v-else-if="!customer" class="p-6 text-center text-muted">
        <p>客户不存在</p>
        <UButton
          label="返回列表"
          variant="soft"
          class="mt-3"
          @click="router.push('/customers')"
        />
      </div>
      <div v-else class="p-6 space-y-6">
        <UCard>
          <template #header>
            <span class="font-semibold">基本信息</span>
          </template>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UFormField label="客户名称" required>
              <UInput v-model="form.name" class="w-full" />
            </UFormField>
            <UFormField label="客户简称">
              <UInput v-model="form.short_name" class="w-full" />
            </UFormField>
            <UFormField label="状态">
              <USelect v-model="form.status" :items="statusOptions" class="w-full" />
            </UFormField>
            <UFormField label="客户类型">
              <USelect
                v-model="form.customer_type_id"
                :items="typeOptions"
                placeholder="请选择"
                class="w-full"
              />
            </UFormField>
            <UFormField label="所属行业">
              <USelect
                v-model="form.industry_code"
                :items="industryOptions"
                placeholder="请选择"
                class="w-full"
              />
            </UFormField>
            <UFormField label="所属区域">
              <USelect
                v-model="form.region_code"
                :items="regionOptions"
                placeholder="请选择"
                class="w-full"
              />
            </UFormField>
            <UFormField label="客户等级">
              <USelect
                v-model="form.customer_level_id"
                :items="levelOptions"
                placeholder="请选择"
                class="w-full"
              />
            </UFormField>
            <UFormField label="来源渠道">
              <USelect
                v-model="form.source_type"
                :items="sourceOptions"
                placeholder="请选择"
                class="w-full"
              />
            </UFormField>
            <UFormField label="信用等级">
              <USelect
                v-model="form.credit_level"
                :items="creditOptions"
                placeholder="请选择"
                class="w-full"
              />
            </UFormField>
            <UFormField label="负责人" required>
              <UserPicker v-model="form.owner_user_id" />
            </UFormField>
            <UFormField label="官网">
              <UInput v-model="form.website" placeholder="https://" class="w-full" />
            </UFormField>
            <UFormField label="省/直辖市">
              <UInput v-model="form.province" placeholder="请输入省/直辖市" class="w-full" />
            </UFormField>
            <UFormField label="地市">
              <UInput v-model="form.city" placeholder="请输入地市" class="w-full" />
            </UFormField>
            <UFormField label="地址" class="md:col-span-2">
              <UInput v-model="form.address" class="w-full" />
            </UFormField>
            <UFormField label="描述" class="md:col-span-2">
              <UTextarea v-model="form.description" :rows="3" class="w-full" />
            </UFormField>
            <UFormField label="备注" class="md:col-span-2">
              <UTextarea v-model="form.remark" :rows="2" class="w-full" />
            </UFormField>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
