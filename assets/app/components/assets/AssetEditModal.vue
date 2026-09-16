<script setup lang="ts">
import type { ApiResponse, AssetDetail } from '~/types'
import PhysicalAssetFormFields from './PhysicalAssetFormFields.vue'

const props = defineProps<{
  open: boolean
  asset: AssetDetail | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'updated': []
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
const subtypeOptions = computed(() => props.asset?.asset_category === 'physical' ? physicalSubtypeOptions.value : getOptions('asset_resource_subtype'))
const statusOptions = computed(() => getOptions(props.asset?.asset_category === 'physical' ? 'asset_status_physical' : 'asset_status_resource'))
const purposeOptions = computed(() => getOptions('asset_purpose'))
const physicalItemTypeOptions = computed(() => getItemTypeOptions(state.asset_subtype))

const state = reactive({
  asset_name: '',
  asset_subtype: '',
  physical_item_type: '',
  asset_purpose: '',
  status: '',
  dept_code: '',
  project_code: '',
  customer_code: '',
  contract_code: '',
  owner_uid: '',
  user_uid: '',
  brand: '',
  model: '',
  config_detail: '',
  serial_number: '',
  qr_code: '',
  purchased_at: '',
  location: '',
  notes: '',
  provider: '',
  resource_type: '',
  spec_summary: '',
  expires_at: '',
  monthly_cost: ''
})

function hydrate() {
  state.asset_name = props.asset?.asset_name || ''
  state.asset_subtype = props.asset?.asset_subtype || ''
  state.physical_item_type = props.asset?.physical_item_type || getDefaultItemType(props.asset?.asset_subtype)
  state.asset_purpose = props.asset?.asset_purpose || 'self_use'
  state.status = props.asset?.status || ''
  state.dept_code = props.asset?.dept_code || ''
  state.project_code = props.asset?.project_code || ''
  state.customer_code = props.asset?.customer_code || ''
  state.contract_code = props.asset?.contract_code || ''
  state.owner_uid = props.asset?.owner_uid || ''
  state.user_uid = props.asset?.user_uid || ''
  state.brand = props.asset?.brand || ''
  state.model = props.asset?.model || ''
  state.config_detail = props.asset?.config_detail || ''
  state.serial_number = props.asset?.serial_number || ''
  state.qr_code = props.asset?.qr_code || ''
  state.purchased_at = props.asset?.purchased_at || ''
  state.location = props.asset?.location || ''
  state.notes = props.asset?.notes || ''
}

watch(() => props.open, (open) => {
  if (open) {
    hydrate()
  }
})

watch(() => props.asset, () => {
  if (props.open) {
    hydrate()
  }
})

watch(() => state.asset_subtype, () => {
  if (props.asset?.asset_category !== 'physical') return
  if (!physicalItemTypeOptions.value.some(option => option.value === state.physical_item_type)) {
    state.physical_item_type = getDefaultItemType(state.asset_subtype)
  }
})

function patchPhysicalState(patch: Partial<typeof state>) {
  Object.assign(state, patch)
}

async function handleSubmit() {
  if (!props.asset?.id) {
    return
  }

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
    await $fetch<ApiResponse<{ id: number }>>(`/api/v1/assets/${props.asset.id}`, {
      method: 'PATCH',
      body: {
        asset_name: state.asset_name.trim(),
        asset_subtype: state.asset_subtype.trim() || null,
        asset_purpose: state.asset_purpose.trim() || null,
        status: state.status.trim() || null,
        dept_code: state.dept_code.trim() || null,
        project_code: state.project_code.trim() || null,
        customer_code: state.customer_code.trim() || null,
        contract_code: state.contract_code.trim() || null,
        owner_uid: state.owner_uid.trim() || null,
        user_uid: state.user_uid.trim() || null,
        notes: state.notes.trim() || null,
        physical_details: props.asset.asset_category === 'physical'
          ? {
              physical_item_type: state.physical_item_type || null,
              brand: state.brand.trim() || null,
              model: state.model.trim() || null,
              config_detail: state.config_detail.trim() || null,
              serial_number: state.serial_number.trim() || null,
              purchased_at: state.purchased_at || null,
              inventory_status: state.status.trim() || null,
              qr_code: state.qr_code.trim() || null,
              location: state.location.trim() || null
            }
          : undefined
      }
    })

    toast.add({
      title: '资产已更新',
      description: '主要信息已保存。',
      color: 'success',
      icon: 'i-lucide-check'
    })

    emit('updated')
    isOpen.value = false
  } catch (error) {
    console.error('[AssetEdit] Failed:', error)
    toast.add({
      title: '更新失败',
      description: '请检查录入内容后重试。',
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
    :title="asset?.asset_category === 'physical' ? '编辑实物资产' : '编辑资产'"
    :description="asset?.asset_category === 'physical' ? '按补录口径维护实物资产的归属、配置与业务关系。' : '维护资产的主要归属、责任人和业务属性。'"
    :ui="{ content: 'sm:max-w-4xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <PhysicalAssetFormFields
          v-if="asset?.asset_category === 'physical'"
          :state="state"
          :subtype-options="subtypeOptions"
          :physical-item-type-options="physicalItemTypeOptions"
          :purpose-options="purposeOptions"
          :status-options="statusOptions"
          name-placeholder="资产名称"
          notes-placeholder="补充资产用途、交付背景或维护说明"
          @patch-state="patchPhysicalState"
        />

        <template v-else>
          <UFormField label="资产名称" required>
            <UInput
              v-model="state.asset_name"
              placeholder="资产名称"
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

            <UFormField label="归属部门">
              <UInput
                v-model="state.dept_code"
                placeholder="例如：RND / DELIVERY"
                class="w-full"
              />
            </UFormField>

            <UFormField label="项目编码">
              <UInput
                v-model="state.project_code"
                placeholder="例如：delivery/hljt-crm"
                class="w-full"
              />
            </UFormField>

            <UFormField label="客户编码">
              <UInput
                v-model="state.customer_code"
                placeholder="例如：CUST-HLJT"
                class="w-full"
              />
            </UFormField>

            <UFormField label="合同编码">
              <UInput
                v-model="state.contract_code"
                placeholder="例如：CONT-HLJT-2026"
                class="w-full"
              />
            </UFormField>

            <UFormField label="负责人 UID">
              <UInput
                v-model="state.owner_uid"
                placeholder="例如：U1001"
                class="w-full"
              />
            </UFormField>

            <UFormField label="使用人 UID">
              <UInput
                v-model="state.user_uid"
                placeholder="例如：U1004"
                class="w-full"
              />
            </UFormField>
          </div>

          <UFormField label="备注">
            <UTextarea
              v-model="state.notes"
              :rows="4"
              placeholder="补充资产用途、交付背景或维护说明"
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
        <UButton :loading="submitting" icon="i-lucide-save" @click="handleSubmit">
          保存
        </UButton>
      </div>
    </template>
  </UModal>
</template>
