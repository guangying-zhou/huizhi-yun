<script setup lang="ts">
import type { ApiResponse, PurchaseOrderLineItem } from '~/types'

const props = defineProps<{
  open: boolean
  orderId: number | null
  item?: PurchaseOrderLineItem | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const { loadDictionaries, getOptions } = useAssetDictionaries()
const { loadCategories, subtypeOptions: physicalSubtypeOptions } = useAssetCategories()
await loadDictionaries()
await loadCategories()

const toast = useToast()
const submitting = ref(false)
const categoryOptions = [
  { label: '实物资产', value: 'physical' },
  { label: '资源资产', value: 'resource' }
]
const targetTypeOptions = [
  { label: '不指定', value: 'none' },
  { label: '用户', value: 'user' },
  { label: '部门', value: 'dept' },
  { label: '项目', value: 'project' },
  { label: '环境', value: 'environment' },
  { label: '系统', value: 'system' }
]

const state = reactive({
  line_no: '',
  asset_category: 'physical',
  asset_subtype: '',
  item_name: '',
  specification: '',
  quantity: '1',
  unit: '',
  unit_price: '',
  total_price: '',
  effective_at: '',
  expires_at: '',
  target_type: 'none',
  target_ref: '',
  remark: ''
})

const subtypeOptions = computed(() => (
  state.asset_category === 'resource'
    ? getOptions('asset_resource_subtype')
    : physicalSubtypeOptions.value
))

function hydrate() {
  state.line_no = props.item?.line_no ? String(props.item.line_no) : ''
  state.asset_category = props.item?.asset_category || 'physical'
  state.asset_subtype = props.item?.asset_subtype || ''
  state.item_name = props.item?.item_name || ''
  state.specification = props.item?.specification || ''
  state.quantity = props.item?.quantity !== undefined ? String(props.item.quantity) : '1'
  state.unit = props.item?.unit || ''
  state.unit_price = props.item?.unit_price !== undefined && props.item?.unit_price !== null ? String(props.item.unit_price) : ''
  state.total_price = props.item?.total_price !== undefined && props.item?.total_price !== null ? String(props.item.total_price) : ''
  state.effective_at = props.item?.effective_at || ''
  state.expires_at = props.item?.expires_at || ''
  state.target_type = props.item?.target_type || 'none'
  state.target_ref = props.item?.target_ref || ''
  state.remark = props.item?.remark || ''
}

watch(() => props.open, (open) => {
  if (open) hydrate()
})

watch(() => props.item, () => {
  if (props.open) hydrate()
})

watch(() => state.asset_category, () => {
  if (!subtypeOptions.value.some(option => option.value === state.asset_subtype)) {
    state.asset_subtype = subtypeOptions.value[0]?.value || ''
  }
})

async function handleSubmit() {
  if (!props.orderId) return
  if (!state.item_name.trim()) {
    toast.add({ title: '缺少采购内容', description: '请先填写采购内容名称。', color: 'warning' })
    return
  }

  submitting.value = true

  const payload = {
    line_no: state.line_no ? Number(state.line_no) : undefined,
    asset_category: state.asset_category,
    asset_subtype: state.asset_subtype || null,
    item_name: state.item_name.trim(),
    specification: state.specification.trim() || null,
    quantity: state.quantity ? Number(state.quantity) : 1,
    unit: state.unit.trim() || null,
    unit_price: state.unit_price ? Number(state.unit_price) : null,
    total_price: state.total_price ? Number(state.total_price) : null,
    effective_at: state.effective_at || null,
    expires_at: state.expires_at || null,
    target_type: state.target_type,
    target_ref: state.target_ref.trim() || null,
    remark: state.remark.trim() || null
  }

  try {
    if (props.item?.id) {
      await $fetch<ApiResponse<{ id: number }>>(`/api/v1/purchase-orders/${props.orderId}/items/${props.item.id}`, {
        method: 'PATCH',
        body: payload
      })
      toast.add({ title: '采购明细已更新', description: '明细信息已保存。', color: 'success', icon: 'i-lucide-check' })
    } else {
      await $fetch<ApiResponse<{ id: number }>>(`/api/v1/purchase-orders/${props.orderId}/items`, {
        method: 'POST',
        body: payload
      })
      toast.add({ title: '采购明细已新增', description: '采购单明细已写入。', color: 'success', icon: 'i-lucide-check' })
    }

    emit('saved')
    isOpen.value = false
  } catch (error) {
    console.error('[PurchaseOrderItemModal] Failed:', error)
    toast.add({ title: '保存失败', description: '请检查录入内容后重试。', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :title="item ? '编辑采购明细' : '新增采购明细'"
    description="维护采购项、金额、有效期和目标归属。"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="行号">
            <UInput v-model="state.line_no" type="number" placeholder="留空自动顺延" />
          </UFormField>
          <UFormField label="资产大类">
            <USelect v-model="state.asset_category" :items="categoryOptions" />
          </UFormField>
          <UFormField label="资产子类">
            <USelect v-model="state.asset_subtype" :items="subtypeOptions" placeholder="请选择资产子类" />
          </UFormField>
          <UFormField label="采购内容" required>
            <UInput v-model="state.item_name" placeholder="例如：生产 ECS 续费" />
          </UFormField>
          <UFormField label="规格">
            <UInput v-model="state.specification" placeholder="例如：4C8G / 1个月" />
          </UFormField>
          <UFormField label="数量">
            <UInput
              v-model="state.quantity"
              type="number"
              min="0"
              step="0.01"
            />
          </UFormField>
          <UFormField label="单位">
            <UInput v-model="state.unit" placeholder="例如：台 / 份 / 个" />
          </UFormField>
          <UFormField label="单价">
            <UInput
              v-model="state.unit_price"
              type="number"
              min="0"
              step="0.01"
            />
          </UFormField>
          <UFormField label="总价">
            <UInput
              v-model="state.total_price"
              type="number"
              min="0"
              step="0.01"
              placeholder="留空则自动按数量*单价回算"
            />
          </UFormField>
          <UFormField label="目标类型">
            <USelect v-model="state.target_type" :items="targetTypeOptions" />
          </UFormField>
          <UFormField label="目标对象">
            <UInput v-model="state.target_ref" placeholder="例如：U1004 / ENV-AIOPS-PROD / internal/ai-ops" />
          </UFormField>
          <UFormField label="生效日期">
            <UInput v-model="state.effective_at" type="date" />
          </UFormField>
          <UFormField label="到期日期">
            <UInput v-model="state.expires_at" type="date" />
          </UFormField>
        </div>
        <UFormField label="备注">
          <UTextarea v-model="state.remark" :rows="3" placeholder="补充采购用途、交付背景或入库说明" />
        </UFormField>
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
