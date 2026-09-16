<script setup lang="ts">
import WebTerminal, { type TerminalLine } from '~/components/webdev/WebTerminal.vue'

type EnvCell = {
  v: string
  t: string
  s: 'ok' | 'warn'
  deploying?: boolean
} | null

type DeployRow = {
  m: string
  preview: EnvCell
  staging: EnvCell
  prod: EnvCell
}

usePageTitle('部署中心')

const toast = useToast()
const { setRefresh, clearRefresh } = usePageActions()

// 示例数据 — 部署矩阵与历史，后端补齐后替换
const rows: DeployRow[] = [
  { m: 'finance', preview: { v: 'v2.4.2-rc.1', t: '10 分钟前', s: 'ok' }, staging: { v: 'v2.4.1', t: '昨天', s: 'ok', deploying: true }, prod: { v: 'v2.4.0', t: '3 天前', s: 'ok' } },
  { m: 'workflow', preview: { v: 'v1.9.0-rc.3', t: '1 小时前', s: 'ok' }, staging: { v: 'v1.8.2', t: '2 天前', s: 'ok' }, prod: { v: 'v1.8.2', t: '2 天前', s: 'ok' } },
  { m: 'codocs', preview: { v: 'v2.8.4-rc.1', t: '32 分钟前', s: 'ok' }, staging: { v: 'v2.8.3', t: '5 天前', s: 'ok' }, prod: { v: 'v2.8.3', t: '5 天前', s: 'warn' } },
  { m: 'console', preview: { v: 'v3.1.0-rc.2', t: '昨天', s: 'ok' }, staging: { v: 'v3.0.4', t: '上周', s: 'ok' }, prod: { v: 'v3.0.4', t: '上周', s: 'ok' } }
]

const recentDeploys = [
  { m: 'workflow', tgt: 'staging', v: 'v1.8.2', t: '昨天 18:40', ok: true, by: 'Agent · #1839' },
  { m: 'codocs', tgt: 'production', v: 'v2.8.3', t: '5 天前', ok: true, by: 'Gavin 确认' },
  { m: 'finance', tgt: 'preview', v: 'v2.4.2-rc.1', t: '10 分钟前', ok: true, by: 'Agent · #1843' },
  { m: 'aims', tgt: 'staging', v: 'v1.5.0', t: '上周', ok: false, by: '构建失败 · 已回滚' }
]

const deployLines: TerminalLine[] = [
  { t: 'cmd', s: 'pnpm run deploy:cloudflare' },
  { t: 'out', s: 'nuxt build --dotenv .env  ✓ 2m 41s' },
  { t: 'out', s: 'wrangler deploy --name hzy-finance' },
  { t: 'info', s: 'Uploading… (4.2 MB / 5.1 MB)' },
  { t: 'dim', s: 'route: wiztek.huizhi.yun/finance/*' }
]

const progressSteps: Array<{ label: string, state: 'done' | 'run' | 'todo' }> = [
  { label: '构建', state: 'done' },
  { label: '上传 Worker', state: 'run' },
  { label: '冒烟验证', state: 'todo' }
]

const prodModule = ref<string | null>(null)
const confirmInput = ref('')
const confirmOk = computed(() => confirmInput.value.trim() === prodModule.value)

const prodDiffCommits = [
  'fix(finance): 报销单导出金额 null 处理 (#1843)',
  'feat(finance): 导出增加部门汇总 sheet (#1838)',
  'chore(finance): 升级 exceljs 至 4.4.1'
]

function cellDotClass(cell: EnvCell) {
  if (!cell) return 'bg-zinc-300'
  if (cell.deploying) return 'bg-info'
  return cell.s === 'ok' ? 'bg-success' : 'bg-warning'
}

function triggerPreview(module: string) {
  toast.add({ title: `${module} → preview 已触发`, description: '在 gavin-mac 上执行 deploy:cloudflare', color: 'info', icon: 'i-lucide-rocket' })
}

function openProd(module: string) {
  prodModule.value = module
  confirmInput.value = ''
}

function confirmProd() {
  if (!confirmOk.value || !prodModule.value) return
  toast.add({ title: `${prodModule.value} 生产部署已开始`, description: '在 gavin-mac 上执行 · 已写入审计日志', color: 'warning', icon: 'i-lucide-rocket' })
  prodModule.value = null
}

const progressStateColor: Record<string, string> = {
  done: 'text-success',
  run: 'text-info',
  todo: 'text-muted'
}

