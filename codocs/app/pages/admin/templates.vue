<script setup lang="ts">
import type { ReviewTemplateInput, ApprovalNodeData } from '~/components/workflow/WorkflowEditor.vue'

definePageMeta({
  layout: 'default'
})

// ---------- 类型 ----------

interface ReviewTemplate {
  id: number
  name: string
  review_type: string
  sub_type?: string | null
  target_category: string
  nodes: ApprovalNodeData[]
  status: number
  created_by: string
  created_at: string
  updated_at: string
}

// ---------- 数据加载 ----------

const { data: templatesResp, refresh, pending } = await useFetch<{ code: number, data: ReviewTemplate[] }>(
  '/api/reviews/templates'
)

const templates = computed<ReviewTemplate[]>(() => {
  const list = templatesResp.value?.data ?? []
  return list.map(t => ({
    ...t,
    nodes: typeof t.nodes === 'string' ? JSON.parse(t.nodes) : t.nodes
  }))
})

// ---------- 编辑器状态 ----------

const editorOpen = ref(false)
const editingTemplate = ref<ReviewTemplateInput | null>(null)
const saving = ref(false)

function openCreate() {
  editingTemplate.value = null
  editorOpen.value = true
}

function openEdit(t: ReviewTemplate) {
  editingTemplate.value = { ...t }
  editorOpen.value = true
}

// ---------- 保存 ----------

usePageTitle('审批模板管理')

const toast = useToast()

async function handleSave(data: Omit<ReviewTemplateInput, 'id'>) {
  saving.value = true
  try {
    if (editingTemplate.value?.id) {
      await $fetch(`/api/reviews/templates/${editingTemplate.value.id}`, {
        method: 'PATCH',
        body: data
      })
      toast.add({ title: '模板已更新', color: 'success' })
    } else {
      await $fetch('/api/reviews/templates', {
        method: 'POST',
        body: data
      })
      toast.add({ title: '模板已创建', color: 'success' })
    }
    editorOpen.value = false
    await refresh()
  } catch (err: unknown) {
    const e = err as { data?: { message?: string } }
    toast.add({ title: '保存失败', description: e.data?.message ?? '请稍后重试', color: 'error' })
  } finally {
    saving.value = false
  }
}

// ---------- 删除 ----------

const deleteConfirm = ref(false)
const deletingId = ref<number | null>(null)
const deleteLoading = ref(false)

function confirmDelete(t: ReviewTemplate) {
  deletingId.value = t.id
  deleteConfirm.value = true
}

async function handleDelete() {
  if (!deletingId.value) return
  deleteLoading.value = true
  try {
    await $fetch(`/api/reviews/templates/${deletingId.value}`, { method: 'DELETE' })
    toast.add({ title: '模板已删除', color: 'success' })
    deleteConfirm.value = false
    await refresh()
  } catch {
    toast.add({ title: '删除失败', color: 'error' })
  } finally {
    deleteLoading.value = false
    deletingId.value = null
  }
}

// ---------- 辅助函数 ----------

type BadgeColor = 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error' | 'neutral'

const REVIEW_TYPE_COLORS: Record<string, BadgeColor> = {
  对外发文: 'primary',
  部门发文: 'info',
  公司发文: 'secondary',
  知识资料: 'success'
}

const TARGET_LABELS: Record<string, string> = {
  company: '公司文档',
  department: '部门文档',
  product: '产品资料',
  knowledge: '公司知识库',
  template: '文档模板'
}

const ROLE_LABELS: Record<string, string> = {
  dept_manager: '部门经理',
  supervisor: '分管领导',
  admin: '管理员'
}

function getTypeColor(t: string): BadgeColor {
  return REVIEW_TYPE_COLORS[t] ?? 'neutral'
}
</script>

