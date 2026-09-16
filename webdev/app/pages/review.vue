<script setup lang="ts">
type DiffFile = {
  f: string
  a: number
  d: number
  badge?: string
}

type DiffLine = {
  t: 'add' | 'del' | 'hunk' | 'ctx'
  o?: number
  n?: number
  s: string
}

usePageTitle('Diff 审查')

const toast = useToast()
const router = useRouter()
const { setRefresh, clearRefresh } = usePageActions()

// 示例数据 — Diff 审查依赖任务产出的结构化 diff，后端补齐后替换
const files: DiffFile[] = [
  { f: 'server/api/notify/timeout.ts', a: 46, d: 0, badge: '新增' },
  { f: 'server/utils/scheduler.ts', a: 18, d: 9 },
  { f: 'app/pages/approval/detail.vue', a: 12, d: 8 },
  { f: 'app/composables/useApproval.ts', a: 6, d: 4 },
  { f: 'docs/WORKFLOW_API_SPEC.md', a: 4, d: 3 }
]

const selectedFile = ref(0)

const diffLines: DiffLine[] = [
  { t: 'hunk', s: '@@ -0,0 +1,46 @@ server/api/notify/timeout.ts' },
  { t: 'add', n: 1, s: 'import { defineEventHandler } from \'h3\'' },
  { t: 'add', n: 2, s: 'import { listOverdueApprovals } from \'../../utils/scheduler\'' },
  { t: 'add', n: 3, s: 'import { sendDingTalkCard } from \'@hzy/foundation/notify\'' },
  { t: 'add', n: 4, s: '' },
  { t: 'add', n: 5, s: 'const TIMEOUT_HOURS = 24' },
  { t: 'add', n: 6, s: '' },
  { t: 'add', n: 7, s: 'export default defineEventHandler(async () => {' },
  { t: 'add', n: 8, s: '  const overdue = await listOverdueApprovals(TIMEOUT_HOURS)' },
  { t: 'add', n: 9, s: '  for (const item of overdue) {' },
  { t: 'add', n: 10, s: '    await sendDingTalkCard({' },
  { t: 'add', n: 11, s: '      uid: item.currentApproverUid,' },
  { t: 'add', n: 12, s: '      template: \'approval-timeout\',' },
  { t: 'add', n: 13, s: '      payload: { title: item.title, hours: item.overdueHours }' },
  { t: 'add', n: 14, s: '    })' },
  { t: 'add', n: 15, s: '  }' },
  { t: 'add', n: 16, s: '  return { notified: overdue.length }' },
  { t: 'add', n: 17, s: '})' }
]

const checks = [
  { ok: true, label: 'typecheck', time: '12s' },
  { ok: true, label: 'eslint', time: '8s' },
  { ok: true, label: 'test 34 ✓', time: '41s' }
]

const totalAdd = computed(() => files.reduce((sum, file) => sum + file.a, 0))
const totalDel = computed(() => files.reduce((sum, file) => sum + file.d, 0))
const currentFile = computed<DiffFile>(() => files[selectedFile.value] || files[0]!)

function diffRowClass(type: DiffLine['t']) {
  if (type === 'add') return 'bg-success/10'
  if (type === 'del') return 'bg-error/10'
  if (type === 'hunk') return 'bg-info/10'
  return ''
}

function diffSignClass(type: DiffLine['t']) {
  if (type === 'add') return 'text-success'
  if (type === 'del') return 'text-error'
  return 'text-muted'
}

function diffTextClass(type: DiffLine['t']) {
  if (type === 'hunk') return 'text-info'
  return 'text-default'
}

function approve() {
  toast.add({ title: '已提交并创建 GitLab MR', description: 'workflow · MR !41x · 合并后自动部署 staging', color: 'success', icon: 'i-lucide-git-merge' })
  router.push('/history')
}

function reject() {
  toast.add({ title: '已打回，回到对话', description: '可继续向 Agent 说明修改要求', color: 'info', icon: 'i-lucide-message-square-reply' })
  router.push('/')
}

onMounted(() => {
  setRefresh(() => {})
})

onBeforeUnmount(() => {
  clearRefresh()
})
</script>

