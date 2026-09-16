<script setup lang="ts">
import WebTerminal, { type TerminalLine } from '~/components/webdev/WebTerminal.vue'

type AgentTemplate = {
  id: string
  type: string
  repoId?: string
  cwd?: string
  runner?: string
  argv?: string
  codexSandboxPolicy?: string
  timeoutSec?: number
}

type AgentEnrollment = {
  agentId: string
  version: string
  endpoint?: string
  repoId?: string
  templates: AgentTemplate[]
}

type AgentHealth = {
  status?: string
  jobs?: { running?: number, queued?: number }
  uptime?: string
  [key: string]: unknown
}

usePageTitle('Agent')

const toast = useToast()
const { resolveCurrentAppPath } = useAppUrls()
const { setRefresh, clearRefresh } = usePageActions()

const enrollment = ref<AgentEnrollment | null>(null)
const health = ref<AgentHealth | null>(null)
const loading = ref(false)

const online = computed(() => Boolean(health.value && (health.value.status === 'ok' || health.value.status === 'healthy')))

const templates = computed(() => enrollment.value?.templates || [])

const templateColumns = [
  { key: 'id', label: '模板 ID' },
  { key: 'type', label: '类型' },
  { key: 'runner', label: 'Runner' },
  { key: 'sandbox', label: 'Sandbox' },
  { key: 'cwd', label: 'cwd' },
  { key: 'argv', label: 'argv' },
  { key: 'timeout', label: '超时' }
]

const healthLines = computed<TerminalLine[]>(() => {
  const lines: TerminalLine[] = [{ t: 'cmd', s: 'GET /runtime/health' }]
  if (!health.value) {
    lines.push({ t: 'err', s: '探针不可达 · Dev Agent 未连接' })
    return lines
  }
  lines.push({ t: online.value ? 'ok' : 'warn', s: `${online.value ? '200 OK' : 'status'} · ${JSON.stringify(health.value)}` })
  return lines
})

const ENGINE_PREFS = [
  { label: '默认引擎', engine: 'claude-code', note: '' },
  { label: '回退引擎', engine: 'codex', note: '当主引擎限流时' },
  { label: 'Issue 自动任务', engine: 'claude-code', note: '' }
]

type IssueSettings = {
  autoClaimEnabled: boolean
  severityMin: string
  kinds: string[]
  apps: string[]
}

const settings = ref<IssueSettings>({ autoClaimEnabled: true, severityMin: 'high', kinds: ['bug'], apps: [] })
const settingsLoading = ref(false)
const settingsSaving = ref(false)

const SEVERITY_OPTIONS = [
  { label: '高', value: 'high' },
  { label: '中', value: 'mid' },
  { label: '低', value: 'low' }
]
const KIND_OPTIONS = [
  { label: '缺陷', value: 'bug' },
  { label: '功能建议', value: 'feature' },
  { label: '使用咨询', value: 'question' }
]
const APP_OPTIONS = ['finance', 'workflow', 'codocs', 'aims', 'altoc', 'assets', 'align', 'insights']

function toggleInList(list: string[], value: string) {
  return list.includes(value) ? list.filter(item => item !== value) : [...list, value]
}

async function loadSettings() {
  settingsLoading.value = true
  try {
    const result = await $fetch<IssueSettings>(resolveCurrentAppPath('/api/webdev/issues/settings'))
    settings.value = {
      autoClaimEnabled: result.autoClaimEnabled !== false,
      severityMin: result.severityMin || 'high',
      kinds: result.kinds?.length ? result.kinds : ['bug'],
      apps: result.apps || []
    }
  } catch {
    // 保持默认值
  } finally {
    settingsLoading.value = false
  }
}

async function saveSettings() {
  settingsSaving.value = true
  try {
    await $fetch(resolveCurrentAppPath('/api/webdev/issues/settings'), {
      method: 'PUT',
      body: settings.value
    })
    toast.add({ title: '自动领取规则已保存', color: 'success', icon: 'i-lucide-check' })
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string }, message?: string }
    toast.add({ title: '保存失败', description: err?.data?.statusMessage || err?.message || '请稍后重试', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    settingsSaving.value = false
  }
}

type BadgeColor = 'primary' | 'info' | 'neutral'

function templateTypeColor(type: string): BadgeColor {
  if (type === 'codex_task') return 'primary'
  if (type === 'deploy_preview') return 'info'
  return 'neutral'
}

function engineColor(engine: string): BadgeColor {
  return engine.includes('claude') ? 'primary' : 'neutral'
}

