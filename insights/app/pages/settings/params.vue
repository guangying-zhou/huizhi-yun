<script setup lang="ts">
const { apiBase } = useApiBase()
const toast = useToast()

interface SystemParam {
  key: string
  value: string
  description?: string
}

const params = ref<Record<string, string>>({})
const loading = ref(false)
const saving = ref(false)

const paramDefinitions = [
  // { key: 'system_name', label: '系统名称', description: '显示在界面顶部的系统名称' },
  // { key: 'default_department_id', label: '默认部门ID', description: '新仓库的默认归属部门' },
  // { key: 'commit_batch_size', label: '提交批处理大小', description: '每次处理的提交数量' },
  // { key: 'sync_interval_hours', label: '同步间隔(小时)', description: '自动同步的间隔时间' },
  { key: 'daily_ingestion_enabled', label: '日常数据导入开关', description: '开=1 关=0，用于控制定时导入是否启用', inputType: 'switch', defaultValue: '0' },
  { key: 'daily_ingestion_cron', label: '日常数据导入定时', description: 'Cron 5段：分 时 日 月 周。例：0 2 * * *（每天 02:00）', placeholder: '0 2 * * *' },
  { key: 'workload_max_added', label: '工作量计算 - 新增行上限', description: '工作量计算 - 新增行上限（防止批量生成代码膨胀）', placeholder: '1000', inputType: 'number', defaultValue: '1000' },
  { key: 'workload_weight_deleted', label: '工作量计算 - 删除行权重', description: '工作量计算 - 删除行权重（基准为新增1行）', placeholder: '0.5', inputType: 'number', defaultValue: '0.5', step: '0.1' },
  { key: 'workload_weight_modified', label: '工作量计算 - 修改行权重', description: '工作量计算 - 修改行权重（基准为新增1行）', placeholder: '1.3', inputType: 'number', defaultValue: '1.3', step: '0.1' }
  // { key: 'retention_days', label: '数据保留天数', description: '日志数据保留天数' }
]

async function loadParams() {
  loading.value = true
  try {
    const result = await $fetch<{ data: SystemParam[] }>(`${apiBase}/settings/params`)
    const data = result.data ?? []
    params.value = Object.fromEntries(data.map(p => [p.key, p.value]))
    for (const def of paramDefinitions) {
      if (params.value[def.key] === undefined) {
        params.value[def.key] = def.defaultValue ?? ''
      }
    }
  } catch (error: any) {
    toast.add({ title: '加载失败', description: error.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

async function saveParams() {
  saving.value = true
  try {
    const allowedKeys = new Set(paramDefinitions.map(d => d.key))
    const kvBody = Object.fromEntries(
      Object.entries(params.value)
        .filter(([key]) => allowedKeys.has(key))
        .map(([key, value]) => [key, value ?? ''])
    )
    const updates = Object.entries(kvBody).map(([key, value]) => ({ key, value }))
    await ($fetch as any)(`${apiBase}/settings/params`, { method: 'PUT', body: { ...kvBody, params: updates } })
    toast.add({ title: '保存成功', color: 'success' })
  } catch (error: any) {
    toast.add({ title: '保存失败', description: error.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

onMounted(() => loadParams())
</script>

<template>
  <UDashboardPanel
    id="system-params"
    :ui="{ body: 'lg:py-12' }"
  >
    <template #header>
      <UDashboardNavbar title="系统参数">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            label="保存"
            icon="i-lucide-save"
            size="sm"
            :loading="saving"
            @click="saveParams"
          />
          <UButton
            icon="i-lucide-refresh-cw"
            variant="ghost"
            size="sm"
            :loading="loading"
            @click="loadParams"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-4 sm:gap-6 lg:gap-12 w-full lg:max-w-6xl mx-auto">
        <UPageCard
          title="系统参数"
          description="管理系统级参数配置"
          variant="naked"
          orientation="horizontal"
        />

        <UCard v-if="!loading">
          <div class="space-y-4">
            <UFormField
              v-for="param in paramDefinitions"
              :key="param.key"
              :label="param.label"
              :description="param.description"
              class="grid gap-2 sm:grid-cols-2"
              :ui="{ container: '' }"
            >
              <div
                v-if="param.inputType === 'switch'"
                class="flex items-center"
              >
                <USwitch
                  :model-value="params[param.key] === '1'"
                  @update:model-value="(v: boolean) => { params[param.key] = v ? '1' : '0' }"
                />
              </div>
              <UInput
                v-else
                v-model="params[param.key]"
                :type="param.inputType ?? 'text'"
                :placeholder="param.placeholder ?? param.key"
                :step="param.step"
                :class="['w-full', param.key.endsWith('_cron') ? 'font-mono' : '']"
              />
            </UFormField>
          </div>
        </UCard>
        <div
          v-else
          class="flex items-center justify-center h-64"
        >
          <UIcon
            name="i-lucide-loader-2"
            class="animate-spin text-2xl text-muted-400"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
