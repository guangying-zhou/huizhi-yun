<script setup lang="ts">
import type { CustomerForm, CustomerLevel, CustomerType, Industry, Region } from '~/types/altoc'
import { SOURCE_TYPE_OPTIONS, CREDIT_LEVEL_OPTIONS } from '~/types/altoc'
import { unwrapApiList } from '~/utils/apiResponse'

const router = useRouter()
const toast = useToast()
const { user: authUser } = useAuth()

const loading = ref(false)

// 加载配置数据
const { data: industries } = useFetch('/api/v1/config/industries', { transform: (res: unknown) => unwrapApiList<Industry>(res) })
const { data: regions } = useFetch('/api/v1/config/regions', { transform: (res: unknown) => unwrapApiList<Region>(res) })
const { data: levels } = useFetch('/api/v1/config/customer-levels', { transform: (res: unknown) => unwrapApiList<CustomerLevel>(res) })
const { data: types } = useFetch('/api/v1/config/customer-types', { transform: (res: unknown) => unwrapApiList<CustomerType>(res) })

const form = reactive<CustomerForm>({
  name: '',
  short_name: '',
  customer_type_id: null,
  industry_code: null as string | null,
  region_code: null as string | null,
  customer_level_id: null,
  source_type: undefined,
  owner_user_id: authUser.value || '',
  website: '',
  province: '',
  city: '',
  address: '',
  description: '',
  is_partner: 0,
  credit_level: undefined,
  remark: ''
})

// 选项
const typeOptions = computed(() => (types.value || []).map((t: any) => ({ label: t.name, value: t.id })))
const industryOptions = computed(() => (industries.value || []).map((i: any) => ({ label: i.name, value: i.code })))
const regionOptions = computed(() => (regions.value || []).map((r: any) => ({ label: r.name, value: r.code })))
const levelOptions = computed(() => (levels.value || []).map((l: any) => ({ label: l.name, value: l.id })))
const sourceOptions = SOURCE_TYPE_OPTIONS.map(o => ({ label: o.label, value: o.value }))
const creditOptions = CREDIT_LEVEL_OPTIONS.map(o => ({ label: o.label, value: o.value }))

async function handleSubmit() {
  if (!form.name.trim()) {
    toast.add({ title: '请输入客户名称', color: 'error' })
    return
  }

  loading.value = true
  try {
    const res = await $fetch<any>('/api/v1/customers', {
      method: 'POST',
      body: form
    })
    toast.add({ title: '客户创建成功', color: 'success' })
    router.push(`/customers/${res.data.id}`)
  } catch (err: any) {
    toast.add({ title: err?.data?.statusMessage || '创建失败', color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="customer-new">
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <UButton
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
          @click="router.back()"
        />
        <h1 class="truncate text-base font-semibold">
          新建客户
        </h1>
      </Teleport>
      <Teleport to="#altoc-layout-header-actions">
        <UButton
          label="保存"
          icon="i-lucide-check"
          color="primary"
          :loading="loading"
          @click="handleSubmit"
        />
      </Teleport>

      <div class="p-6 space-y-6">
        <!-- 基本信息 -->
        <UCard>
          <template #header>
            <span class="font-semibold">基本信息</span>
          </template>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UFormField label="客户名称" required>
              <UInput v-model="form.name" placeholder="请输入客户全称" class="w-full" />
            </UFormField>
            <UFormField label="客户简称">
              <UInput v-model="form.short_name" placeholder="请输入简称" class="w-full" />
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
              <UInput v-model="form.address" placeholder="请输入地址" class="w-full" />
            </UFormField>
            <UFormField label="描述" class="md:col-span-2">
              <UTextarea
                v-model="form.description"
                placeholder="客户描述"
                :rows="3"
                class="w-full"
              />
            </UFormField>
            <UFormField label="备注" class="md:col-span-2">
              <UTextarea
                v-model="form.remark"
                placeholder="备注信息"
                :rows="2"
                class="w-full"
              />
            </UFormField>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
