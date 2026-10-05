<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'
import { normalizeProjectModuleConfig, projectModuleKeys, projectModuleMeta, toPersistedProjectModuleConfig } from '../../utils/projectModuleConfig'
import type { ProjectCategory } from '../../types/aims'

const props = defineProps<{ projectId: string, category: ProjectCategory, config: unknown, expectedVersion: string, canManage: boolean }>()
const emit = defineEmits<{ saved: [], refresh: [] }>()
const { moduleUrl } = useAimsModule()
const toast = useToast()
const baseline = ref(normalizeProjectModuleConfig(props.config, props.category))
const originalConfig = ref(props.config ?? null)
const version = ref(props.expectedVersion)
const draft = reactive({ ...baseline.value })
const saving = ref(false)
const error = ref('')
const operation = ref<{ key: string, body: Record<string, unknown> } | null>(null)
const changed = computed(() => {
  return projectModuleKeys.some(key => draft[key] !== baseline.value[key])
})
function reset() {
  if (operation.value) return
  baseline.value = normalizeProjectModuleConfig(props.config, props.category)
  originalConfig.value = props.config ?? null
  version.value = props.expectedVersion
  Object.assign(draft, baseline.value)
}
watch(() => [props.config, props.expectedVersion], () => {
  if (!changed.value && !operation.value) reset()
})
async function save() {
  if (!props.canManage || (!changed.value && !operation.value)) return
  operation.value ||= { key: crypto.randomUUID(), body: { expectedVersion: version.value, expectedModuleConfig: originalConfig.value, moduleConfig: toPersistedProjectModuleConfig(draft, props.category) } }
  saving.value = true
  error.value = ''
  try {
    const response = await $fetch<{ code: number }>(moduleUrl(`/api/v1/projects/${props.projectId}/modules`), {
      method: 'PUT', headers: { 'Idempotency-Key': operation.value.key }, body: operation.value.body
    })
    if (response.code !== 0) throw Error('项目模块响应无效')
    operation.value = null
    baseline.value = { ...draft }
    originalConfig.value = toPersistedProjectModuleConfig(draft, props.category)
    toast.add({ title: '项目模块已保存', color: 'success' })
    emit('saved')
  } catch (cause) {
    const failure = cause as { statusCode?: number, status?: number }
    const status = failure.statusCode || failure.status || 0
    error.value = status === 409 ? '模块或项目资料已被他人修改。草稿已保留，请刷新项目后比较。' : status === 403 ? '你没有修改项目模块的权限。草稿已保留。' : '保存结果未确认，可能已提交，重试将沿用同一请求安全续行。草稿已保留。'
    if (status && status < 500) operation.value = null
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h3 class="font-semibold">
          项目模块
        </h3>
        <div v-if="canManage" class="flex flex-wrap gap-2">
          <UButton
            label="重置草稿"
            color="neutral"
            variant="outline"
            :disabled="saving || !!operation || !changed"
            @click="reset"
          />
          <UButton
            label="恢复类别默认"
            color="neutral"
            variant="outline"
            :disabled="saving || !!operation"
            @click="Object.assign(draft, normalizeProjectModuleConfig(null, category))"
          />
          <UButton
            label="保存模块"
            :loading="saving"
            :disabled="!changed && !operation"
            @click="save"
          />
        </div>
      </div>
    </template>
    <div class="space-y-4">
      <p class="text-sm text-muted">
        未配置时使用项目类别默认值；开关只控制模块入口，不改变数据或权限。
      </p>
      <UAlert
        v-if="!canManage"
        color="neutral"
        title="项目模块只读"
        description="仅具有项目编辑范围权限的当前负责人或在职项目经理可修改。"
      />
      <UAlert v-if="error" color="error" :description="error">
        <template #actions>
          <UButton
            label="刷新比较"
            color="neutral"
            variant="outline"
            @click="emit('refresh')"
          />
        </template>
      </UAlert>
      <p v-if="error" class="text-sm text-muted">
        刷新不会覆盖模块草稿；核对后可重置草稿采用最新配置。
      </p>
      <div class="grid gap-4 md:grid-cols-2">
        <div v-for="key in projectModuleKeys" :key="key" class="flex min-w-0 items-center justify-between gap-3">
          <div class="min-w-0">
            <label :for="`module-${key}`" class="font-medium">{{ projectModuleMeta[key].label }}</label>
            <p class="text-sm text-muted">
              {{ projectModuleMeta[key].description }}
            </p>
          </div>
          <USwitch
            :id="`module-${key}`"
            v-model="draft[key]"
            class="shrink-0"
            :aria-label="projectModuleMeta[key].label"
            :disabled="!canManage || saving || !!operation"
          />
        </div>
      </div>
    </div>
  </UCard>
</template>
