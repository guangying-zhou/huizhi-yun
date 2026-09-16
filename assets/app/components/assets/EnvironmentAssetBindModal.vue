<script setup lang="ts">
import type { ApiResponse, AssetListItem, EnvironmentItem, ListPayload } from '~/types'

const props = defineProps<{
  open: boolean
  environment: EnvironmentItem | null
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
const loadingAssets = ref(false)
const assetOptions = ref<Array<{ label: string, value: number }>>([])
const relationOptions = [
  { label: '计算资源', value: 'compute' },
  { label: '数据库', value: 'database' },
  { label: '中间件', value: 'middleware' },
  { label: 'Seat', value: 'seat' },
  { label: '额度', value: 'quota' },
  { label: '域名证书', value: 'domain_cert' },
  { label: '安全能力', value: 'security' },
  { label: '交付物', value: 'delivery_artifact' },
  { label: '其他', value: 'other' }
]

const state = reactive({
  asset_id: undefined as number | undefined,
  relation_type: 'other',
  is_primary: false
})

function hydrate() {
  state.asset_id = undefined
  state.relation_type = 'other'
  state.is_primary = false
}

async function loadAssets() {
  loadingAssets.value = true

  try {
    const response = await $fetch<ApiResponse<ListPayload<AssetListItem>>>('/api/v1/assets')
    const linkedIds = new Set((props.environment?.linked_assets || []).map(item => item.id))
    assetOptions.value = (response.data.items || [])
      .filter(item => !linkedIds.has(item.id))
      .map(item => ({
        label: `${item.asset_code} · ${item.asset_name}`,
        value: item.id
      }))
  } catch (error) {
    console.error('[EnvironmentAssetBind] Failed to load assets:', error)
    toast.add({
      title: '资产加载失败',
      description: '请刷新后重试。',
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
  } finally {
    loadingAssets.value = false
  }
}

watch(() => props.open, async (open) => {
  if (open) {
    hydrate()
    await loadAssets()
  }
})

async function handleSubmit() {
  if (!props.environment?.id) {
    return
  }

  if (!state.asset_id) {
    toast.add({ title: '缺少资产', description: '请先选择要绑定的资产。', color: 'warning' })
    return
  }

  submitting.value = true

  try {
    await $fetch<ApiResponse<{ id: number }>>(`/api/v1/environments/${props.environment.id}/assets`, {
      method: 'POST',
      body: {
        asset_id: state.asset_id,
        relation_type: state.relation_type,
        is_primary: state.is_primary
      }
    })

    toast.add({
      title: '资产已绑定',
      description: '环境与资产关联已保存。',
      color: 'success',
      icon: 'i-lucide-check'
    })

    emit('created')
    isOpen.value = false
  } catch (error) {
    console.error('[EnvironmentAssetBind] Failed:', error)
    toast.add({
      title: '绑定失败',
      description: '可能已存在相同关联，请检查后重试。',
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
    title="绑定资产"
    description="将现有资产挂到当前环境，用于环境视图、成本归因和交付追踪。"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <UFormField label="选择资产" required>
          <USelectMenu
            v-model="state.asset_id"
            :items="assetOptions"
            :loading="loadingAssets"
            value-key="value"
            placeholder="请选择待绑定资产"
            searchable
          />
        </UFormField>

        <UFormField label="关联类型">
          <USelect
            v-model="state.relation_type"
            :items="relationOptions"
            placeholder="请选择关联类型"
            class="w-full"
          />
        </UFormField>

        <UCheckbox v-model="state.is_primary" label="设为该环境的主要资产" />
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton color="neutral" variant="outline" @click="isOpen = false">
          取消
        </UButton>
        <UButton :loading="submitting" icon="i-lucide-link-2" @click="handleSubmit">
          确认绑定
        </UButton>
      </div>
    </template>
  </UModal>
</template>
