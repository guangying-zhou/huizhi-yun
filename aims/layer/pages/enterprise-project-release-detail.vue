<script setup lang="ts">
import { useAimsModule } from '../useAimsModule'
import { projectModuleEnabled } from '../../app/utils/projectModuleConfig'
import { releaseStatusBadge } from '../../app/utils/projectDeliverablePresentation'

type Release = { id: number, product_code?: string, product_name?: string | null, version_code?: string, name?: string | null, description?: string | null, status?: string, planned_release_date?: string | null, released_at?: string | null, progress_percent?: number, target_count?: number, completed_count?: number, feature_count?: number, delivered_feature_count?: number }
const route = useRoute()
const { moduleUrl } = useAimsModule()
const objectContext = useProvidedEnterpriseProjectObjectContext()
if (!objectContext) throw new Error('企业项目版本缺少 Host 对象上下文')
type Project = { category?: string, moduleConfig?: unknown, module_config?: unknown }
const project = objectContext.project as Ref<Project | null>
const moduleEnabled = computed(() => projectModuleEnabled(
  project.value?.moduleConfig ?? project.value?.module_config,
  project.value?.category as Parameters<typeof projectModuleEnabled>[1],
  'releases'
))
const projectId = computed(() => String(route.params.id || ''))
const releaseId = computed(() => String(route.params.releaseId || ''))
const item = ref<Release | null>(null)
const loading = ref(false)
const error = ref('')
let requestSequence = 0
async function refresh() {
  const request = ++requestSequence
  error.value = ''
  item.value = null
  if (!project.value || !moduleEnabled.value) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const result = await $fetch<{ code: number, data?: Release }>(moduleUrl(`/api/v1/projects/${projectId.value}/releases/${releaseId.value}`))
    if (request !== requestSequence) return
    if (result.code !== 0 || !result.data) throw new Error('项目版本摘要暂不可用')
    item.value = result.data
  } catch (cause) {
    if (request !== requestSequence) return
    item.value = null
    error.value = cause instanceof Error ? cause.message : '项目版本摘要暂不可用'
  } finally {
    if (request === requestSequence) loading.value = false
  }
}
watch([projectId, releaseId, project, moduleEnabled], refresh, { immediate: true })
</script>

<template>
  <section class="space-y-5">
    <UButton :to="moduleUrl(`/projects/${projectId}/releases`)" variant="link" color="neutral" icon="i-lucide-arrow-left">返回项目版本</UButton>
    <div>
      <h1 class="text-2xl font-semibold text-highlighted">{{ item?.name || item?.version_code || '版本摘要' }}</h1>
      <p class="mt-1 text-sm text-muted">版本摘要；特性、关联工作项与日志待项目版本详情接口接入。</p>
    </div>
    <UAlert v-if="error" color="error" title="无法读取版本摘要" :description="error" />
    <USkeleton v-else-if="!project || loading" class="h-48 w-full" />
    <UAlert v-else-if="!moduleEnabled" color="neutral" title="版本模块未启用" description="当前项目未启用产品版本模块。" />
    <UCard v-else-if="item">
      <dl class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <div><dt class="text-sm text-muted">产品</dt><dd>{{ item.product_name || item.product_code || '-' }}</dd></div>
        <div><dt class="text-sm text-muted">版本号</dt><dd>{{ item.version_code || '-' }}</dd></div>
        <div><dt class="text-sm text-muted">状态</dt><dd><UBadge :color="releaseStatusBadge(item.status).color" variant="soft">{{ releaseStatusBadge(item.status).label }}</UBadge></dd></div>
        <div><dt class="text-sm text-muted">计划发布日期</dt><dd>{{ item.planned_release_date || '-' }}</dd></div>
        <div><dt class="text-sm text-muted">实际发布日期</dt><dd>{{ item.released_at || '-' }}</dd></div>
        <div><dt class="text-sm text-muted">完成进度</dt><dd>{{ item.progress_percent ?? 0 }}%</dd></div>
        <div><dt class="text-sm text-muted">已完成目标</dt><dd>{{ item.completed_count ?? 0 }} / {{ item.target_count ?? 0 }}</dd></div>
        <div><dt class="text-sm text-muted">已交付特性</dt><dd>{{ item.delivered_feature_count ?? 0 }} / {{ item.feature_count ?? 0 }}</dd></div>
      </dl>
      <p v-if="item.description" class="mt-6 whitespace-pre-wrap text-sm">{{ item.description }}</p>
    </UCard>
  </section>
</template>
