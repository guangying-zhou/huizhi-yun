<script setup lang="ts">
import type { ApiResponse, DeliveryItem } from '~/types'

const props = defineProps<{
  open: boolean
  delivery: DeliveryItem | null
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
await loadDictionaries()

const toast = useToast()
const submitting = ref(false)
const deliveryStatusOptions = computed(() => getOptions('delivery_status'))

const state = reactive({
  delivery_name: '',
  customer_code: '',
  contract_code: '',
  project_code: '',
  status: '',
  owner_uid: '',
  go_live_at: '',
  accepted_at: '',
  notes: ''
})

function hydrate() {
  state.delivery_name = props.delivery?.delivery_name || ''
  state.customer_code = props.delivery?.customer_code || ''
  state.contract_code = props.delivery?.contract_code || ''
  state.project_code = props.delivery?.project_code || ''
  state.status = props.delivery?.status || ''
  state.owner_uid = props.delivery?.owner_uid || ''
  state.go_live_at = props.delivery?.go_live_at || ''
  state.accepted_at = props.delivery?.accepted_at || ''
  state.notes = props.delivery?.notes || ''
}

watch(() => props.open, (open) => {
  if (open) {
    hydrate()
  }
})

watch(() => props.delivery, () => {
  if (props.open) {
    hydrate()
  }
})

async function handleSubmit() {
  if (!props.delivery?.id) {
    return
  }

  if (!state.delivery_name.trim()) {
    toast.add({ title: '缺少交付名称', description: '请先填写交付名称。', color: 'warning' })
    return
  }

  submitting.value = true

  try {
    await $fetch<ApiResponse<{ id: number }>>(`/api/v1/deliveries/${props.delivery.id}`, {
      method: 'PATCH',
      body: {
        delivery_name: state.delivery_name.trim(),
        customer_code: state.customer_code.trim() || null,
        contract_code: state.contract_code.trim() || null,
        project_code: state.project_code.trim() || null,
        status: state.status.trim() || null,
        owner_uid: state.owner_uid.trim() || null,
        go_live_at: state.go_live_at || null,
        accepted_at: state.accepted_at || null,
        notes: state.notes.trim() || null
      }
    })

    toast.add({
      title: '交付视图已更新',
      description: '主要信息已保存。',
      color: 'success',
      icon: 'i-lucide-check'
    })

    emit('updated')
    isOpen.value = false
  } catch (error) {
    console.error('[DeliveryEdit] Failed:', error)
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
    title="编辑交付视图"
    description="维护客户、合同、项目、负责人和上线节奏。"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <UFormField label="交付名称" required>
          <UInput
            v-model="state.delivery_name"
            placeholder="交付名称"
            class="w-full"
          />
        </UFormField>

        <div class="grid gap-4 md:grid-cols-2">
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

          <UFormField label="项目编码">
            <UInput
              v-model="state.project_code"
              placeholder="例如：delivery/hljt-crm"
              class="w-full"
            />
          </UFormField>

          <UFormField label="状态">
            <USelect
              v-model="state.status"
              :items="deliveryStatusOptions"
              placeholder="请选择交付状态"
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

          <UFormField label="计划上线">
            <UInput
              v-model="state.go_live_at"
              type="date"
              class="w-full"
            />
          </UFormField>

          <UFormField label="验收时间">
            <UInput
              v-model="state.accepted_at"
              type="date"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField label="备注">
          <UTextarea
            v-model="state.notes"
            :rows="4"
            placeholder="补充交付边界、客户节奏或上线说明"
            class="w-full"
          />
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
