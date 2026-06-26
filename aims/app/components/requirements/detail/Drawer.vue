<script setup lang="ts">
const props = defineProps<{
  reqId: number
}>()

const emit = defineEmits<{
  close: []
  updated: []
}>()

const toast = useToast()
const activeTab = ref('detail')
const loading = ref(true)
const saving = ref(false)

interface RequirementDetail {
  id: number
  projectId: number
  reqNumber: number
  reqCode: string
  title: string
  type: string
  category: string | null
  priority: string
  source: string
  milestoneId: number | null
  milestoneName: string | null
  status: string
  currentVersion: number
  baselinedAt: string | null
  createdBy: string
  createdAt: string
  updatedBy: string | null
  updatedAt: string
  contents: { id: number, title: string, headingDepth: number, sortOrder: number, status: string }[]
  tasks: { id: number, itemKey: string, title: string, status: string, assigneeUid: string | null, type: string, changeRequestOf: number | null }[]
  versions: { id: number, versionNo: number, changeType: string, changeReason: string | null, approvedBy: string | null, approvedAt: string | null, createdBy: string, createdAt: string }[]
}

const req = ref<RequirementDetail | null>(null)

async function fetchDetail() {
  loading.value = true
  try {
    const res = await $fetch<{ code: number, data: RequirementDetail }>(
      `/api/v1/requirements/${props.reqId}`
    )
    if (res.code === 0) {
      req.value = res.data
    }
  } finally {
    loading.value = false
  }
}

onMounted(fetchDetail)

const statusLabel: Record<string, string> = {
  draft: '草稿',
  in_review: '评审中',
  baselined: '已基线',
  change_pending: '变更中',
  deprecated: '已废弃'
}

const statusColor: Record<string, string> = {
  draft: 'neutral',
  in_review: 'warning',
  baselined: 'success',
  change_pending: 'info',
  deprecated: 'error'
}

const isEditable = computed(() => req.value?.status === 'draft' || req.value?.status === 'baselined')

const latestVersionSnapshot = ref<{ title: string, type: string, priority: string, source: string, milestone_id: number | null } | null>(null)

const latestSnapshot = computed(() => latestVersionSnapshot.value)

async function fetchLatestSnapshot() {
  if (!req.value?.currentVersion || req.value.currentVersion === 0) return
  try {
    const res = await $fetch<{ code: number, data: Array<{ snapshot: Record<string, unknown> }> }>(
      `/api/v1/requirements/${props.reqId}/versions`
    )
    if (res.code === 0 && res.data.length > 0) {
      const snap = res.data[0]?.snapshot
      if (snap) {
        latestVersionSnapshot.value = {
          title: String(snap.title || ''),
          type: String(snap.type || 'functional'),
          priority: String(snap.priority || 'P2'),
          source: String(snap.source || 'internal'),
          milestone_id: snap.milestone_id as number | null
        }
      }
    }
  } catch {
    // silent
  }
}

watch(() => req.value?.status, (status) => {
  if (status === 'change_pending') fetchLatestSnapshot()
})

const editForm = reactive({
  title: '',
  priority: '',
  source: ''
})

const showEditMode = ref(false)

function startEdit() {
  if (!req.value) return
  editForm.title = req.value.title
  editForm.priority = req.value.priority
  editForm.source = req.value.source
  showEditMode.value = true
}

async function saveEdit() {
  saving.value = true
  try {
    await $fetch(`/api/v1/requirements/${props.reqId}`, {
      method: 'PATCH',
      body: {
        title: editForm.title,
        priority: editForm.priority,
        source: editForm.source
      }
    })
    toast.add({ title: '更新成功', color: 'success' })
    showEditMode.value = false
    await fetchDetail()
    emit('updated')
  } catch {
    toast.add({ title: '更新失败', color: 'error' })
  } finally {
    saving.value = false
  }
}

