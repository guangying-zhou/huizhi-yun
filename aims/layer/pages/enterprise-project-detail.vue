<script setup lang="ts">
import { useAimsModule } from '../useAimsModule'

type Project = Record<string, unknown> & { id: number, name?: string, projectCode?: string, project_code?: string }
const route = useRoute()
const { moduleUrl } = useAimsModule()
const project = ref<Project | null>(null)
const loading = ref(true)
const error = ref('')
const id = computed(() => String(route.params.id || ''))

function value(...keys: string[]) {
  for (const key of keys) {
    const item = project.value?.[key]
    if (item !== undefined && item !== null && String(item).trim()) return String(item)
  }
  return '-'
}

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const response = await $fetch<{ code?: number, data?: Project }>(moduleUrl(`/api/v1/projects/${id.value}`))
    if (response.code !== 0 || !response.data) throw Error('项目详情暂不可用')
    project.value = response.data
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '项目详情暂不可用'
  } finally {
    loading.value = false
  }
}

watch(id, refresh)
onMounted(refresh)
</script>

<template>
  <section class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <UButton :to="moduleUrl(`/projects/${id}/work-items/new`)" variant="soft" icon="i-lucide-plus">创建工作项</UButton>
        <UButton :to="moduleUrl('/projects')" variant="link" color="neutral" icon="i-lucide-arrow-left">返回项目总览</UButton>
        <h1 class="mt-1 text-2xl font-semibold text-highlighted">{{ project?.name || '项目详情' }}</h1>
        <p class="mt-1 text-sm text-muted">{{ value('projectCode', 'project_code') }}</p>
      </div>
      <div class="flex gap-2"><UButton :to="moduleUrl(`/projects/${id}/edit`)" icon="i-lucide-pencil">编辑基本信息</UButton><UButton icon="i-lucide-refresh-cw" variant="soft" color="neutral" :loading="loading" @click="refresh">刷新</UButton></div>
    </div>

    <UAlert v-if="error" color="error" icon="i-lucide-circle-alert" title="无法读取项目" :description="error" />
    <USkeleton v-else-if="loading" class="h-64 w-full" />

    <template v-else-if="project">
      <UAlert color="info" icon="i-lucide-info" title="当前迁移范围" description="企业工作台已提供项目、工作项、工时、周报、成员、文档与需求的只读访问。" />
      <div>
        <UButton :to="moduleUrl(`/projects/${id}/timesheet`)" variant="soft" icon="i-lucide-clock">查看项目工时</UButton>
        <UButton class="ml-2" :to="moduleUrl(`/projects/${id}/weekly-reports`)" variant="soft" icon="i-lucide-notebook-tabs">查看项目周报</UButton>
        <UButton class="ml-2" :to="moduleUrl(`/projects/${id}/members`)" variant="soft" icon="i-lucide-users">查看项目成员</UButton>
        <UButton class="ml-2" :to="moduleUrl(`/projects/${id}/documents`)" variant="soft" icon="i-lucide-files">查看项目文档</UButton>
        <UButton class="ml-2" :to="moduleUrl(`/projects/${id}/requirements`)" variant="soft" icon="i-lucide-list-checks">查看项目需求</UButton>
        <UButton class="ml-2" :to="moduleUrl(`/projects/${id}/plan`)" variant="soft" icon="i-lucide-milestone">查看项目计划</UButton>
        <UButton class="ml-2" :to="moduleUrl(`/projects/${id}/board`)" variant="soft" icon="i-lucide-columns-3">查看项目看板</UButton>
      </div>
      <UCard>
        <dl class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div><dt class="text-sm text-muted">状态</dt><dd class="mt-1 font-medium">{{ value('lifecycleStatus', 'lifecycle_status') }}</dd></div>
          <div><dt class="text-sm text-muted">负责人</dt><dd class="mt-1 font-medium">{{ value('leaderUid', 'leader_uid') }}</dd></div>
          <div><dt class="text-sm text-muted">所属部门</dt><dd class="mt-1 font-medium">{{ value('deptCode', 'dept_code') }}</dd></div>
          <div><dt class="text-sm text-muted">项目分类</dt><dd class="mt-1 font-medium">{{ value('category') }}</dd></div>
          <div><dt class="text-sm text-muted">开始日期</dt><dd class="mt-1 font-medium">{{ value('startDate', 'start_date') }}</dd></div>
          <div><dt class="text-sm text-muted">结束日期</dt><dd class="mt-1 font-medium">{{ value('endDate', 'end_date') }}</dd></div>
        </dl>
        <p v-if="value('description') !== '-'" class="mt-6 whitespace-pre-wrap text-sm text-default">{{ value('description') }}</p>
      </UCard>
    </template>
  </section>
</template>