const progressStateIcon: Record<string, string> = {
  done: 'i-lucide-circle-check',
  run: 'i-lucide-loader-circle',
  todo: 'i-lucide-circle'
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
    id="webdev-deploy"
    class="h-full min-h-0 flex-1"
    :ui="{ body: 'min-h-0 overflow-auto p-0 sm:p-0 gap-0 sm:gap-0' }"
  >
    <template #body>
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 class="text-xl font-semibold">
              部署中心
            </h1>
            <p class="mt-1 text-sm text-muted">
              各模块 Preview / Staging / Production 环境矩阵；生产部署需 type-to-confirm。
            </p>
          </div>
          <UButton
            to="/history"
            icon="i-lucide-history"
            color="neutral"
            variant="outline"
          >
            部署记录
          </UButton>
        </div>

        <UAlert
          color="info"
          variant="soft"
          icon="i-lucide-info"
          title="示例数据"
          description="部署矩阵与记录后端尚未接入，以下为原型示意；生产确认弹窗交互可体验。"
        />

        <!-- 环境矩阵 -->
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-layers" class="size-4 text-muted" />
              <span class="text-sm font-semibold">环境矩阵 · huizhi-yun</span>
            </div>
          </template>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead>
                <tr class="border-b border-default bg-elevated/40 text-[10px] font-bold uppercase tracking-wide text-muted">
                  <th class="px-4 py-2">
                    模块
                  </th>
                  <th class="px-4 py-2">
                    Preview
                  </th>
                  <th class="px-4 py-2">
                    Staging
                  </th>
                  <th class="px-4 py-2">
                    Production
                  </th>
                  <th class="px-4 py-2 text-right" />
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in rows"
                  :key="row.m"
                  class="border-b border-default/60"
                >
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-2">
                      <UIcon name="i-lucide-box" class="size-3.5 text-muted" />
                      <span class="font-mono font-bold">{{ row.m }}</span>
                    </div>
                  </td>
                  <td class="px-4 py-3">
                    <div v-if="row.preview" class="flex flex-col gap-1">
                      <div class="flex items-center gap-1.5">
                        <span class="size-1.5 rounded-full" :class="cellDotClass(row.preview)" />
                        <span class="font-mono font-bold">{{ row.preview.v }}</span>
                      </div>
                      <span class="text-[10px] text-muted">{{ row.preview.t }}</span>
                    </div>
                  </td>
                  <td class="px-4 py-3">
                    <div v-if="row.staging" class="flex flex-col gap-1">
                      <div class="flex items-center gap-1.5">
                        <span class="size-1.5 rounded-full" :class="cellDotClass(row.staging)" />
                        <span class="font-mono font-bold">{{ row.staging.v }}</span>
                        <UBadge
                          v-if="row.staging.deploying"
                          color="info"
                          variant="soft"
                          size="sm"
                          class="gap-1"
                        >
                          <UIcon name="i-lucide-loader-circle" class="size-3 animate-spin" />部署中
                        </UBadge>
                      </div>
                      <span class="text-[10px] text-muted">{{ row.staging.t }}</span>
                    </div>
                  </td>
                  <td
                    class="cursor-pointer px-4 py-3 transition-colors hover:bg-elevated/40"
                    @click="openProd(row.m)"
                  >
                    <div v-if="row.prod" class="flex flex-col gap-1">
                      <div class="flex items-center gap-1.5">
                        <span class="size-1.5 rounded-full" :class="cellDotClass(row.prod)" />
                        <span class="font-mono font-bold">{{ row.prod.v }}</span>
                        <UIcon name="i-lucide-lock-keyhole" class="size-3 text-muted" />
                      </div>
                      <span class="text-[10px] text-muted">{{ row.prod.t }}</span>
                    </div>
                  </td>
                  <td class="px-4 py-3 text-right">
                    <UButton
                      icon="i-lucide-rocket"
                      color="neutral"
                      variant="outline"
                      size="xs"
                      @click="triggerPreview(row.m)"
                    >
                      部署
                    </UButton>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>

        <div class="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <!-- 进行中 -->
          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-rocket" class="size-4 text-muted" />
                <span class="text-sm font-semibold">进行中 · finance → staging</span>
                <UBadge
                  color="info"
                  variant="soft"
                  size="sm"
                  class="ml-auto gap-1"
                >
                  <UIcon name="i-lucide-loader-circle" class="size-3 animate-spin" />部署中
                </UBadge>
              </div>
            </template>
            <div class="mb-3 flex items-center">
              <template v-for="(step, index) in progressSteps" :key="step.label">
                <span
                  v-if="index > 0"
                  class="mx-2 h-0.5 flex-1"
                  :class="step.state === 'todo' ? 'bg-default' : 'bg-success'"
                />
                <span class="inline-flex items-center gap-1.5 text-[11px] font-medium" :class="progressStateColor[step.state]">
                  <UIcon :name="progressStateIcon[step.state]" class="size-3.5" :class="step.state === 'run' ? 'animate-spin' : ''" />{{ step.label }}
                </span>
              </template>
            </div>
            <WebTerminal title="finance · pnpm run deploy:cloudflare" :lines="deployLines" />
          </UCard>

          <!-- 最近部署 -->
          <UCard :ui="{ body: 'p-0 sm:p-0' }">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-history" class="size-4 text-muted" />
                <span class="text-sm font-semibold">最近部署</span>
              </div>
            </template>
            <div class="divide-y divide-default">
              <div
                v-for="(item, index) in recentDeploys"
                :key="index"
                class="flex items-center gap-2.5 px-4 py-2.5"
              >
                <UIcon
                  :name="item.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
                  class="size-4 shrink-0"
                  :class="item.ok ? 'text-success' : 'text-error'"
                />
                <span class="w-16 shrink-0 font-mono text-[11px] font-bold">{{ item.m }}</span>
                <UBadge :color="item.tgt === 'production' ? 'warning' : 'neutral'" variant="subtle" size="sm">
                  {{ item.tgt }}
                </UBadge>
                <span class="font-mono text-[11px] text-muted">{{ item.v }}</span>
                <div class="ml-auto text-right text-[10px] text-muted">
                  <div>{{ item.by }}</div>
                  <div>{{ item.t }}</div>
                </div>
              </div>
            </div>
          </UCard>
        </div>
      </div>

      <!-- 生产部署确认 -->
      <UModal :open="!!prodModule" title="部署到 Production" @update:open="(value: boolean) => { if (!value) prodModule = null }">
        <template #body>
          <div class="flex flex-col gap-4">
            <div class="flex items-center gap-2.5">
              <span class="flex size-8 items-center justify-center rounded-lg bg-warning/10 text-warning">
                <UIcon name="i-lucide-shield-alert" class="size-4" />
              </span>
              <p class="font-mono text-xs text-muted">
                {{ prodModule }} → wiztek.huizhi.yun/{{ prodModule }}
              </p>
            </div>

            <div>
              <div class="mb-1.5 text-[11px] font-bold text-muted">
                与当前生产版本的差异 · {{ prodDiffCommits.length }} 个提交
              </div>
              <div class="flex flex-col gap-1">
                <div
                  v-for="commit in prodDiffCommits"
                  :key="commit"
                  class="flex items-center gap-2 font-mono text-[11px] text-muted"
                >
                  <UIcon name="i-lucide-git-commit-horizontal" class="size-3 shrink-0" />{{ commit }}
                </div>
              </div>
            </div>

            <div class="flex flex-wrap gap-1.5">
              <UBadge
                color="success"
                variant="soft"
                size="sm"
                class="gap-1"
              >
                <UIcon name="i-lucide-circle-check" class="size-3" />typecheck 12s
              </UBadge>
              <UBadge
                color="success"
                variant="soft"
                size="sm"
                class="gap-1"
              >
                <UIcon name="i-lucide-circle-check" class="size-3" />test 34 ✓ 41s
              </UBadge>
              <UBadge
                color="success"
                variant="soft"
                size="sm"
                class="gap-1"
              >
                <UIcon name="i-lucide-circle-check" class="size-3" />staging 验证 2 天
              </UBadge>
            </div>

            <UFormField>
              <template #label>
                <span class="text-[11px]">输入模块名 <code class="rounded bg-elevated px-1.5 py-0.5 font-mono">{{ prodModule }}</code> 以确认</span>
              </template>
              <UInput
                v-model="confirmInput"
                :placeholder="prodModule || ''"
                autofocus
                class="w-full font-mono"
                :color="confirmOk ? 'success' : undefined"
              />
            </UFormField>
          </div>
        </template>
        <template #footer>
          <div class="flex w-full items-center gap-2">
            <span class="inline-flex items-center gap-1.5 text-[10px] text-muted">
              <UIcon name="i-lucide-scroll-text" class="size-3" />操作将写入审计日志
            </span>
            <UButton
              class="ml-auto"
              color="neutral"
              variant="ghost"
              @click="prodModule = null"
            >
              取消
            </UButton>
            <UButton
              color="error"
              icon="i-lucide-rocket"
              :disabled="!confirmOk"
              @click="confirmProd"
            >
              确认部署
            </UButton>
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