async function handleCreateTask() {
  if (!req.value) return
  try {
    const res = await $fetch<{ code: number, data: { itemKey: string } }>(
      `/api/v1/requirements/${props.reqId}/create-task`,
      { method: 'POST', body: { milestoneId: req.value.milestoneId } }
    )
    if (res.code === 0) {
      toast.add({ title: `已创建任务 ${res.data.itemKey}`, color: 'success' })
      await fetchDetail()
      emit('updated')
    }
  } catch {
    toast.add({ title: '创建任务失败', color: 'error' })
  }
}
</script>

<template>
  <USlideover
    :open="true"
    :ui="{ content: 'sm:max-w-xl' }"
    @update:open="(v: boolean) => !v && emit('close')"
  >
    <template #header>
      <div class="flex items-center justify-between w-full">
        <div class="flex items-center gap-2">
          <span
            v-if="req"
            class="font-mono text-sm text-muted"
          >{{ req.reqCode }}</span>
          <span class="font-semibold">{{ req?.title || '加载中...' }}</span>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="emit('close')"
        />
      </div>
    </template>

    <template #body>
      <div
        v-if="loading"
        class="flex justify-center py-12"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="w-6 h-6 animate-spin text-muted"
        />
      </div>

      <template v-else-if="req">
        <!-- Status bar -->
        <div class="flex items-center gap-3 mb-4">
          <UBadge
            :color="(statusColor[req.status] as any)"
            variant="subtle"
          >
            {{ statusLabel[req.status] || req.status }}
          </UBadge>
          <span class="text-xs text-muted">
            {{ req.type === 'functional' ? '功能需求' : '非功能需求' }}
          </span>
          <UBadge
            color="neutral"
            variant="outline"
            size="xs"
          >
            {{ req.priority }}
          </UBadge>
          <span
            v-if="req.currentVersion > 0"
            class="text-xs text-muted"
          >
            v{{ req.currentVersion }}
          </span>
        </div>

        <!-- Tabs -->
        <div class="flex gap-1 mb-4 border-b border-default">
          <button
            v-for="tab in ['detail', 'contents', 'tasks', 'versions']"
            :key="tab"
            class="px-3 py-1.5 text-xs font-medium border-b-2 transition-colors"
            :class="activeTab === tab ? 'text-primary border-primary' : 'text-muted border-transparent hover:text-default'"
            @click="activeTab = tab"
          >
            {{ { detail: '详情', contents: '关联章节', tasks: '关联任务', versions: '版本历史' }[tab] }}
          </button>
        </div>

        <!-- Change Summary (when change_pending) -->
        <div
          v-if="req.status === 'change_pending' && latestSnapshot"
          class="mb-4"
        >
          <RequirementsChangeChangeSummaryPanel
            :current="{
              title: req.title,
              type: req.type,
              priority: req.priority,
              source: req.source,
              milestoneId: req.milestoneId,
              milestoneName: req.milestoneName
            }"
            :previous-snapshot="latestSnapshot"
          />
        </div>

        <!-- Detail Tab -->
        <div v-if="activeTab === 'detail'">
          <template v-if="showEditMode">
            <div class="space-y-3">
              <UFormField label="标题">
                <UInput
                  v-model="editForm.title"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="优先级">
                <USelect
                  v-model="editForm.priority"
                  :items="[{ label: 'P0', value: 'P0' }, { label: 'P1', value: 'P1' }, { label: 'P2', value: 'P2' }, { label: 'P3', value: 'P3' }]"
                  class="w-32"
                />
              </UFormField>
              <UFormField label="来源">
                <USelect
                  v-model="editForm.source"
                  :items="[{ label: '客户', value: 'customer' }, { label: '内部', value: 'internal' }, { label: '合规', value: 'compliance' }, { label: '法规', value: 'regulation' }, { label: '其他', value: 'other' }]"
                  class="w-32"
                />
              </UFormField>
              <div class="flex gap-2">
                <UButton
                  label="保存"
                  color="primary"
                  size="sm"
                  :loading="saving"
                  @click="saveEdit"
                />
                <UButton
                  label="取消"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  @click="showEditMode = false"
                />
              </div>
            </div>
          </template>
          <template v-else>
            <div class="space-y-3 text-sm">
              <div class="flex justify-between">
                <span class="text-muted">来源</span>
                <span>{{ { customer: '客户', internal: '内部', compliance: '合规', regulation: '法规', other: '其他' }[req.source] || req.source }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted">里程碑</span>
                <span>{{ req.milestoneName || '-' }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted">首次基线</span>
                <span>{{ req.baselinedAt ? req.baselinedAt.slice(0, 10) : '-' }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted">创建人</span>
                <span>{{ req.createdBy }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-muted">创建时间</span>
                <span>{{ req.createdAt?.slice(0, 16) }}</span>
              </div>
            </div>

            <div class="flex gap-2 mt-6">
              <UButton
                v-if="isEditable"
                icon=""
                label="编辑"
                color="neutral"
                variant="soft"
                size="sm"
                @click="startEdit"
              />
              <UButton
                v-if="req.status === 'baselined' && req.tasks.length === 0"
                icon="i-lucide-plus"
                label="创建任务"
                color="primary"
                variant="soft"
                size="sm"
                @click="handleCreateTask"
              />
            </div>
          </template>
        </div>

        <!-- Contents Tab -->
        <div v-if="activeTab === 'contents'">
          <div
            v-if="req.contents.length === 0"
            class="text-center text-muted py-8"
          >
            未关联章节
          </div>
          <div
            v-else
            class="space-y-2"
          >
            <div
              v-for="c in req.contents"
              :key="c.id"
              class="flex items-center gap-2 p-2 rounded-md border border-default"
            >
              <UIcon
                name="i-lucide-file-text"
                class="size-4 text-muted"
              />
              <span class="text-sm">{{ c.title }}</span>
              <UBadge
                v-if="c.status === 'modified'"
                color="warning"
                variant="subtle"
                size="xs"
              >
                已修改
              </UBadge>
            </div>
          </div>
        </div>

        <!-- Tasks Tab -->
        <div v-if="activeTab === 'tasks'">
          <div
            v-if="req.tasks.length === 0"
            class="text-center text-muted py-8"
          >
            未关联任务
          </div>
          <div
            v-else
            class="space-y-2"
          >
            <div
              v-for="t in req.tasks"
              :key="t.id"
              class="flex items-center justify-between p-2 rounded-md border border-default"
            >
              <div class="flex items-center gap-2">
                <span class="font-mono text-xs text-muted">{{ t.itemKey }}</span>
                <span class="text-sm">{{ t.title }}</span>
                <UBadge
                  v-if="t.type === 'change_request'"
                  color="warning"
                  variant="subtle"
                  size="xs"
                >
                  变��
                </UBadge>
              </div>
              <UBadge
                color="neutral"
                variant="outline"
                size="xs"
              >
                {{ t.status }}
              </UBadge>
            </div>
          </div>
        </div>

        <!-- Versions Tab -->
        <div v-if="activeTab === 'versions'">
          <div
            v-if="req.versions.length === 0"
            class="text-center text-muted py-8"
          >
            尚无版本记录
          </div>
          <div
            v-else
            class="space-y-3"
          >
            <div
              v-for="v in req.versions"
              :key="v.id"
              class="relative pl-6 pb-3 border-l-2 border-default"
            >
              <div class="absolute -left-1.5 top-0 size-3 rounded-full bg-primary" />
              <div class="flex items-center gap-2 text-sm">
                <span class="font-semibold">v{{ v.versionNo }}</span>
                <UBadge
                  color="neutral"
                  variant="subtle"
                  size="xs"
                >
                  {{ { baseline: '基线', add: '新增', modify: '修改', delete: '删除', restore: '恢复' }[v.changeType] || v.changeType }}
                </UBadge>
                <span class="text-xs text-muted">{{ v.createdAt?.slice(0, 16) }}</span>
              </div>
              <p
                v-if="v.changeReason"
                class="text-xs text-muted mt-1"
              >
                {{ v.changeReason }}
              </p>
              <p
                v-if="v.approvedBy"
                class="text-xs text-muted mt-0.5"
              >
                审批: {{ v.approvedBy }} · {{ v.approvedAt?.slice(0, 16) }}
              </p>
            </div>
          </div>
        </div>
      </template>
    </template>
  </USlideover>
</template>
