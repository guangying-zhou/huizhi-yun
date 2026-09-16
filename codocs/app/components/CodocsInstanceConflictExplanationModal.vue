<script setup lang="ts">
import type {
  CodocsInstanceConflictExplainData,
  RuntimeInstanceConflictExplanation
} from '~/composables/useCodocsInstanceConflictExplanation'

const props = withDefaults(defineProps<{
  open: boolean
  loading: boolean
  result: CodocsInstanceConflictExplainData | null
  targetLabel?: string
  description?: string
}>(), {
  targetLabel: '',
  description: '实例职责冲突风险解释'
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const modalOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

function conflictDecisionColor(result: RuntimeInstanceConflictExplanation | null | undefined) {
  if (!result) return 'neutral'
  if (result.hasBlockingViolation) return 'error'
  if (result.hasWarningViolation || result.hasViolation) return 'warning'
  return 'success'
}

function conflictDecisionLabel(result: RuntimeInstanceConflictExplanation | null | undefined) {
  if (!result) return '未解释'
  if (result.hasBlockingViolation) return '阻断风险'
  if (result.hasWarningViolation || result.hasViolation) return '预警风险'
  return '未触发'
}

function conflictRuleStatusColor(status: unknown) {
  if (status === 'violated') return 'warning'
  if (status === 'satisfied') return 'success'
  return 'neutral'
}

function conflictRuleStatusLabel(status: unknown) {
  if (status === 'violated') return '已触发'
  if (status === 'satisfied') return '已通过'
  return '未适用'
}

function permissionText(permission: { appCode?: string, resourceCode?: string, action?: string } | null | undefined) {
  if (!permission) return '-'
  return [permission.appCode, permission.resourceCode, permission.action].filter(Boolean).join(':') || '-'
}

function principalLabel(kind: string) {
  const labels: Record<string, string> = {
    requester: '请求人',
    initiator: '发起人',
    submitter: '提交人',
    applicant: '申请人',
    owner: '负责人'
  }
  return labels[kind] || kind
}
</script>

<template>
  <UModal
    v-model:open="modalOpen"
    title="职责冲突解释"
    :description="targetLabel || description"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div
        v-if="loading"
        class="flex min-h-36 items-center justify-center gap-2 text-sm text-muted"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-4 animate-spin"
        />
        正在解释职责冲突...
      </div>

      <div
        v-else-if="result"
        class="space-y-4"
      >
        <UAlert
          :color="conflictDecisionColor(result.explanation)"
          variant="soft"
          icon="i-lucide-shield-alert"
          :title="conflictDecisionLabel(result.explanation)"
          :description="`${result.explanation.requested.appCode}:${result.explanation.requested.resourceCode}:${result.explanation.requested.action}`"
        />

        <div class="rounded-lg border border-default bg-muted px-4 py-3">
          <div class="flex flex-wrap gap-1.5">
            <UBadge
              v-for="principal in result.explanation.principals"
              :key="`${principal.kind}:${principal.uid}`"
              :color="principal.matchesActor ? 'warning' : 'neutral'"
              variant="soft"
              class="font-mono"
            >
              {{ principalLabel(principal.kind) }}={{ principal.uid }}
            </UBadge>
            <span
              v-if="result.explanation.principals.length === 0"
              class="text-sm text-muted"
            >
              当前审阅记录没有可解释的发起主体。
            </span>
          </div>
        </div>

        <div
          v-if="result.explanation.rules.length > 0"
          class="grid gap-2"
        >
          <div
            v-for="rule in result.explanation.rules"
            :key="String(rule.ruleCode || rule.ruleName)"
            class="rounded-lg border border-default bg-default px-4 py-3"
          >
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-semibold text-highlighted">
                {{ rule.ruleName || rule.ruleCode }}
              </p>
              <UBadge
                :color="conflictRuleStatusColor(rule.status)"
                variant="soft"
              >
                {{ conflictRuleStatusLabel(rule.status) }}
              </UBadge>
              <UBadge
                :color="rule.enforcement === 'enforce' ? 'error' : 'warning'"
                variant="soft"
              >
                {{ rule.enforcement || 'warning' }}
              </UBadge>
            </div>
            <p class="mt-2 text-sm text-muted">
              {{ rule.message || rule.reasonCode || '未返回解释消息' }}
            </p>
            <p class="mt-2 font-mono text-xs text-muted">
              {{ permissionText(rule.counterpart?.permission) }}
              /
              {{ permissionText(rule.requested?.permission) }}
            </p>
          </div>
        </div>

        <div
          v-else
          class="rounded-lg border border-dashed border-default bg-muted px-4 py-6 text-center text-sm text-muted"
        >
          当前操作未命中 active 职责冲突规则。
        </div>
      </div>
    </template>
  </UModal>
</template>
