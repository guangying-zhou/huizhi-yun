<script setup lang="ts">
import type { MyIssue } from '../composables/useIssueReporter'

withDefaults(defineProps<{
  // 浮动按钮位置；嵌入到已有工具栏时可设为 false 仅暴露 open()
  floating?: boolean
}>(), {
  floating: true
})

const toast = useToast()
const { collectContext, submit, fetchMine, currentRoutePattern } = useIssueReporter()
const auth = useAuth()
const { authenticated } = auth
const { enabled: reporterEnabled } = useFeedbackReporter()

// 浮动按钮仅在已登录且系统参数启用时展示；嵌入工具栏模式（floating=false）由调用方控制
const showFloating = computed(() => unref(authenticated) && reporterEnabled.value)

const open = ref(false)
const submitting = ref(false)
const mineLoading = ref(false)
const mine = ref<MyIssue[]>([])
const mineScope = ref<'page' | 'app'>('page')

const kind = ref<'bug' | 'feature' | 'question'>('bug')
const severity = ref<'low' | 'mid' | 'high'>('mid')
const scope = ref<'page' | 'app'>('page')
const isGlobal = computed(() => scope.value === 'app')
const title = ref('')
const description = ref('')

const kindOptions = [
  { label: '缺陷', value: 'bug' },
  { label: '功能建议', value: 'feature' },
  { label: '使用咨询', value: 'question' }
]
const severityOptions = [
  { label: '低', value: 'low' },
  { label: '中', value: 'mid' },
  { label: '高', value: 'high' }
]
const scopeOptions = [
  { label: '当前页面', value: 'page' },
  { label: '应用级', value: 'app' }
]

const STATE_LABEL: Record<string, string> = {
  open: '待领取',
  claiming: '领取中',
  in_progress: '修复中',
  verifying: '待验证',
  resolved: '已解决',
  closed: '已关闭'
}

const errorCount = computed(() => collectContext().context.consoleErrors?.length || 0)
const canSubmit = computed(() => title.value.trim().length > 0 && !submitting.value)

function responseStatus(error: unknown) {
  const err = error as {
    statusCode?: number
    status?: number
    response?: { status?: number }
    data?: { statusCode?: number, status?: number }
  }
  return Number(err?.statusCode || err?.status || err?.response?.status || err?.data?.statusCode || err?.data?.status || 0) || 0
}

async function refreshAuthOnce() {
  if (!('refresh' in auth) || typeof auth.refresh !== 'function') {
    return false
  }

  try {
    await auth.refresh()
    return true
  } catch {
    return false
  }
}

async function retryAfterAuthRefresh<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (error) {
    if (responseStatus(error) !== 401 || !await refreshAuthOnce()) {
      throw error
    }
    return await operation()
  }
}

async function loadMine() {
  mineLoading.value = true
  try {
    const result = await retryAfterAuthRefresh(() =>
      fetchMine(
        mineScope.value === 'page'
          ? { scope: 'page', routePattern: currentRoutePattern(), pageSize: 10 }
          : { pageSize: 10 }
      )
    )
    mine.value = result.items || []
  } catch {
    mine.value = []
  } finally {
    mineLoading.value = false
  }
}

watch(open, (value) => {
  if (value) {
    title.value = ''
    description.value = ''
    kind.value = 'bug'
    severity.value = 'mid'
    scope.value = 'page'
    mineScope.value = 'page'
    loadMine()
  }
})

watch(mineScope, () => {
  if (open.value) loadMine()
})