<template>
  <UDashboardPanel grow>
    <div class="flex justify-end gap-2 px-4 py-2 border-b border-default">
      <UButton icon="i-lucide-plus" color="primary" @click="openCreate">
        新建模板
      </UButton>
    </div>

    <div class="p-6">
      <!-- 加载中 -->
      <div v-if="pending" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div v-for="i in 3" :key="i" class="h-40 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
      </div>

      <!-- 空状态 -->
      <div v-else-if="templates.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
        <UIcon name="i-lucide-git-branch" class="w-14 h-14 text-gray-300 mb-4" />
        <h3 class="text-base font-medium text-gray-700 dark:text-gray-300">
          暂无审批模板
        </h3>
        <p class="mt-1 text-sm text-muted">
          点击右上角"新建模板"开始配置审批流程
        </p>
        <UButton
          class="mt-4"
          icon="i-lucide-plus"
          color="primary"
          @click="openCreate"
        >
          新建模板
        </UButton>
      </div>

      <!-- 模板卡片列表 -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div
          v-for="t in templates"
          :key="t.id"
          class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-3 hover:shadow-md transition-shadow"
        >
          <!-- 头部 -->
          <div class="flex items-start justify-between gap-2">
            <div class="flex-1 min-w-0">
              <h3 class="font-semibold text-default truncate">
                {{ t.name }}
              </h3>
              <div class="flex items-center gap-2 mt-1 flex-wrap">
                <UBadge :color="getTypeColor(t.review_type)" variant="soft" size="xs">
                  {{ t.review_type }}{{ t.sub_type ? ` · ${t.sub_type}` : '' }}
                </UBadge>
                <UBadge color="neutral" variant="outline" size="xs">
                  {{ TARGET_LABELS[t.target_category] ?? t.target_category }}
                </UBadge>
              </div>
            </div>
            <UBadge
              :color="t.status === 1 ? 'success' : 'neutral'"
              variant="subtle"
              size="xs"
              class="shrink-0"
            >
              {{ t.status === 1 ? '启用' : '禁用' }}
            </UBadge>
          </div>

          <!-- 流程预览 -->
          <div class="flex items-center gap-1 flex-wrap min-h-8">
            <span class="text-xs bg-success-50 dark:bg-success-900/30 text-success-700 dark:text-success-300 border border-success-200 dark:border-success-800 px-2 py-0.5 rounded-full">
              提交
            </span>
            <template v-for="(node, i) in t.nodes" :key="i">
              <UIcon name="i-lucide-chevron-right" class="w-3 h-3 text-gray-300 shrink-0" />
              <span class="text-xs bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-800 px-2 py-0.5 rounded-full whitespace-nowrap">
                {{ node.name }}
                <span class="text-primary-400">（{{ ROLE_LABELS[node.role] ?? node.role }}）</span>
              </span>
            </template>
            <UIcon name="i-lucide-chevron-right" class="w-3 h-3 text-gray-300 shrink-0" />
            <span class="text-xs bg-warning-50 dark:bg-warning-900/30 text-warning-700 dark:text-warning-300 border border-warning-200 dark:border-warning-800 px-2 py-0.5 rounded-full">
              归档
            </span>
          </div>

          <!-- 操作 -->
          <div class="flex items-center justify-between pt-1 border-t border-gray-100 dark:border-gray-800">
            <span class="text-xs text-muted">{{ t.nodes.length }} 个步骤</span>
            <div class="flex gap-2">
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-pencil"
                @click="openEdit(t)"
              >
                编辑
              </UButton>
              <UButton
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-trash-2"
                @click="confirmDelete(t)"
              >
                删除
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 流程编辑器 Modal -->
    <UModal
      v-model:open="editorOpen"
      :ui="{
        content: 'sm:max-w-6xl h-[85vh] flex flex-col'
      }"
    >
      <template #content>
        <div class="flex flex-col h-full">
          <div class="flex items-center justify-between px-6 py-4 border-b border-default shrink-0">
            <h3 class="text-lg font-semibold">
              {{ editingTemplate?.id ? '编辑审批模板' : '新建审批模板' }}
            </h3>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="editorOpen = false"
            />
          </div>
          <div class="flex-1 min-h-0 overflow-hidden">
            <WorkflowEditor
              :template="editingTemplate"
              :saving="saving"
              @save="handleSave"
              @cancel="editorOpen = false"
            />
          </div>
        </div>
      </template>
    </UModal>

    <!-- 删除确认 -->
    <UModal v-model:open="deleteConfirm">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-alert-triangle" class="w-5 h-5 text-error" />
              <h3 class="text-lg font-semibold">
                确认删除
              </h3>
            </div>
          </template>
          <p class="text-muted">
            删除后无法恢复，确定要删除这个审批模板吗？
          </p>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton variant="outline" color="neutral" @click="deleteConfirm = false">
                取消
              </UButton>
              <UButton color="error" :loading="deleteLoading" @click="handleDelete">
                确认删除
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
