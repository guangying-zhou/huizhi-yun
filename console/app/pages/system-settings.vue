<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('系统参数')

type SettingValue = {
  settingKey: string
  settingName: string
  valueType: string
  category: string
  scopeKey: string
  value: unknown
  defaultValue: unknown
  source: string
  hasCustomValue: boolean
  editableInUi: boolean
  description: string | null
  updatedBy: string | null
  updatedAt: string | null
}

type ApiResponse<T> = {
  code: number
  data: T
  message?: string
}

const toast = useToast()
const activeCategory = ref('all')
const savingKey = ref('')
const drafts = reactive<Record<string, unknown>>({})

const { data, pending, refresh } = await useFetch<ApiResponse<{ items: SettingValue[] }>>(
  '/api/v1/console/settings/values',
  {
    default: () => ({ code: 0, data: { items: [] } })
  }
)

const settings = computed(() => data.value?.data.items || [])
const categories = computed(() => {
  const values = [...new Set(settings.value.map(item => item.category || 'general'))].sort()
  return [
    { label: '全部', value: 'all' },
    ...values.map(value => ({ label: categoryLabel(value), value }))
  ]
})
const visibleSettings = computed(() => activeCategory.value === 'all'
  ? settings.value
  : settings.value.filter(item => item.category === activeCategory.value))

watch(settings, (items) => {
  for (const item of items) {
    if (drafts[item.settingKey] === undefined) {
      drafts[item.settingKey] = toDraftValue(item)
    }
  }
}, { immediate: true })

function categoryLabel(category: string) {
  const labels: Record<string, string> = {
    runtime: '运行时',
    workflow: '审批流',
    auth: '认证',
    notification: '通知',
    ui: '界面',
    application: '应用参数',
    general: '通用'
  }
  return labels[category] || category
}

function typeLabel(valueType: string) {
  const labels: Record<string, string> = {
    string: '字符串',
    url: 'URL',
    number: '数字',
    boolean: '布尔',
    json: 'JSON'
  }
  return labels[valueType] || valueType
}

function toDraftValue(item: SettingValue) {
  if (item.valueType === 'json') {
    return JSON.stringify(item.value ?? null, null, 2)
  }
  return item.value
}

function normalizeDraftValue(item: SettingValue) {
  const draft = drafts[item.settingKey]
  if (item.valueType === 'json') {
    return JSON.parse(String(draft || 'null'))
  }
  if (item.valueType === 'number') {
    return Number(draft)
  }
  if (item.valueType === 'boolean') {
    return Boolean(draft)
  }
  return String(draft ?? '').trim()
}

async function saveSetting(item: SettingValue) {
  savingKey.value = item.settingKey
  try {
    await $fetch(`/api/v1/console/settings/values/${encodeURIComponent(item.settingKey)}`, {
      method: 'PUT',
      body: {
        scopeKey: item.scopeKey,
        value: normalizeDraftValue(item)
      }
    })
    toast.add({ color: 'success', title: '已保存', description: item.settingName })
    await refresh()
    drafts[item.settingKey] = toDraftValue(settings.value.find(row => row.settingKey === item.settingKey) || item)
  } catch (error) {
    toast.add({
      color: 'error',
      title: '保存失败',
      description: error instanceof Error ? error.message : String(error)
    })
  } finally {
    savingKey.value = ''
  }
}
</script>

<template>
  <UDashboardPanel id="system-settings" :ui="dashboardPanelUi">
    <template #body>
      <div class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <UFieldGroup>
            <UButton
              v-for="category in categories"
              :key="category.value"
              :label="category.label"
              :color="activeCategory === category.value ? 'primary' : 'neutral'"
              :variant="activeCategory === category.value ? 'solid' : 'subtle'"
              @click="activeCategory = category.value"
            />
          </UFieldGroup>
          <UBadge color="neutral" variant="subtle">
            {{ visibleSettings.length }} 项
          </UBadge>
        </div>

        <div class="overflow-hidden rounded-lg border border-default bg-default">
          <div class="grid grid-cols-12 gap-3 border-b border-default bg-muted px-4 py-3 text-xs font-medium text-muted">
            <div class="col-span-3">
              参数
            </div>
            <div class="col-span-5">
              当前值
            </div>
            <div class="col-span-2">
              类型
            </div>
            <div class="col-span-2 text-right">
              操作
            </div>
          </div>

          <div v-if="pending" class="space-y-3 p-4">
            <USkeleton v-for="i in 4" :key="i" class="h-16 w-full" />
          </div>

          <div v-else-if="!visibleSettings.length" class="p-8 text-center text-sm text-muted">
            暂无系统参数
          </div>

          <div v-else class="divide-y divide-default">
            <div
              v-for="item in visibleSettings"
              :key="item.settingKey"
              class="grid grid-cols-12 items-start gap-3 px-4 py-3"
            >
              <div class="col-span-12 space-y-1 md:col-span-3">
                <div class="font-medium text-highlighted">
                  {{ item.settingName }}
                </div>
                <div class="font-mono text-xs text-muted">
                  {{ item.settingKey }}
                </div>
                <div v-if="item.description" class="text-xs text-muted">
                  {{ item.description }}
                </div>
              </div>

              <div class="col-span-12 md:col-span-5">
                <USwitch
                  v-if="item.valueType === 'boolean'"
                  :model-value="Boolean(drafts[item.settingKey])"
                  :disabled="!item.editableInUi"
                  @update:model-value="value => drafts[item.settingKey] = value"
                />
                <UInput
                  v-else-if="item.valueType === 'number'"
                  :model-value="Number(drafts[item.settingKey] || 0)"
                  type="number"
                  :disabled="!item.editableInUi"
                  @update:model-value="value => drafts[item.settingKey] = value"
                />
                <UTextarea
                  v-else-if="item.valueType === 'json'"
                  :model-value="String(drafts[item.settingKey] ?? '')"
                  autoresize
                  :rows="4"
                  :disabled="!item.editableInUi"
                  @update:model-value="value => drafts[item.settingKey] = value"
                />
                <UInput
                  v-else
                  :model-value="String(drafts[item.settingKey] ?? '')"
                  :type="item.valueType === 'url' ? 'url' : 'text'"
                  :disabled="!item.editableInUi"
                  @update:model-value="value => drafts[item.settingKey] = value"
                />
                <div class="mt-1 flex gap-2 text-xs text-muted">
                  <span>{{ item.hasCustomValue ? '自定义' : '默认值' }}</span>
                  <span v-if="item.updatedAt">更新于 {{ item.updatedAt }}</span>
                </div>
              </div>

              <div class="col-span-6 md:col-span-2">
                <UBadge color="neutral" variant="subtle">
                  {{ typeLabel(item.valueType) }}
                </UBadge>
              </div>

              <div class="col-span-6 text-right md:col-span-2">
                <UButton
                  icon="i-lucide-save"
                  color="primary"
                  variant="subtle"
                  :loading="savingKey === item.settingKey"
                  :disabled="!item.editableInUi"
                  @click="saveSetting(item)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
