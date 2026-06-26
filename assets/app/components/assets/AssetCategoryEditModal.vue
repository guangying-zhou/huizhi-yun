<script setup lang="ts">
import { assetCategoryScopeMap, type AssetCategoryScope } from '~~/shared/assetCategoryDefaults'
import type { ApiResponse, AssetCategoryGroup } from '~/types'

const props = defineProps<{
  open: boolean
  category: AssetCategoryGroup | null
  scope: AssetCategoryScope
  mode?: 'create' | 'category' | 'items'
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const scopeMeta = computed(() => assetCategoryScopeMap[props.category?.scope || props.scope])
const isCreateMode = computed(() => props.mode === 'create')
const isCategoryMode = computed(() => props.mode === 'category')
const isItemsMode = computed(() => props.mode === 'items')
const showCategoryFields = computed(() => isCreateMode.value || isCategoryMode.value)
const showItemFields = computed(() => scopeMeta.value.itemsSupported && (isCreateMode.value || isItemsMode.value))

const modalTitle = computed(() => {
  if (isCreateMode.value) {
    return `新增${scopeMeta.value.groupLabel}`
  }
  if (isItemsMode.value) {
    return props.category ? `编辑${scopeMeta.value.itemLabel}：${props.category.label}` : `编辑${scopeMeta.value.itemLabel}`
  }
  return props.category ? `编辑${scopeMeta.value.groupLabel}：${props.category.label}` : `编辑${scopeMeta.value.groupLabel}`
})

const modalDescription = computed(() => {
  if (isCreateMode.value) {
    return scopeMeta.value.itemsSupported
      ? `新增${scopeMeta.value.groupLabel}，并初始化其下属${scopeMeta.value.itemLabel}。保存后相关录入表单会立即使用新分类。`
      : `新增${scopeMeta.value.groupLabel}。保存后相关录入表单会立即使用新分类。`
  }
  if (isItemsMode.value) {
    return `维护当前${scopeMeta.value.groupLabel}下的${scopeMeta.value.itemLabel}。保存后相关录入表单会立即使用新的细分项。`
  }
  return `仅维护${scopeMeta.value.groupLabel}本身的信息，不修改其下属分类。`
})

interface EditableItem {
  label: string
  value: string
  shortCode: string
  description: string
  enabled: boolean
  sortOrder: number
}

const toast = useToast()
const submitting = ref(false)
const state = reactive({
  label: '',
  value: '',
  shortCode: '',
  description: '',
  enabled: true,
  sortOrder: 1,
  items: [] as EditableItem[]
})

function hydrate() {
  state.label = props.category?.label || ''
  state.value = props.category?.value || ''
  state.shortCode = props.category?.shortCode || ''
  state.description = props.category?.description || ''
  state.enabled = props.category?.enabled !== false
  state.sortOrder = props.category?.sortOrder || 1
  state.items = (props.category?.items || []).map((item, index) => ({
    label: item.label,
    value: item.value,
    shortCode: item.shortCode || '',
    description: item.description || '',
    enabled: item.enabled !== false,
    sortOrder: item.sortOrder || index + 1
  }))
}

watch(() => props.open, (open) => {
  if (open) {
    hydrate()
  }
})

watch(() => props.category, () => {
  if (props.open) {
    hydrate()
  }
})

watch(() => props.scope, () => {
  if (props.open && !props.category) {
    hydrate()
  }
})

function addItem() {
  state.items.push({
    label: '',
    value: '',
    shortCode: '',
    description: '',
    enabled: true,
    sortOrder: state.items.length + 1
  })
}

function removeItem(index: number) {
  state.items.splice(index, 1)
  state.items.forEach((item, itemIndex) => {
    item.sortOrder = itemIndex + 1
  })
}

async function handleSubmit() {
  if (showCategoryFields.value && (!state.label.trim() || !state.value.trim())) {
    toast.add({ title: '缺少类别信息', description: `请填写${scopeMeta.value.groupLabel}名称和值。`, color: 'warning' })
    return
  }

  if (showItemFields.value && !state.items.some(item => item.label.trim() && item.value.trim())) {
    toast.add({ title: `缺少${scopeMeta.value.itemLabel}`, description: `至少保留一个可用的${scopeMeta.value.itemLabel}。`, color: 'warning' })
    return
  }

  submitting.value = true

  try {
    const fallbackCategory = props.category
    const nextItems = showItemFields.value
      ? state.items
      : (fallbackCategory?.items || []).map((item, index) => ({
          label: item.label,
          value: item.value,
          shortCode: item.shortCode || '',
          description: item.description || '',
          enabled: item.enabled !== false,
          sortOrder: item.sortOrder || index + 1
        }))

    const body = {
      scope: props.category?.scope || props.scope,
      label: showCategoryFields.value ? state.label.trim() : (fallbackCategory?.label || ''),
      value: showCategoryFields.value ? state.value.trim() : (fallbackCategory?.value || ''),
      shortCode: showCategoryFields.value ? state.shortCode.trim() : (fallbackCategory?.shortCode || ''),
      description: showCategoryFields.value ? (state.description.trim() || '') : (fallbackCategory?.description || ''),
      enabled: showCategoryFields.value ? state.enabled : (fallbackCategory?.enabled !== false),
      sortOrder: showCategoryFields.value ? state.sortOrder : (fallbackCategory?.sortOrder || 1),
      items: nextItems.map((item, index) => ({
        label: item.label.trim(),
        value: item.value.trim(),
        shortCode: item.shortCode.trim(),
        description: item.description.trim() || '',
        enabled: item.enabled,
        sortOrder: item.sortOrder || index + 1
      }))
    }

    if (!isCreateMode.value && props.category?.id) {
      await $fetch<ApiResponse<AssetCategoryGroup>>(`/api/v1/admin/asset-categories/${props.category.id}`, {
        method: 'PUT',
        body
      })
    } else {
      await $fetch<ApiResponse<AssetCategoryGroup>>('/api/v1/admin/asset-categories', {
        method: 'POST',
        body
      })
    }

    toast.add({
      title: isCreateMode.value ? `${scopeMeta.value.groupLabel}已创建` : (isItemsMode.value ? `${scopeMeta.value.itemLabel}已更新` : `${scopeMeta.value.groupLabel}已更新`),
      description: isCategoryMode.value ? `${scopeMeta.value.groupLabel}信息已保存。` : (isItemsMode.value ? `${scopeMeta.value.itemLabel}信息已保存。` : '新的分类已写入数据库。'),
      color: 'success',
      icon: 'i-lucide-check'
    })

    emit('saved')
    isOpen.value = false
  } catch (error) {
    console.error('[AssetCategoryEdit] Failed:', error)
    toast.add({
      title: '保存失败',
      description: '请检查类别值是否重复，以及录入项是否完整。',
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
    :title="modalTitle"
    :description="modalDescription"
    :ui="{ content: 'sm:max-w-5xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <div v-if="showCategoryFields" class="grid gap-4 md:grid-cols-2">
          <UFormField :label="`${scopeMeta.groupLabel}名称`" required>
            <UInput v-model="state.label" class="w-full" :placeholder="`例如：${scopeMeta.scope === 'product' ? '平台产品' : '办公设备'}`" />
          </UFormField>

          <UFormField :label="`${scopeMeta.groupLabel}值`" required>
            <UInput v-model="state.value" class="w-full" :placeholder="scopeMeta.scope === 'product' ? '例如：platform' : '例如：办公设备'" />
          </UFormField>

          <UFormField label="编码缩写">
            <UInput v-model="state.shortCode" class="w-full" :placeholder="scopeMeta.scope === 'physical' ? '例如：OFF' : '例如：PLT'" />
          </UFormField>

          <UFormField label="说明">
            <UInput v-model="state.description" class="w-full" placeholder="可选说明" />
          </UFormField>

          <div class="grid gap-4 md:grid-cols-[160px_auto]">
            <UFormField label="排序">
              <UInput v-model="state.sortOrder" type="number" class="w-full" />
            </UFormField>
            <div class="flex items-end">
              <USwitch v-model="state.enabled" :label="`启用该${scopeMeta.groupLabel}`" />
            </div>
          </div>
        </div>

        <div v-if="showItemFields" class="flex items-center justify-between">
          <div>
            <p class="font-medium">
              {{ scopeMeta.itemLabel }}
            </p>
            <p class="text-sm text-muted">
              每个{{ scopeMeta.groupLabel }}下可维护多个可选{{ scopeMeta.itemLabel }}，录入资产时按所选分类联动展示。
            </p>
          </div>
          <UButton icon="i-lucide-plus" size="sm" @click="addItem">
            新增{{ scopeMeta.itemLabel }}
          </UButton>
        </div>

        <div v-if="showItemFields" class="space-y-3">
          <UCard
            v-for="(item, index) in state.items"
            :key="`${state.value || 'asset-category'}-${index}`"
            variant="subtle"
          >
            <div class="grid gap-3 md:grid-cols-[1fr_1fr_160px_1.2fr_120px_auto] md:items-center">
              <UFormField :label="`${scopeMeta.itemLabel}名称`">
                <UInput v-model="item.label" class="w-full" placeholder="例如：笔记本" />
              </UFormField>
              <UFormField :label="`${scopeMeta.itemLabel}值`">
                <UInput v-model="item.value" class="w-full" placeholder="例如：笔记本" />
              </UFormField>
              <UFormField label="编码缩写">
                <UInput v-model="item.shortCode" class="w-full" placeholder="例如：LTP" />
              </UFormField>
              <UFormField label="说明">
                <UInput v-model="item.description" class="w-full" placeholder="可选说明" />
              </UFormField>
              <UFormField label="排序">
                <UInput v-model="item.sortOrder" type="number" class="w-full" />
              </UFormField>
              <div class="flex items-end gap-2">
                <USwitch v-model="item.enabled" label="启用" />
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  square
                  @click="removeItem(index)"
                />
              </div>
            </div>
          </UCard>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton color="neutral" variant="outline" @click="isOpen = false">
          取消
        </UButton>
        <UButton :loading="submitting" icon="i-lucide-save" @click="handleSubmit">
          {{ isItemsMode ? `保存${scopeMeta.itemLabel}` : (isCategoryMode ? `保存${scopeMeta.groupLabel}` : '保存类别') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
