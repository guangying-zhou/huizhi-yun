<script setup lang="ts">
/**
 * 项目详情嵌入页（审批用）
 *
 * 使用 embed layout（无侧边栏），直接展示项目概览内容。
 * 通过 iframe 被 WorkflowBusinessView 加载。
 */
import type { AimsProject } from '~/types/aims'
// 项目详情嵌入页

definePageMeta({
  layout: 'embed'
})

const route = useRoute()
const projectStore = useProjectStore()
const milestoneStore = useMilestoneStore()
const { users: accountUsers } = useAccountUsers()
const { domains: businessDomains } = useBusinessDomains()
const { flat: deptFlat } = useAccountDepartments()

const projectId = computed(() => Number(route.params.bizId))

// 加载项目数据
const project = ref<AimsProject | null>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    await projectStore.fetchProject(projectId.value)
    project.value = projectStore.currentProject
    // 加载里程碑
    milestoneStore.fetchMilestones(projectId.value).catch(() => {})
  } catch {
    // silent
  } finally {
    loading.value = false
  }
})

const milestones = computed(() => milestoneStore.milestones || [])

// 用户/部门名称解析
function getUserName(uid: string | null | undefined) {
  if (!uid) return '-'
  const user = accountUsers.value.find(u => u.uid === uid)
  return user?.realName?.trim() || uid
}

function getDeptName(code: string | null | undefined) {
  if (!code) return '-'
  const dept = deptFlat.value.find(d => d.deptCode === code)
  return dept?.name || code
}

function getDomainName(code: string | null | undefined) {
  if (!code) return '-'
  const domain = businessDomains.value.find(d => d.domainCode === code)
  return domain?.domainName || code
}

const categoryMap: Record<string, string> = {
  product_dev: '产品研发',
  custom_dev: '定制开发',
  delivery: '交付实施',
  maintenance: '运维保障',
  sales: '销售',
  presales: '售前',
  improvement: '改进',
  compliance: '合规'
}

const statusMap: Record<string, { label: string, color: string }> = {
  draft: { label: '草稿', color: 'neutral' },
  approval_pending: { label: '审批中', color: 'warning' },
  active: { label: '进行中', color: 'success' },
  paused: { label: '已暂停', color: 'info' },
  completed: { label: '已完成', color: 'primary' },
  archived: { label: '已归档', color: 'neutral' }
}
</script>

<template>
  <div class="max-w-4xl mx-auto p-6">
    <!-- Loading -->
    <div v-if="loading" class="flex justify-center py-12">
      <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-dimmed" />
    </div>

    <!-- 项目不存在 -->
    <div v-else-if="!project" class="text-center py-12 text-muted">
      <UIcon name="i-lucide-alert-circle" class="size-12 mb-3" />
      <p>项目不存在</p>
    </div>

    <!-- 项目详情 -->
    <template v-else>
      <!-- 标题 -->
      <div class="mb-6">
        <div class="flex items-center gap-3">
          <h1 class="text-xl font-semibold">
            {{ project.name }}
          </h1>
          <UBadge
            v-if="project.lifecycleStatus && statusMap[project.lifecycleStatus]"
            :color="statusMap[project.lifecycleStatus]!.color as any"
            variant="subtle"
            size="sm"
          >
            {{ statusMap[project.lifecycleStatus]!.label }}
          </UBadge>
        </div>
        <p v-if="project.shortName" class="text-sm text-muted mt-1">
          {{ project.shortName }} · {{ project.projectCode }}
        </p>
      </div>

      <!-- 基本信息 -->
      <div class="grid grid-cols-2 gap-4 mb-6">
        <div class="space-y-3">
          <div>
            <span class="text-xs text-dimmed">项目分类</span>
            <p class="text-sm">
              {{ categoryMap[project.category] || project.category }}
            </p>
          </div>
          <div>
            <span class="text-xs text-dimmed">所属部门</span>
            <p class="text-sm">
              {{ getDeptName(project.deptCode) }}
            </p>
          </div>
          <div>
            <span class="text-xs text-dimmed">业务领域</span>
            <p class="text-sm">
              {{ getDomainName(project.domainCode) }}
            </p>
          </div>
          <div v-if="project.customerName">
            <span class="text-xs text-dimmed">客户</span>
            <p class="text-sm">
              {{ project.customerName }}
            </p>
          </div>
        </div>
        <div class="space-y-3">
          <div>
            <span class="text-xs text-dimmed">项目负责人</span>
            <p class="text-sm">
              {{ getUserName(project.leaderUid) }}
            </p>
          </div>
          <div>
            <span class="text-xs text-dimmed">计划周期</span>
            <p class="text-sm">
              {{ project.startDate || '未设置' }} ~ {{ project.endDate || '未设置' }}
            </p>
          </div>
          <div v-if="project.contractCode">
            <span class="text-xs text-dimmed">合同编号</span>
            <p class="text-sm">
              {{ project.contractCode }}
            </p>
          </div>
        </div>
      </div>

      <!-- 项目描述 -->
      <div v-if="project.description" class="mb-6">
        <h3 class="text-sm font-medium mb-2">
          项目描述
        </h3>
        <div class="text-sm text-muted whitespace-pre-wrap bg-elevated/50 rounded-lg p-4">
          {{ project.description }}
        </div>
      </div>

      <!-- 里程碑 -->
      <div v-if="milestones.length" class="mb-6">
        <h3 class="text-sm font-medium mb-2">
          里程碑
        </h3>
        <div class="space-y-2">
          <div
            v-for="ms in milestones"
            :key="ms.id"
            class="flex items-center gap-3 bg-elevated/50 rounded-lg px-4 py-2.5 text-sm"
          >
            <UIcon name="i-lucide-flag" class="size-4 text-primary shrink-0" />
            <span class="flex-1 font-medium">{{ ms.name }}</span>
            <span class="text-dimmed text-xs">
              {{ ms.endDate || ms.startDate || '未设置' }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
