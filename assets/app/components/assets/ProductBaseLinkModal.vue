<script setup lang="ts">
import type { ApiResponse, ListPayload, ProductAssetItem, TechnologyBaseItem } from '~/types'

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
const loadingBases = ref(false)
const baseOptions = ref<Array<{ label: string, value: number }>>([])
const state = reactive({
  technology_base_id: undefined as number | undefined
})

async function loadBases() {
  loadingBases.value = true

  try {
    const response = await $fetch<ApiResponse<ListPayload<TechnologyBaseItem>>>('/api/v1/technology-bases')
    const linkedIds = new Set((props.product?.linked_bases || []).map(item => item.id))
    baseOptions.value = (response.data.items || [])
      .filter(item => !linkedIds.has(item.id))
      .map(item => ({ label: `${item.base_code} · ${item.base_name}`, value: item.id }))
  } catch (error) {
    console.error('[ProductBaseLink] Failed to load bases:', error)
    toast.add({ title: '底座加载失败', description: '请刷新后重试。', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    loadingBases.value = false
  }
}

watch(() => props.open, async (open) => {
  if (open) {
    state.technology_base_id = undefined
    await loadBases()
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
    await $fetch<ApiResponse<{ id: number }>>(`/api/v1/products/${props.product.id}/bases`, {
      method: 'POST',
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
          <USelectMenu
            v-model="state.technology_base_id"
            :items="baseOptions"
            :loading="loadingBases"
            value-key="value"
            placeholder="请选择技术底座"
            searchable
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
