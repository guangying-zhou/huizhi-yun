<script setup lang="ts">
import { useAimsModule } from '../useAimsModule'
import { projectCategoryPresentation, projectStatusPresentation } from '../../app/utils/projectOverviewPresentation'

const objectContext = useProvidedEnterpriseProjectObjectContext()
if (!objectContext) throw new Error('企业项目详情缺少 Host 对象上下文')

type Project = Record<string, unknown> & { id: number, name?: string, projectCode?: string, project_code?: string }
const route = useRoute()
const { moduleUrl } = useAimsModule()
const navigationAccess = useEnterpriseNavigationAccess()
const project = objectContext.project as Ref<Project | null>
const { flat: departments } = useAccountDepartments()
const loading = objectContext.loading
const error = objectContext.error
const id = computed(() => String(route.params.id || ''))
const objectModel = objectContext.model
const canEditProject = computed(() => Boolean(objectContext.model.value?.groups.some(group => group.items.some(item => item.path === '/edit'))))
const canCreateWorkItem = objectContext.canCreateWorkItem
const visibleProjectPages = computed(() => new Set(
  navigationAccess.workspaces.value
    .find(workspace => workspace.code === 'aims-project')
    ?.groups.flatMap(group => group.items.map(item => item.id)) || []
))
const canViewTimesheet = computed(() => visibleProjectPages.value.has('aims.project.timesheet'))
const canViewWeeklyReports = computed(() => visibleProjectPages.value.has('aims.project.weekly-reports'))
const status = computed(() => projectStatusPresentation(project.value?.lifecycleStatus ?? project.value?.lifecycle_status))
const category = computed(() => projectCategoryPresentation(project.value?.category))
const departmentName = computed(() => {
  const code = value('deptCode', 'dept_code')
  if (code === '-') return code
  return departments.value.find(department => department.deptCode === code)?.name?.trim() || code
})

function value(...keys: string[]) {
  for (const key of keys) {
    const item = project.value?.[key]
    if (item !== undefined && item !== null && String(item).trim()) return String(item)
  }
  return '-'
}

const refresh = objectContext.refresh
</script>

<template>
  <section class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <UButton
          v-if="canCreateWorkItem"
          :to="moduleUrl(`/projects/${id}/work-items/new`)"
          variant="soft"
          icon="i-lucide-plus"
        >
          创建工作项
        </UButton>
        <UButton
          :to="objectModel?.backTo || moduleUrl('/projects')"
          variant="link"
          color="neutral"
          icon="i-lucide-arrow-left"
        >
          {{ objectModel?.backLabel || '返回项目总览' }}
        </UButton>
        <h1 class="mt-1 text-2xl font-semibold text-highlighted">
          {{ project?.name || '项目详情' }}
        </h1>
        <p class="mt-1 text-sm text-muted">
          {{ value('projectCode', 'project_code') }}
        </p>
      </div>
      <div class="flex gap-2">
        <UButton v-if="canEditProject" :to="moduleUrl(`/projects/${id}/edit`)" icon="i-lucide-pencil">
          编辑基本信息
        </UButton><UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          :loading="loading"
          @click="refresh"
        >
          刷新
        </UButton>
      </div>
    </div>

    <UAlert
      v-if="error"
      color="error"
      icon="i-lucide-circle-alert"
      title="无法读取项目"
      :description="error"
    />
    <USkeleton v-else-if="loading" class="h-64 w-full" />

    <template v-else-if="project">
      <UAlert
        color="info"
        icon="i-lucide-info"
        title="当前迁移范围"
        description="企业工作台已提供项目、工作项、工时、周报、成员、文档与需求的只读访问。"
      />
      <div class="flex flex-wrap gap-2">
        <UButton
          v-if="canViewTimesheet"
          :to="moduleUrl(`/projects/${id}/timesheet`)"
          variant="soft"
          icon="i-lucide-clock"
        >
          查看项目工时
        </UButton>
        <UButton
          v-if="canViewWeeklyReports"
          :to="moduleUrl(`/projects/${id}/weekly-reports`)"
          variant="soft"
          icon="i-lucide-notebook-tabs"
        >
          查看项目周报
        </UButton>
        <UButton :to="moduleUrl(`/projects/${id}/members`)" variant="soft" icon="i-lucide-users">
          查看项目成员
        </UButton>
        <UButton :to="moduleUrl(`/projects/${id}/documents`)" variant="soft" icon="i-lucide-files">
          查看项目文档
        </UButton>
        <UButton :to="moduleUrl(`/projects/${id}/requirements`)" variant="soft" icon="i-lucide-list-checks">
          查看项目需求
        </UButton>
        <UButton :to="moduleUrl(`/projects/${id}/plan`)" variant="soft" icon="i-lucide-milestone">
          查看项目计划
        </UButton>
        <UButton :to="moduleUrl(`/projects/${id}/board`)" variant="soft" icon="i-lucide-columns-3">
          查看项目看板
        </UButton>
      </div>
      <EnterpriseProjectProducts
        v-if="project.category === 'product_dev' && (project.lifecycleStatus ?? project.lifecycle_status) === 'active'"
        :project-id="id"
        :can-edit="canEditProject"
      />
      <UCard>
        <dl class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt class="text-sm text-muted">
              状态
            </dt><dd class="mt-1">
              <UBadge :color="status.color" variant="subtle">
                {{ status.label }}
              </UBadge>
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">
              负责人
            </dt><dd class="mt-1 font-medium">
              {{ value('leaderUid', 'leader_uid') }}
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">
              所属部门
            </dt><dd class="mt-1 font-medium">
              {{ departmentName }}
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">
              项目分类
            </dt><dd class="mt-1">
              <UBadge :color="category.color" variant="subtle">
                {{ category.label }}
              </UBadge>
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">
              开始日期
            </dt><dd class="mt-1 font-medium">
              {{ value('startDate', 'start_date') }}
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">
              结束日期
            </dt><dd class="mt-1 font-medium">
              {{ value('endDate', 'end_date') }}
            </dd>
          </div>
        </dl>
        <p v-if="value('description') !== '-'" class="mt-6 whitespace-pre-wrap text-sm text-default">
          {{ value('description') }}
        </p>
      </UCard>
    </template>
  </section>
</template>