async function onSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const collected = collectContext()
    await retryAfterAuthRefresh(() =>
      submit({
        title: title.value.trim(),
        description: description.value.trim(),
        kind: kind.value,
        severity: severity.value,
        scope: isGlobal.value ? 'app' : 'page',
        routePattern: isGlobal.value ? undefined : collected.routePattern,
        pageUrl: collected.pageUrl,
        context: collected.context
      })
    )
    toast.add({ title: '已提交反馈', description: '感谢反馈，研发会在 WebDev 收件箱处理', color: 'success', icon: 'i-lucide-check' })
    open.value = false
  } catch (error: unknown) {
    const err = error as { data?: { statusMessage?: string, message?: string }, message?: string }
    toast.add({
      title: '提交失败',
      description: responseStatus(error) === 401
        ? '登录已过期，请重新登录后再提交'
        : err?.data?.statusMessage || err?.data?.message || err?.message || '请稍后重试',
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
  } finally {
    submitting.value = false
  }
}

function openReporter() {
  open.value = true
}

defineExpose({ open: openReporter })
</script>

<template>
  <div>
    <UButton
      v-if="floating && showFloating"
      icon="i-lucide-megaphone"
      color="neutral"
      class="fixed bottom-15 right-10 z-40 rounded-full shadow-lg"
      @click="open = true"
    >
      反馈
    </UButton>

    <UModal v-model:open="open" title="报告问题" :description="`提交至 Issue 收件箱 · ${isGlobal ? '应用级' : '当前页面'}`">
      <template #body>
        <div class="flex flex-col gap-4">
          <!-- 我已提报 -->
          <div v-if="mineLoading || mine.length" class="rounded-lg border border-default bg-elevated/40 p-3">
            <div class="mb-2 flex items-center gap-2">
              <UIcon name="i-lucide-history" class="size-3.5 text-muted" />
              <span class="text-xs font-semibold text-muted">{{ mineScope === 'page' ? '本页面' : '本应用' }}你已提报</span>
              <UButton
                class="ml-auto"
                :label="mineScope === 'page' ? '看本应用全部' : '只看本页面'"
                color="neutral"
                variant="link"
                size="xs"
                @click="mineScope = mineScope === 'page' ? 'app' : 'page'"
              />
            </div>
            <div v-if="mineLoading" class="text-xs text-muted">
              加载中…
            </div>
            <ul v-else class="flex flex-col gap-1">
              <li
                v-for="item in mine"
                :key="item.id"
                class="flex items-center gap-2 text-xs"
              >
                <span class="font-mono text-muted">#{{ item.displayNo ?? '—' }}</span>
                <span class="min-w-0 flex-1 truncate text-default">{{ item.title }}</span>
                <UBadge color="neutral" variant="subtle" size="sm">
                  {{ STATE_LABEL[item.state || 'open'] || item.state }}
                </UBadge>
              </li>
            </ul>
            <p class="mt-2 text-[11px] text-muted">
              若与上述重复可直接关闭，避免重复提交。
            </p>
          </div>

          <UFormField label="类型">
            <div class="flex flex-wrap gap-1.5">
              <UButton
                v-for="option in kindOptions"
                :key="option.value"
                :variant="kind === option.value ? 'solid' : 'soft'"
                color="neutral"
                size="sm"
                @click="kind = option.value as typeof kind"
              >
                {{ option.label }}
              </UButton>
            </div>
          </UFormField>

          <div class="flex flex-wrap items-end gap-4">
            <UFormField v-if="kind === 'bug'" label="严重程度">
              <USelect v-model="severity" :items="severityOptions" class="w-28" />
            </UFormField>
            <UFormField label="范围">
              <URadioGroup v-model="scope" orientation="horizontal" :items="scopeOptions" />
            </UFormField>
          </div>

          <UFormField label="标题" required>
            <UInput v-model="title" placeholder="一句话描述问题" class="w-full" />
          </UFormField>

          <UFormField label="描述（操作步骤、预期与实际结果）">
            <UTextarea
              v-model="description"
              :rows="3"
              placeholder="便于研发复现的细节…"
              class="w-full"
            />
          </UFormField>

          <div class="rounded-md border border-default bg-elevated/30 px-3 py-2 text-[11px] text-muted">
            <div class="flex items-center gap-1.5">
              <UIcon name="i-lucide-shield-check" class="size-3 text-success" />
              已自动采集：当前页面、环境、控制台错误 {{ errorCount }} 条；仅采集错误与环境，不含表单输入与业务数据。
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="open = false">
            取消
          </UButton>
          <UButton
            color="primary"
            icon="i-lucide-send"
            :loading="submitting"
            :disabled="!canSubmit"
            @click="onSubmit"
          >
            提交反馈
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
