<script setup lang="ts">
import { financeViewColumns, financeViewFilters } from '../../utils/financeWorkbench'
import { useFinanceModule } from '../../../layer/useFinanceModule'

const props = defineProps<{ options: { value: string, label: string }[], viewKey: string, filters?: Record<string, string> }>()
const emit = defineEmits<{ restore: [filters: Record<string, string>] }>()
const model = defineModel<string[]>({ required: true })
const { sessionScope } = useFinanceModule()
const toast = useToast()
const key = (scope: string) => `finance-columns:v1:${encodeURIComponent(scope)}:${props.viewKey}`
function restore() {
  model.value = []
  if (!import.meta.client || !sessionScope?.value) return
  try {
    const saved = JSON.parse(localStorage.getItem(key(sessionScope.value)) || 'null')
    model.value = financeViewColumns(saved?.columns, props.options.map(option => option.value))
    if (saved?.filters) emit('restore', financeViewFilters(saved.filters))
  } catch { /* A blocked or obsolete preference must not block the list. */ }
}
function toggle(value: string, checked: boolean) {
  model.value = checked ? [...model.value, value] : model.value.filter(key => key !== value)
}
function save() {
  if (!sessionScope?.value) return
  try {
    localStorage.setItem(key(sessionScope.value), JSON.stringify({ columns: financeViewColumns(model.value, props.options.map(option => option.value)), filters: financeViewFilters(props.filters) }))
    toast.add({ title: '显示列视图已保存', color: 'success' })
  } catch {
    toast.add({ title: '无法保存视图，请检查浏览器存储设置', color: 'error' })
  }
}
onMounted(restore)
watch(() => sessionScope?.value, (scope, oldScope) => {
  if (import.meta.client && oldScope && oldScope !== scope) {
    try {
      localStorage.removeItem(key(oldScope))
    } catch { /* Storage may be unavailable. */ }
  }
  restore()
})
</script>

<template>
  <UPopover>
    <UButton
      color="neutral"
      variant="outline"
      icon="i-lucide-columns-3"
    >
      显示列
    </UButton>
    <template #content>
      <div class="w-64 space-y-3 p-4">
        <p class="text-sm text-muted">
          基础列始终显示
        </p>
        <UCheckbox
          v-for="option in options"
          :key="option.value"
          :label="option.label"
          :model-value="model.includes(option.value)"
          @update:model-value="toggle(option.value, !!$event)"
        />
        <UButton
          color="neutral"
          variant="outline"
          class="w-full"
          :disabled="!sessionScope"
          @click="save"
        >
          保存视图
        </UButton>
      </div>
    </template>
  </UPopover>
</template>
