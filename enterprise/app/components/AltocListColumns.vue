<script setup lang="ts">
const props = defineProps<{ name: string, columns: { key: string, label: string }[] }>()
const model = defineModel<string[]>({ required: true })
const scope = useState<string>('enterprise-cache-scope', () => '')
const { status } = useEnterpriseNavigationAccess()
const { error } = usePermissions()
const key = (value: string) => `apf-list-columns:v1:${props.name}:${value}`
watch(scope, (value, old) => {
  model.value = props.columns.map(column => column.key)
  if (!import.meta.client) return
  try {
    if (old && old !== value) window.localStorage.removeItem(key(old))
    const saved = value ? JSON.parse(window.localStorage.getItem(key(value)) || 'null') : null
    if (Array.isArray(saved)) model.value = saved.filter(item => props.columns.some(column => column.key === item))
  } catch { /* Display preferences are optional and contain only column keys. */ }
}, { immediate: true })
function save() {
  if (!import.meta.client || !scope.value || status.value !== 'ready' || error.value) return
  try {
    window.localStorage.setItem(key(scope.value), JSON.stringify(model.value))
  } catch { /* Keep the current in-memory view. */ }
}
defineExpose({ save })
</script>

<template>
  <UPopover>
    <UButton
      color="neutral"
      variant="outline"
    >
      <span class="hidden sm:inline">显示列</span><span class="sm:hidden">筛选</span>
    </UButton>
    <template
      #content
    >
      <div class="space-y-3 p-4">
        <div class="flex items-center justify-between gap-4">
          <p class="text-sm font-medium">
            显示列
          </p>
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            :disabled="!scope || status !== 'ready' || Boolean(error)"
            @click="save"
          >
            保存本机视图
          </UButton>
        </div>
        <UCheckbox
          v-for="column in columns"
          :key="column.key"
          :model-value="model.includes(column.key)"
          :label="column.label"
          @update:model-value="value => model = value ? [...model, column.key] : model.filter(key => key !== column.key)"
        />
      </div>
    </template>
  </UPopover>
</template>