<template>
  <UDashboardPanel
    id="webdev-review"
    class="h-full min-h-0 flex-1"
    :ui="{ body: 'min-h-0 overflow-hidden p-0 sm:p-0 gap-0 sm:gap-0' }"
  >
    <template #header>
      <UDashboardNavbar title="Diff 审查">
        <template #right>
          <UBadge color="neutral" variant="subtle" class="font-mono">
            webdev/1842-approval-timeout
          </UBadge>
          <span class="font-mono text-xs text-muted">
            {{ files.length }} 文件 ·
            <span class="font-bold text-success">+{{ totalAdd }}</span>
            <span class="font-bold text-error">−{{ totalDel }}</span>
          </span>
          <UButton
            icon="i-lucide-message-square-reply"
            color="neutral"
            variant="outline"
            size="sm"
            @click="reject"
          >
            打回
          </UButton>
          <UButton
            icon="i-lucide-git-commit-horizontal"
            color="primary"
            size="sm"
            @click="approve"
          >
            批准并提交
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex h-full min-h-0">
        <!-- 文件树 -->
        <aside class="flex w-72 shrink-0 flex-col border-r border-default">
          <div class="px-3 pb-2 pt-3 text-[10px] font-bold uppercase tracking-wider text-muted">
            变更文件 · WORKFLOW
          </div>
          <div class="min-h-0 flex-1 space-y-0.5 overflow-auto px-2">
            <button
              v-for="(file, index) in files"
              :key="file.f"
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors"
              :class="index === selectedFile ? 'bg-primary/5' : 'hover:bg-elevated/40'"
              @click="selectedFile = index"
            >
              <UIcon name="i-lucide-file-code-2" class="size-3.5 shrink-0" :class="index === selectedFile ? 'text-primary' : 'text-muted'" />
              <span class="flex-1 truncate font-mono text-[11px]" :class="index === selectedFile ? 'font-bold text-primary' : 'text-muted'">{{ file.f }}</span>
              <UBadge
                v-if="file.badge"
                color="success"
                variant="soft"
                size="sm"
              >
                {{ file.badge }}
              </UBadge>
            </button>
          </div>
          <div class="border-t border-default p-3">
            <div class="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">
              检查结果
            </div>
            <div class="flex flex-wrap gap-1.5">
              <UBadge
                v-for="check in checks"
                :key="check.label"
                :color="check.ok ? 'success' : 'error'"
                variant="soft"
                size="sm"
                class="gap-1"
              >
                <UIcon :name="check.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-x'" class="size-3" />
                {{ check.label }}
                <span class="font-mono font-normal opacity-70">{{ check.time }}</span>
              </UBadge>
            </div>
          </div>
        </aside>

        <!-- Diff 区 -->
        <div class="flex min-w-0 flex-1 flex-col gap-3 overflow-auto p-4">
          <UAlert
            color="info"
            variant="soft"
            icon="i-lucide-info"
            title="示例数据"
            description="此处展示任务产出的代码变更、检查结果与规范化提交，结构化 diff 后端补齐后将自动填充。"
          />

          <div class="overflow-hidden rounded-xl border border-default">
            <div class="flex items-center gap-2 border-b border-default bg-elevated/40 px-3 py-2">
              <UIcon name="i-lucide-file-code-2" class="size-3.5 text-success" />
              <span class="font-mono text-[11px] font-bold">{{ currentFile.f }}</span>
              <span class="font-mono text-[11px] font-bold text-success">+{{ currentFile.a }}</span>
              <span v-if="currentFile.d" class="font-mono text-[11px] font-bold text-error">−{{ currentFile.d }}</span>
              <div class="ml-auto flex gap-2 text-muted">
                <UIcon name="i-lucide-columns-2" class="size-3.5" />
                <UIcon name="i-lucide-message-square-plus" class="size-3.5" />
              </div>
            </div>
            <div class="font-mono text-[11.5px] leading-5">
              <div
                v-for="(line, index) in diffLines"
                :key="index"
                class="flex"
                :class="diffRowClass(line.t)"
              >
                <span class="w-10 shrink-0 select-none px-2 text-right text-[10px] text-muted">{{ line.o || '' }}</span>
                <span class="w-10 shrink-0 select-none px-2 text-right text-[10px] text-muted">{{ line.n || '' }}</span>
                <span class="w-4 shrink-0 text-center font-bold" :class="diffSignClass(line.t)">
                  {{ line.t === 'add' ? '+' : line.t === 'del' ? '−' : '' }}
                </span>
                <span class="whitespace-pre" :class="diffTextClass(line.t)">{{ line.s }}</span>
              </div>
            </div>
          </div>

          <!-- 提交卡 -->
          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-git-commit-horizontal" class="size-4 text-muted" />
                <span class="text-sm font-semibold">提交并推送</span>
              </div>
            </template>
            <div class="flex flex-col gap-4 lg:flex-row">
              <div class="flex-1 space-y-2">
                <div class="flex flex-wrap items-center gap-2">
                  <UBadge color="primary" variant="soft" class="gap-1 font-mono">
                    <UIcon name="i-lucide-tag" class="size-3" />feat
                  </UBadge>
                  <UBadge color="neutral" variant="soft" class="gap-1 font-mono">
                    <UIcon name="i-lucide-folder" class="size-3" />workflow
                  </UBadge>
                  <span class="text-[11px] text-muted">遵循《Git提交规范指南》自动生成，可编辑</span>
                </div>
                <UInput
                  model-value="feat(workflow): 审批超时 24h 自动发送钉钉提醒"
                  class="w-full font-mono"
                />
              </div>
              <div class="flex w-full shrink-0 flex-col gap-2 lg:w-72">
                <UCheckbox model-value :label="'推送并创建 GitLab MR → main'" />
                <UCheckbox :model-value="false" label="合并后自动部署 staging" />
              </div>
            </div>
            <template #footer>
              <div class="flex justify-end gap-2">
                <UButton
                  icon="i-lucide-message-square-reply"
                  color="neutral"
                  variant="outline"
                  @click="reject"
                >
                  打回并继续对话
                </UButton>
                <UButton icon="i-lucide-git-commit-horizontal" color="primary" @click="approve">
                  批准并提交
                </UButton>
              </div>
            </template>
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
