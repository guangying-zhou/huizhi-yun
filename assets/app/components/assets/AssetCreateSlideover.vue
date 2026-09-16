<script setup lang="ts">
import type { ApiResponse } from '~/types'
import PhysicalAssetFormFields from './PhysicalAssetFormFields.vue'

const props = defineProps<{
  open: boolean
  category: 'physical' | 'resource'
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': [asset: { id: number, public_id?: string | null }]
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const { loadDictionaries, getOptions } = useAssetDictionaries()
const { loadCategories, subtypeOptions: physicalSubtypeOptions, getItemTypeOptions, getDefaultItemType } = useAssetCategories()
await loadDictionaries()
await loadCategories()

const toast = useToast()
const submitting = ref(false)
const subtypeOptions = computed(() => props.category === 'physical' ? physicalSubtypeOptions.value : getOptions('asset_resource_subtype'))
const statusOptions = computed(() => getOptions(props.category === 'physical' ? 'asset_status_physical' : 'asset_status_resource'))
const purposeOptions = computed(() => getOptions('asset_purpose'))
const resourceTypeOptions = computed(() => getOptions('resource_type'))
const physicalItemTypeOptions = computed(() => getItemTypeOptions(state.asset_subtype))

const state = reactive({
  asset_name: '',
  asset_subtype: props.category === 'physical' ? '办公设备' : '云资源',
  physical_item_type: props.category === 'physical' ? getDefaultItemType('办公设备') : '',
  asset_purpose: 'self_use',
  dept_code: '',
  project_code: '',
  customer_code: '',
  contract_code: '',
  owner_uid: '',
  user_uid: '',
  notes: '',
  status: props.category === 'physical' ? 'in_stock' : 'active',
  brand: '',
  model: '',
  config_detail: '',
  serial_number: '',
  purchased_at: '',
  location: '',
  provider: '',
  resource_type: 'infrastructure',
  spec_summary: '',
  expires_at: '',
  monthly_cost: ''
})

function resetState() {
  state.asset_name = ''
  state.asset_subtype = props.category === 'physical'
    ? (physicalSubtypeOptions.value[0]?.value || '办公设备')
    : '云资源'
  state.physical_item_type = props.category === 'physical' ? getDefaultItemType(state.asset_subtype) : ''
  state.asset_purpose = 'self_use'
  state.dept_code = ''
  state.project_code = ''
  state.customer_code = ''
  state.contract_code = ''
  state.owner_uid = ''
  state.user_uid = ''
  state.notes = ''
  state.status = props.category === 'physical' ? 'in_stock' : 'active'
  state.brand = ''
  state.model = ''
  state.config_detail = ''
  state.serial_number = ''
  state.purchased_at = ''
  state.location = ''
  state.provider = ''
  state.resource_type = 'infrastructure'
  state.spec_summary = ''
  state.expires_at = ''
  state.monthly_cost = ''
}

watch(() => props.open, (open) => {
  if (open) {
    resetState()
  }
})

watch(() => state.asset_subtype, () => {
  if (props.category !== 'physical') return
  if (!physicalItemTypeOptions.value.some(option => option.value === state.physical_item_type)) {
    state.physical_item_type = getDefaultItemType(state.asset_subtype)
  }
})

function patchPhysicalState(patch: Partial<typeof state>) {
  Object.assign(state, patch)
}

async function handleSubmit() {
  if (!state.asset_name.trim()) {
    toast.add({ title: '缺少资产名称', description: '请先填写资产名称。', color: 'warning' })
    return
  }

  if (state.asset_purpose === 'project_procurement' && !state.project_code.trim()) {
    toast.add({ title: '缺少项目编码', description: '项目采购资产必须填写项目编码。', color: 'warning' })
    return
  }

  submitting.value = true

  try {
    const payload: Record<string, unknown> = {
      asset_name: state.asset_name.trim(),
      asset_category: props.category,
      asset_subtype: state.asset_subtype.trim() || (props.category === 'physical' ? '办公设备' : '云资源'),
      asset_purpose: state.asset_purpose.trim() || 'self_use',
      dept_code: state.dept_code.trim() || 'UNKNOWN',
      project_code: state.project_code.trim() || null,
      customer_code: state.customer_code.trim() || null,
      contract_code: state.contract_code.trim() || null,
      owner_uid: state.owner_uid.trim() || null,
      user_uid: state.user_uid.trim() || null,
      status: state.status.trim() || (props.category === 'physical' ? 'in_stock' : 'active'),
      notes: state.notes.trim() || null
    }

    if (props.category === 'physical') {
      payload.physical_details = {
        physical_item_type: state.physical_item_type || null,
        brand: state.brand.trim() || null,
        model: state.model.trim() || null,
        config_detail: state.config_detail.trim() || null,
        serial_number: state.serial_number.trim() || null,
        purchased_at: state.purchased_at || null,
        location: state.location.trim() || null,
        inventory_status: state.status.trim() || 'in_stock'
      }
    } else {
      payload.resource_details = {
        provider: state.provider.trim() || null,
        resource_type: state.resource_type.trim() || 'infrastructure',
        spec_summary: state.spec_summary.trim() || null,
        expires_at: state.expires_at || null,
        monthly_cost: state.monthly_cost ? Number(state.monthly_cost) : null
      }
    }

    const response = await $fetch<ApiResponse<{ id: number, public_id?: string | null }>>('/api/v1/assets', {
      method: 'POST',
      body: payload
    })

    toast.add({
      title: props.category === 'physical' ? '实物资产已创建' : '资源资产已创建',
      description: `已生成资产记录 ${response.data.public_id || `#${response.data.id}`}`,
      color: 'success',
      icon: 'i-lucide-check'
    })

    emit('created', response.data)
    isOpen.value = false
  } catch (error) {
    console.error('[AssetCreate] Failed:', error)
    toast.add({
      title: '创建失败',
      description: '请检查必填字段或稍后重试。',
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :title="category === 'physical' ? '补录实物资产' : '新增资源资产'"
    :description="category === 'physical' ? '录入办公设备、家具设施、IT基础设施、车辆、专业资产或低值物资。' : '录入云资源、证书、Seat、额度等资源资产。'"
    :ui="{ content: 'sm:max-w-4xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <PhysicalAssetFormFields
          v-if="category === 'physical'"
          :state="state"
          :subtype-options="subtypeOptions"
          :physical-item-type-options="physicalItemTypeOptions"
          :purpose-options="purposeOptions"
          :status-options="statusOptions"
          name-placeholder="例如：研发中心 MacBook Pro 14"
          notes-placeholder="补充资产来源、用途或说明"
          @patch-state="patchPhysicalState"
        />

        <template v-else>
          <UFormField label="资产名称" required>
            <UInput
              v-model="state.asset_name"
              placeholder="例如：华联交通生产 ECS"
              class="w-full"
            />
          </UFormField>

          <div class="grid gap-4 md:grid-cols-2">
            <UFormField label="资产子类">
              <USelect
                v-model="state.asset_subtype"
                :items="subtypeOptions"
                placeholder="请选择资产子类"
                class="w-full"
              />
            </UFormField>

            <UFormField label="采购目的">
              <USelect
                v-model="state.asset_purpose"
                :items="purposeOptions"
                placeholder="请选择采购目的"
                class="w-full"
              />
            </UFormField>

            <UFormField label="状态">
              <USelect
                v-model="state.status"
                :items="statusOptions"
                placeholder="请选择资产状态"
                class="w-full"
              />
            </UFormField>

            <UFormField label="项目编码">
              <UInput v-model="state.project_code" placeholder="例如：delivery/hljt-crm" class="w-full" />
            </UFormField>

            <UFormField label="客户编码">
              <UInput v-model="state.customer_code" placeholder="例如：CUST-HLJT" class="w-full" />
            </UFormField>

            <UFormField label="合同编码">
              <UInput v-model="state.contract_code" placeholder="例如：CONT-HLJT-2026" class="w-full" />
            </UFormField>

            <UFormField label="负责人 UID">
              <UInput v-model="state.owner_uid" placeholder="例如：U1001" class="w-full" />
            </UFormField>

            <UFormField label="使用人 UID">
              <UInput v-model="state.user_uid" placeholder="例如：U1004" class="w-full" />
            </UFormField>
          </div>

          <USeparator />

          <div class="grid gap-4 md:grid-cols-2">
            <UFormField label="供应商">
              <UInput
                v-model="state.provider"
                placeholder="例如：Alibaba Cloud"
                class="w-full"
              />
            </UFormField>

            <UFormField label="资源类型">
              <USelect
                v-model="state.resource_type"
                :items="resourceTypeOptions"
                placeholder="请选择资源类型"
                class="w-full"
              />
            </UFormField>

            <UFormField label="到期时间">
              <UInput
                v-model="state.expires_at"
                type="date"
                class="w-full"
              />
            </UFormField>

            <UFormField label="月度成本">
              <UInput
                v-model="state.monthly_cost"
                type="number"
                placeholder="例如：850"
                class="w-full"
              />
            </UFormField>

            <UFormField class="md:col-span-2" label="规格摘要">
              <UInput
                v-model="state.spec_summary"
                placeholder="例如：4C8G / MySQL 高可用 / Seat 40 个"
                class="w-full"
              />
            </UFormField>
          </div>

          <UFormField label="备注">
            <UTextarea
              v-model="state.notes"
              :rows="4"
              placeholder="补充资产来源、用途或说明"
              class="w-full"
            />
          </UFormField>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton color="neutral" variant="outline" @click="isOpen = false">
          取消
        </UButton>
        <UButton :loading="submitting" icon="i-lucide-plus" @click="handleSubmit">
          创建
        </UButton>
      </div>
    </template>
  </UModal>
</template>
