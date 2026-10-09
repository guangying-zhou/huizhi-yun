<script setup lang="ts">
import type { ApiResponse, CustomerDeliveryAssetItem } from '~/types'

const props = defineProps<{
  open: boolean
  asset: CustomerDeliveryAssetItem | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'updated': []
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})
const toast = useToast()
const submitting = ref(false)
const state = reactive({
  responsible_uid: '',
  responsible_dept_code: '',
  expired_at: '',
  warranty_start_at: '',
  warranty_end_at: '',
  support_expiry_at: ''
})

function datetimeLocal(value?: string | null) {
  return value ? String(value).replace(' ', 'T').slice(0, 16) : ''
}

function hydrate() {
  state.responsible_uid = props.asset?.responsible_uid || ''
  state.responsible_dept_code = props.asset?.responsible_dept_code || ''
  state.expired_at = datetimeLocal(props.asset?.expired_at)
  state.warranty_start_at = datetimeLocal(props.asset?.warranty_start_at)
  state.warranty_end_at = datetimeLocal(props.asset?.warranty_end_at)
  state.support_expiry_at = datetimeLocal(props.asset?.support_expiry_at)
}

watch(() => props.open, (open) => {
  if (open) hydrate()
})
watch(() => props.asset, () => {
  if (props.open) hydrate()
})

async function handleSubmit() {
  if (!props.asset?.delivery_asset_code) return
  const responsibleUid = state.responsible_uid.trim()
  const responsibleDeptCode = state.responsible_dept_code.trim()
  if (responsibleUid.toLowerCase() === '@all') {
    toast.add({ title: '责任人无效', description: '必须填写明确的用户 UID，不能使用 @all。', color: 'warning' })
    return
  }
  if (Boolean(responsibleUid) !== Boolean(responsibleDeptCode)) {
    toast.add({ title: '责任信息不完整', description: '运营责任人和责任部门必须同时填写，或同时清空。', color: 'warning' })
    return
  }

  submitting.value = true
  try {
    await $fetch<ApiResponse<CustomerDeliveryAssetItem>>(
      `/api/v1/customer-delivery-assets/${encodeURIComponent(props.asset.delivery_asset_code)}`,
      {
        method: 'PATCH',
        body: {
          responsible_uid: responsibleUid || null,
          responsible_dept_code: responsibleDeptCode || null,
          expired_at: state.expired_at || null,
          warranty_start_at: state.warranty_start_at || null,
          warranty_end_at: state.warranty_end_at || null,
          support_expiry_at: state.support_expiry_at || null
        }
      }
    )
    toast.add({
      title: '运营责任已更新',
      description: responsibleUid ? '后续到期通知只会投递给该明确责任人。' : '责任人已清空，交付资产通知将保持关闭。',
      color: 'success',
      icon: 'i-lucide-check'
    })
    emit('updated')
    isOpen.value = false
  } catch (error) {
    console.error('[CustomerDeliveryAssetEdit] Failed:', error)
    toast.add({ title: '更新失败', description: '请确认当前数据范围和录入内容后重试。', color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="维护交付资产责任与期限"
    description="责任人是通知与对象级访问的直接事实；责任部门只用于页面数据范围，不会接收群发通知。"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <UAlert
          color="info"
          variant="soft"
          icon="i-lucide-shield-check"
          title="显式责任边界"
          description="系统不会从合同负责人或项目成员关系隐式推导交付资产责任人。未填写明确 UID 时，到期通知不会发送。"
        />
        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="运营责任人 UID">
            <UInput v-model="state.responsible_uid" class="w-full" placeholder="例如：U1001" />
          </UFormField>
          <UFormField label="运营责任部门编码">
            <UInput v-model="state.responsible_dept_code" class="w-full" placeholder="例如：DELIVERY" />
          </UFormField>
          <UFormField label="资产到期时间">
            <UInput v-model="state.expired_at" type="datetime-local" class="w-full" />
          </UFormField>
          <UFormField label="质保开始时间">
            <UInput v-model="state.warranty_start_at" type="datetime-local" class="w-full" />
          </UFormField>
          <UFormField label="质保结束时间">
            <UInput v-model="state.warranty_end_at" type="datetime-local" class="w-full" />
          </UFormField>
          <UFormField label="支持服务到期时间">
            <UInput v-model="state.support_expiry_at" type="datetime-local" class="w-full" />
          </UFormField>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="isOpen = false">
          取消
        </UButton>
        <UButton color="primary" :loading="submitting" @click="handleSubmit">
          保存
        </UButton>
      </div>
    </template>
  </UModal>
</template>
