<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'

interface ParamItem {
  key: string
  value: string
  description: string | null
  updatedAt: string | null
}

const paramMeta = [
  {
    key: 'minimum_commits',
    label: '有效仓库最少提交数',
    defaultValue: '10',
    defaultDescription: '有效仓库最少提交数',
    type: 'int',
    step: 1,
    min: 0
  },
  {
    key: 'minimum_days',
    label: '有效仓库最少持续天数',
    defaultValue: '30',
    defaultDescription: '有效仓库最少持续天数',
    type: 'int',
    step: 1,
    min: 0
  },
  {
    key: 'workload_max_added',
    label: '工作量计算 - 新增行上限',
    defaultValue: '1000',
    defaultDescription: '工作量计算 - 新增行上限（防止批量生成代码膨胀）',
    type: 'int',
    step: 1,
    min: 0
  },
  {
    key: 'workload_weight_deleted',
    label: '工作量计算 - 删除行权重',
    defaultValue: '0.5',
    defaultDescription: '工作量计算 - 删除行权重（基准为1）',
    type: 'float',
    step: 0.1,
    min: 0
  },
  {
    key: 'workload_weight_modified',
    label: '工作量计算 - 修改行权重',
    defaultValue: '1.3',
    defaultDescription: '工作量计算 - 修改行权重（基准为1）',
    type: 'float',
    step: 0.1,
    min: 0
  }
] as const

type ParamKey = (typeof paramMeta)[number]['key']

usePageTitle('参数设置')

const toast = useToast()

const loading = ref(false)
const saving = ref(false)

const values = reactive<Record<ParamKey, string>>(
  Object.fromEntries(paramMeta.map(p => [p.key, p.defaultValue])) as Record<ParamKey, string>
)

const descriptions = reactive<Record<ParamKey, string>>(
  Object.fromEntries(paramMeta.map(p => [p.key, p.defaultDescription])) as Record<ParamKey, string>
)

const updatedAtMap = reactive<Record<ParamKey, string | null>>(
  Object.fromEntries(paramMeta.map(p => [p.key, null])) as Record<ParamKey, string | null>
)

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-'
  return dateStr.replace('T', ' ').replace(/\.\d+.*$/, '')
}

async function loadParams() {
  loading.value = true
  try {
    const result = await $fetch<{ data: ParamItem[] }>('/api/settings/params')
    for (const item of result.data || []) {
      const meta = paramMeta.find(p => p.key === item.key)
      if (!meta) continue
      const key = meta.key
      values[key] = item.value
      descriptions[key] = item.description ?? descriptions[key]
      updatedAtMap[key] = item.updatedAt
    }
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, message?: string }
    toast.add({
      title: '加载失败',
      description: err.data?.statusMessage || err.message || '无法加载参数',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const body: Record<string, string> = {}
    for (const p of paramMeta) {
      body[p.key] = values[p.key]
    }
    await $fetch('/api/settings/params', {
      method: 'PUT',
      body
    })
    toast.add({ title: '保存成功', color: 'success' })
    await loadParams()
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, message?: string }
    toast.add({
      title: '保存失败',
      description: err.data?.statusMessage || err.message || '无法保存参数',
      color: 'error'
    })
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  loadParams()
})
</script>

<template>
  <div class="flex w-full min-w-0">
    <UDashboardPanel id="settings-params" :ui="{ body: 'gap-1 sm:p-3' }">
      <template #header>
        <div class="flex justify-end gap-2 px-4 py-2 border-b border-default">
          <UButton
            color="primary"
            size="sm"
            variant="solid"
            icon="i-lucide-save"
            :loading="saving"
            @click="save"
          >
            保存
          </UButton>
          <UButton
            color="secondary"
            size="sm"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            :loading="loading"
            @click="loadParams"
          >
            刷新
          </UButton>
        </div>
      </template>

      <template #body>
        <UCard class="w-full md:w-2/3 max-w-none mx-auto">
          <div class="space-y-6">
            <div v-for="(p, i) in paramMeta" :key="p.key" class="space-y-2">
              <UFormField
                :label="p.label"
                :description="descriptions[p.key]"
                class="flex max-sm:flex-col justify-between items-start gap-4"
                :ui="{ container: 'w-60' }"
              >
                <UInput
                  v-model="values[p.key]"
                  type="number"
                  :step="p.step"
                  :min="p.min"
                  class="w-60"
                />
              </UFormField>
              <div class="text-xs text-muted-500">
                参数键：{{ p.key }}，更新时间：{{ formatDate(updatedAtMap[p.key]) }}
              </div>
              <USeparator v-if="i < paramMeta.length - 1" />
            </div>
          </div>
        </UCard>
      </template>
    </UDashboardPanel>
  </div>
</template>
