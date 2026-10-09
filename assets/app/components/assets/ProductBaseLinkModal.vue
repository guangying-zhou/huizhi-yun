<script setup lang="ts">
import RemoteAssetObjectSelect from './RemoteAssetObjectSelect.vue'
import { useAssetsModule } from '../../../layer/useAssetsModule'
import type { ApiResponse, ProductAssetItem } from '../../types'

const { moduleUrl } = useAssetsModule()
const commandKey = ref(crypto.randomUUID())

const props = defineProps<{
  open: boolean
  product: ProductAssetItem | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': []
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const toast = useToast()
const submitting = ref(false)
const state = reactive({
  technology_base_id: undefined as number | undefined
})

watch(state, () => {
  commandKey.value = crypto.randomUUID()
}, { deep: true, flush: 'sync' })

watch(() => props.open, async (open) => {
  if (open) {
    commandKey.value = crypto.randomUUID()
    state.technology_base_id = undefined
  }
})

async function handleSubmit() {
  if (!props.product?.id) {
    return
  }

  if (!state.technology_base_id) {
    toast.add({ title: '缺少技术底座', description: '请先选择要关联的技术底座。', color: 'warning' })
    return
  }

  submitting.value = true

  try {
    await $fetch<ApiResponse<{ id: number }>>(moduleUrl(`/api/v1/products/${props.product.id}/bases`), {
      method: 'POST',
      headers: { 'Idempotency-Key': commandKey.value },
      body: {
        technology_base_id: state.technology_base_id
      }
    })

    toast.add({ title: '技术底座已关联', description: '产品与底座关系已保存。', color: 'success', icon: 'i-lucide-check' })
    emit('created')
    isOpen.value = false
  } catch (error) {
    console.error('[ProductBaseLink] Failed:', error)
    toast.add({ title: '关联失败', description: '可能已存在相同关联。', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="关联技术底座"
    description="把基础平台、中台能力或共用模块挂到当前产品。"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <UFormField label="技术底座" required>
          <RemoteAssetObjectSelect
            v-model="state.technology_base_id"
            kind="bases"
            :enabled="isOpen"
            :exclude-ids="(props.product?.linked_bases || []).map(item => item.id)"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton color="neutral" variant="outline" @click="isOpen = false">
          取消
        </UButton>
        <UButton :loading="submitting" icon="i-lucide-link-2" @click="handleSubmit">
          确认关联
        </UButton>
      </div>
    </template>
  </UModal>
</template>
