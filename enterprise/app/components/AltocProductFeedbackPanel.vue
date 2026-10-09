<script setup lang="ts">
import { createConsoleMutationIntent } from '@hzy/foundation/shared/utils/consoleMutationIntent'

const props = defineProps<{ ticketId: string, canEdit: boolean }>()
type State = { submitted: boolean, productCode: string, expectedSourceSha256?: string, title?: string, description?: string, status?: string, decisionStatus?: string, canonicalDecisionStatus?: string, progressPending?: boolean, versions?: { versionCode: string, status: string, plannedReleaseDate?: string, releasedAt?: string, publicFeatureCount: number, deliveredFeatureCount: number }[] }
const state = ref<State | null>(null)
const pending = ref(false)
const message = ref('')
const scope = useState<string>('enterprise-cache-scope', () => '')
const intent = createConsoleMutationIntent('altoc-product-feedback')
const { confirm } = useConfirm()
const labels: Record<string, string> = { pending: '待确认', succeeded: '已提交', submitted: '待评估', evaluating: '评估中', accepted: '已接受', deferred: '暂缓', rejected: '已拒绝', merged: '已合并', planning: '规划中', developing: '开发中', released: '已发布', archived: '已归档' }
const api = computed(() => `/altoc/api/v1/service-tickets/${props.ticketId}/product-feedback`)
let epoch = 0
async function load() {
  const n = ++epoch
  state.value = null
  if (!props.canEdit) return
  pending.value = true
  try {
    const r = await $fetch<{ data: State }>(api.value)
    if (n === epoch) state.value = r.data
  } catch {
    if (n === epoch) message.value = '产品反馈读取失败，请稍后重试'
  } finally {
    if (n === epoch) pending.value = false
  }
}
async function submit(resume = false) {
  if (pending.value || !props.canEdit || !state.value || state.value.decisionStatus === 'rejected') return
  if (!resume && !await confirm({ title: '提交产品反馈', message: `将“${state.value.title || '此工单'}”的当前内容冻结为产品反馈。提交后不能追加证据或重提已拒绝需求。`, tone: 'warning' })) return
  const path = `${api.value}${resume ? '/resume' : ''}`
  const body = resume ? {} : { expectedSourceSha256: state.value.expectedSourceSha256 }
  pending.value = true
  message.value = ''
  try {
    await intent.submit({ path, method: 'POST', body }, async (r, key) => {
      await $fetch(r.path, { method: 'POST', body: r.body, headers: { 'Idempotency-Key': key } })
    })
    intent.reset()
    await load()
  } catch {
    await load()
    message.value = '提交结果待确认；仅可恢复原反馈，不会生成新的需求。请确认当前工单和产品权限。'
  } finally {
    pending.value = false
  }
}
watch([api, scope, () => props.canEdit], () => {
  intent.reset()
  message.value = ''
  void load()
}, { immediate: true })
</script>

<template>
  <section class="min-w-0 space-y-3">
    <h2 class="font-semibold">
      产品反馈
    </h2>
    <p class="text-sm text-muted">
      仅提交当前工单的冻结内容，并读取正式产品评估和进度；不支持补充证据或重新提交被拒绝的需求。
    </p>
    <UAlert
      v-if="message"
      color="warning"
      :description="message"
    />
    <p
      v-if="pending"
      class="text-sm text-muted"
    >
      正在确认反馈状态…
    </p>
    <template v-if="state">
      <div class="flex flex-wrap items-center gap-2">
        <UBadge
          v-if="state.submitted"
          color="neutral"
          variant="subtle"
        >
          {{ labels[state.decisionStatus || state.status || 'pending'] || '待确认' }}
        </UBadge>
        <UButton
          v-if="!state.submitted && canEdit"
          :loading="pending"
          @click="submit(false)"
        >
          提交产品反馈
        </UButton>
        <UButton
          v-if="state.submitted && state.status !== 'succeeded' && state.decisionStatus !== 'rejected' && canEdit"
          color="neutral"
          variant="outline"
          :loading="pending"
          @click="submit(true)"
        >
          恢复原反馈
        </UButton>
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="pending"
          @click="load"
        >
          刷新评估与进度
        </UButton>
      </div>
      <p
        v-if="state.decisionStatus === 'rejected'"
        class="text-sm text-muted"
      >
        产品需求已拒绝；不支持重新提交。
      </p>
      <p
        v-if="state.progressPending"
        class="text-sm text-muted"
      >
        进度同步中，当前仅显示已确认的评估结果。
      </p>
      <div
        v-for="v in state.versions || []"
        :key="v.versionCode"
        class="flex flex-wrap items-center gap-2 rounded border border-default p-3 text-sm"
      >
        <span class="break-all">{{ v.versionCode }}</span><UBadge
          color="neutral"
          variant="subtle"
        >
          {{ labels[v.status] || '待确认' }}
        </UBadge>
        <span>{{ v.deliveredFeatureCount }} / {{ v.publicFeatureCount }} 项已交付</span>
        <span v-if="v.plannedReleaseDate">计划发布：{{ v.plannedReleaseDate }}</span>
      </div>
    </template>
  </section>
</template>