async function loadAll() {
  loading.value = true
  try {
    const [enrollmentResult, healthResult] = await Promise.allSettled([
      $fetch<AgentEnrollment>(resolveCurrentAppPath('/api/webdev/agent/enrollment')),
      $fetch<AgentHealth>(resolveCurrentAppPath('/api/webdev/agent/health'))
    ])
    enrollment.value = enrollmentResult.status === 'fulfilled' ? enrollmentResult.value : null
    health.value = healthResult.status === 'fulfilled' ? healthResult.value : null
    if (enrollmentResult.status === 'rejected') {
      toast.add({ title: 'Agent 不可用', description: '无法读取 Dev Agent enrollment', color: 'error', icon: 'i-lucide-circle-alert' })
    }
  } finally {
    loading.value = false
  }
}

function refreshAll() {
  loadAll()
  loadSettings()
}

onMounted(() => {
  setRefresh(refreshAll)
  refreshAll()
})

onBeforeUnmount(() => {
  clearRefresh()
})
</script>

<template>
  <UDashboardPanel
    id="webdev-agents"
    class="h-full min-h-0 flex-1"
    :ui="{ body: 'min-h-0 overflow-auto p-0 sm:p-0 gap-0 sm:gap-0' }"
  >
    <template #body>
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 class="text-xl font-semibold">
              Agent
            </h1>
            <p class="mt-1 text-sm text-muted">
              通过 Cloudflare Tunnel 接入的开发机及其命令模板白名单。
            </p>
          </div>
          <UButton icon="i-lucide-plus" color="primary" disabled>
            注册开发机
          </UButton>
        </div>

        <!-- Agent 卡片 -->
        <UCard>
          <div class="flex items-start gap-3">
            <span
              class="flex size-10 shrink-0 items-center justify-center rounded-xl"
              :class="online ? 'bg-success/10 text-success' : 'bg-elevated text-muted'"
            >
              <UIcon name="i-lucide-laptop-minimal" class="size-5" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-base font-bold">{{ enrollment?.agentId || 'dev-agent' }}</span>
                <UBadge :color="online ? 'success' : 'neutral'" variant="soft" class="gap-1">
                  <UIcon :name="online ? 'i-lucide-wifi' : 'i-lucide-wifi-off'" class="size-3.5" />
                  {{ online ? '在线' : '离线' }}
                </UBadge>
                <span class="ml-auto font-mono text-xs text-muted">{{ enrollment?.version || '-' }}</span>
              </div>
              <p class="mt-1 font-mono text-xs text-muted">
                {{ enrollment?.endpoint || 'dev-agent-1.huizhi.yun' }}
              </p>
              <div class="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                <div class="flex items-baseline gap-2 text-xs">
                  <span class="w-16 shrink-0 text-muted">运行中</span>
                  <span class="font-mono">{{ health?.jobs?.running ?? '-' }}</span>
                </div>
                <div class="flex items-baseline gap-2 text-xs">
                  <span class="w-16 shrink-0 text-muted">排队</span>
                  <span class="font-mono">{{ health?.jobs?.queued ?? '-' }}</span>
                </div>
                <div class="flex items-baseline gap-2 text-xs">
                  <span class="w-16 shrink-0 text-muted">仓库</span>
                  <span class="font-mono">{{ enrollment?.repoId || 'huizhi-yun' }}</span>
                </div>
                <div class="flex items-baseline gap-2 text-xs">
                  <span class="w-16 shrink-0 text-muted">模板</span>
                  <span class="font-mono">{{ templates.length }} 个</span>
                </div>
              </div>
            </div>
          </div>
        </UCard>

        <div class="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <!-- 命令模板白名单 -->
          <UCard :ui="{ body: 'p-0 sm:p-0' }">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-shield-check" class="size-4 text-muted" />
                <span class="text-sm font-semibold">命令模板白名单</span>
                <span class="ml-auto text-xs text-muted">无通用 shell · 仅模板执行</span>
              </div>
            </template>
            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs">
                <thead>
                  <tr class="border-b border-default text-[10px] uppercase tracking-wide text-muted">
                    <th
                      v-for="col in templateColumns"
                      :key="col.key"
                      class="px-3 py-2 font-semibold"
                    >
                      {{ col.label }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="tpl in templates"
                    :key="tpl.id"
                    class="border-b border-default/60"
                  >
                    <td class="px-3 py-2 font-mono font-semibold">
                      {{ tpl.id }}
                    </td>
                    <td class="px-3 py-2">
                      <UBadge :color="templateTypeColor(tpl.type)" variant="soft" size="sm">
                        {{ tpl.type }}
                      </UBadge>
                    </td>
                    <td class="px-3 py-2 font-mono text-muted">
                      {{ tpl.runner || 'command' }}
                    </td>
                    <td class="px-3 py-2 font-mono text-muted">
                      {{ tpl.codexSandboxPolicy || '-' }}
                    </td>
                    <td class="px-3 py-2 font-mono text-muted">
                      {{ tpl.cwd || '.' }}
                    </td>
                    <td class="max-w-56 truncate px-3 py-2 font-mono text-muted">
                      {{ tpl.argv || '-' }}
                    </td>
                    <td class="px-3 py-2 font-mono text-muted">
                      {{ tpl.timeoutSec ? `${tpl.timeoutSec}s` : '-' }}
                    </td>
                  </tr>
                  <tr v-if="!templates.length">
                    <td colspan="7" class="px-3 py-8 text-center text-muted">
                      暂无模板 · Agent 未连接或未配置
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </UCard>

          <div class="flex flex-col gap-4">
            <!-- 引擎偏好 -->
            <UCard>
              <template #header>
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-sparkles" class="size-4 text-muted" />
                  <span class="text-sm font-semibold">引擎偏好 · 项目设置</span>
                </div>
              </template>
              <div class="flex flex-col gap-2.5">
                <div
                  v-for="pref in ENGINE_PREFS"
                  :key="pref.label"
                  class="flex items-center gap-2 text-xs"
                >
                  <span class="w-24 shrink-0 text-muted">{{ pref.label }}</span>
                  <UBadge :color="engineColor(pref.engine)" variant="soft" class="gap-1 font-mono">
                    <UIcon :name="pref.engine.includes('claude') ? 'i-lucide-sparkles' : 'i-lucide-square-terminal'" class="size-3.5" />
                    {{ pref.engine }}
                  </UBadge>
                  <span v-if="pref.note" class="text-muted">{{ pref.note }}</span>
                </div>
                <p class="border-t border-default pt-2 text-[11px] text-muted">
                  任务级不可切换 — 引擎仅在项目设置中配置
                </p>
              </div>
            </UCard>

            <!-- 自动领取规则 -->
            <UCard>
              <template #header>
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-zap" class="size-4 text-muted" />
                  <span class="text-sm font-semibold">自动领取规则 · 项目设置</span>
                  <UButton
                    class="ml-auto"
                    icon="i-lucide-save"
                    color="primary"
                    size="xs"
                    :loading="settingsSaving"
                    @click="saveSettings"
                  >
                    保存
                  </UButton>
                </div>
              </template>
              <div class="flex flex-col gap-3 text-xs">
                <div class="flex items-center gap-2">
                  <USwitch v-model="settings.autoClaimEnabled" />
                  <span class="text-default">开启自动领取（命中规则的 Issue 自动建 Agent 任务）</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="w-20 shrink-0 text-muted">严重程度 ≥</span>
                  <USelect v-model="settings.severityMin" :items="SEVERITY_OPTIONS" class="w-24" />
                </div>
                <div class="flex items-start gap-2">
                  <span class="w-20 shrink-0 pt-1 text-muted">类型</span>
                  <div class="flex flex-wrap gap-1.5">
                    <UButton
                      v-for="option in KIND_OPTIONS"
                      :key="option.value"
                      :variant="settings.kinds.includes(option.value) ? 'solid' : 'soft'"
                      color="neutral"
                      size="xs"
                      @click="settings.kinds = toggleInList(settings.kinds, option.value)"
                    >
                      {{ option.label }}
                    </UButton>
                  </div>
                </div>
                <div class="flex items-start gap-2">
                  <span class="w-20 shrink-0 pt-1 text-muted">来源应用</span>
                  <div class="flex flex-wrap gap-1.5">
                    <UButton
                      v-for="app in APP_OPTIONS"
                      :key="app"
                      :variant="settings.apps.includes(app) ? 'solid' : 'soft'"
                      color="neutral"
                      size="xs"
                      class="font-mono"
                      @click="settings.apps = toggleInList(settings.apps, app)"
                    >
                      {{ app }}
                    </UButton>
                  </div>
                </div>
                <p class="border-t border-default pt-2 text-[11px] text-muted">
                  规则存于 Data Runtime（按租户）；未配置时回退环境变量默认值。
                </p>
              </div>
            </UCard>

            <!-- 健康探针 -->
            <UCard>
              <template #header>
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-activity" class="size-4 text-muted" />
                  <span class="text-sm font-semibold">健康探针</span>
                </div>
              </template>
              <WebTerminal :lines="healthLines" />
            </UCard>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
