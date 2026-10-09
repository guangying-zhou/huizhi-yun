<script setup lang="ts">
import {
  createAuthorizationConflictRuleDraft,
  hasDuplicateAuthorizationConflictRuleCode,
  normalizeAuthorizationConflictRule,
  replaceAuthorizationConflictRule,
  toggleAuthorizationConflictRuleStatus,
  validateAuthorizationConflictRule
} from '~/utils/authorizationConflictRules'
import type { AuthorizationConflictRule } from '~/utils/authorizationConflictRules'

const props = defineProps<{
  tenantCode: string
  rules: AuthorizationConflictRule[]
  migrationRequired: boolean
  pending: boolean
  saveRules: (expectedTenantCode: string, rules: AuthorizationConflictRule[]) => Promise<boolean>
}>()

const emit = defineEmits<{
  refresh: []
  warning: [message: string]
}>()

const editorOpen = ref(false)
const editingIndex = ref(-1)
const editorTenantCode = ref('')
const form = reactive<AuthorizationConflictRule>(createAuthorizationConflictRuleDraft())

const activeRuleCount = computed(() => props.rules.filter(rule => rule.status === 'active').length)
const enforcementItems = [
  { label: '提醒', value: 'warning' },
  { label: '拦截', value: 'enforce' }
]
const statusItems = [
  { label: '启用', value: 'active' },
  { label: '停用', value: 'disabled' }
]

watch(() => props.tenantCode, (nextTenantCode) => {
  if (editorOpen.value && editorTenantCode.value && nextTenantCode !== editorTenantCode.value) {
    editorOpen.value = false
    emit('warning', '企业已切换，已关闭旧企业的职责冲突规则编辑器。')
  }
})

function resetForm(rule?: AuthorizationConflictRule | null) {
  Object.assign(form, createAuthorizationConflictRuleDraft(rule))
}

function openEditor(rule?: AuthorizationConflictRule, index = -1) {
  if (!props.tenantCode || props.migrationRequired) return
  editorTenantCode.value = props.tenantCode
  editingIndex.value = index
  resetForm(rule)
  editorOpen.value = true
}

function closeEditor() {
  if (props.pending) return
  editorOpen.value = false
}

function conflictSideText(rule: AuthorizationConflictRule, side: 'left' | 'right') {
  const roleCode = side === 'left' ? rule.leftRoleCode : rule.rightRoleCode
  const appCode = side === 'left' ? rule.leftAppCode : rule.rightAppCode
  const resourceCode = side === 'left' ? rule.leftResourceCode : rule.rightResourceCode
  const action = side === 'left' ? rule.leftAction : rule.rightAction
  const parts = []
  if (roleCode) parts.push(roleCode)
  if (appCode && resourceCode && action) parts.push(`${appCode}:${resourceCode}:${action}`)
  return parts.join(' / ') || '未配置'
}

function statusColor(status: AuthorizationConflictRule['status']) {
  return status === 'active' ? 'success' : 'neutral'
}

function statusLabel(status: AuthorizationConflictRule['status']) {
  return status === 'active' ? '启用中' : '已停用'
}

function enforcementColor(enforcement: AuthorizationConflictRule['enforcement']) {
  return enforcement === 'enforce' ? 'error' : 'warning'
}

function enforcementLabel(enforcement: AuthorizationConflictRule['enforcement']) {
  return enforcement === 'enforce' ? '拦截' : '提醒'
}

async function saveEditor() {
  const normalized = normalizeAuthorizationConflictRule(form)
  const validationError = validateAuthorizationConflictRule(normalized)
  if (validationError) {
    emit('warning', validationError)
    return
  }

  if (hasDuplicateAuthorizationConflictRuleCode(props.rules, normalized.ruleCode, editingIndex.value)) {
    emit('warning', `规则编码重复：${normalized.ruleCode}`)
    return
  }

  const nextRules = replaceAuthorizationConflictRule(props.rules, normalized, editingIndex.value)
  if (await props.saveRules(editorTenantCode.value, nextRules)) {
    editorOpen.value = false
  }
}

async function toggleStatus(index: number) {
  await props.saveRules(props.tenantCode, toggleAuthorizationConflictRuleStatus(props.rules, index))
}
</script>

<template>
  <UCard class="shrink-0">
    <template #header>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            职责冲突规则
          </h2>
          <p class="mt-1 text-sm text-muted">
            已启用 {{ activeRuleCount }} / 共 {{ rules.length }} 条
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            :loading="pending"
            :disabled="!tenantCode"
            @click="emit('refresh')"
          >
            刷新
          </UButton>
          <UButton
            color="primary"
            variant="soft"
            icon="i-lucide-plus"
            :disabled="!tenantCode || migrationRequired"
            @click="openEditor()"
          >
            新增规则
          </UButton>
        </div>
      </div>
    </template>

    <div class="space-y-3">
      <UAlert
        v-if="migrationRequired"
        color="warning"
        variant="soft"
        icon="i-lucide-database"
        title="角色冲突规则表尚未迁移"
        description="请先执行 Platform v2.21 migration；当前授权写入仍会使用内置静态规则。"
      />

      <div
        v-if="pending"
        class="permission-state"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-4 animate-spin"
        />
        正在加载规则...
      </div>

      <div
        v-else-if="rules.length > 0"
        class="grid gap-2"
      >
        <div
          v-for="(rule, index) in rules"
          :key="rule.ruleCode"
          class="rounded-lg border border-default bg-default px-4 py-3"
        >
          <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div class="min-w-0 space-y-2">
              <div class="flex flex-wrap items-center gap-2">
                <p class="font-semibold text-highlighted">
                  {{ rule.ruleName }}
                </p>
                <UBadge
                  :color="enforcementColor(rule.enforcement)"
                  variant="soft"
                >
                  {{ enforcementLabel(rule.enforcement) }}
                </UBadge>
                <UBadge
                  :color="statusColor(rule.status)"
                  variant="soft"
                >
                  {{ statusLabel(rule.status) }}
                </UBadge>
              </div>
              <p class="font-mono text-xs text-muted">
                {{ rule.ruleCode }} · {{ rule.conflictType }}
              </p>
              <div class="grid gap-2 text-xs text-muted md:grid-cols-2">
                <p class="truncate">
                  左侧：{{ conflictSideText(rule, 'left') }}
                </p>
                <p class="truncate">
                  右侧：{{ conflictSideText(rule, 'right') }}
                </p>
              </div>
              <p
                v-if="rule.description"
                class="text-xs text-muted"
              >
                {{ rule.description }}
              </p>
            </div>
            <div class="flex flex-wrap items-start justify-end gap-2">
              <UButton
                color="neutral"
                variant="soft"
                size="sm"
                icon="i-lucide-pencil"
                :disabled="pending"
                @click="openEditor(rule, index)"
              >
                编辑
              </UButton>
              <UButton
                :color="rule.status === 'active' ? 'warning' : 'success'"
                variant="soft"
                size="sm"
                :disabled="pending"
                @click="toggleStatus(index)"
              >
                {{ rule.status === 'active' ? '停用' : '启用' }}
              </UButton>
            </div>
          </div>
        </div>
      </div>

      <div
        v-else-if="!migrationRequired"
        class="rounded-lg border border-dashed border-default bg-muted px-4 py-6 text-center text-sm text-muted"
      >
        当前租户未配置表驱动职责冲突规则。
      </div>
    </div>
  </UCard>

  <UModal
    v-model:open="editorOpen"
    :title="editingIndex >= 0 ? '编辑职责冲突规则' : '新增职责冲突规则'"
    :description="editorTenantCode ? `tenantCode=${editorTenantCode}` : '未选择企业'"
    :ui="{ content: 'max-w-5xl' }"
  >
    <template #body>
      <div class="space-y-5">
        <div class="grid gap-3 md:grid-cols-2">
          <UFormField label="规则编码">
            <UInput
              v-model="form.ruleCode"
              placeholder="finance-expense-maker-confirmation"
            />
          </UFormField>
          <UFormField label="规则名称">
            <UInput
              v-model="form.ruleName"
              placeholder="付款制单与付款确认分离"
            />
          </UFormField>
          <UFormField label="规则类型">
            <UInput v-model="form.conflictType" />
          </UFormField>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="执行级别">
              <USelect
                v-model="form.enforcement"
                :items="enforcementItems"
              />
            </UFormField>
            <UFormField label="状态">
              <USelect
                v-model="form.status"
                :items="statusItems"
              />
            </UFormField>
          </div>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div class="rounded-lg border border-default bg-muted p-4">
            <h3 class="text-sm font-semibold text-highlighted">
              左侧职责
            </h3>
            <div class="mt-3 grid gap-3">
              <UFormField label="角色编码">
                <UInput
                  v-model="form.leftRoleCode"
                  placeholder="可选，如 finance_maker"
                />
              </UFormField>
              <div class="grid gap-3 sm:grid-cols-3">
                <UFormField label="应用编码">
                  <UInput
                    v-model="form.leftAppCode"
                    placeholder="finance"
                  />
                </UFormField>
                <UFormField label="业务对象">
                  <UInput
                    v-model="form.leftResourceCode"
                    placeholder="expenses"
                  />
                </UFormField>
                <UFormField label="操作">
                  <UInput
                    v-model="form.leftAction"
                    placeholder="edit"
                  />
                </UFormField>
              </div>
            </div>
          </div>

          <div class="rounded-lg border border-default bg-muted p-4">
            <h3 class="text-sm font-semibold text-highlighted">
              右侧职责
            </h3>
            <div class="mt-3 grid gap-3">
              <UFormField label="角色编码">
                <UInput
                  v-model="form.rightRoleCode"
                  placeholder="可选，如 finance_confirmer"
                />
              </UFormField>
              <div class="grid gap-3 sm:grid-cols-3">
                <UFormField label="应用编码">
                  <UInput
                    v-model="form.rightAppCode"
                    placeholder="finance"
                  />
                </UFormField>
                <UFormField label="业务对象">
                  <UInput
                    v-model="form.rightResourceCode"
                    placeholder="expenses"
                  />
                </UFormField>
                <UFormField label="操作">
                  <UInput
                    v-model="form.rightAction"
                    placeholder="confirm"
                  />
                </UFormField>
              </div>
            </div>
          </div>
        </div>

        <UFormField label="说明">
          <UTextarea
            v-model="form.description"
            :rows="3"
            placeholder="允许兼任时，业务实例必须保留双人校验。"
          />
        </UFormField>

        <div class="flex flex-wrap justify-end gap-2 border-t border-default pt-4">
          <UButton
            color="neutral"
            variant="soft"
            :disabled="pending"
            @click="closeEditor"
          >
            取消
          </UButton>
          <UButton
            color="primary"
            icon="i-lucide-save"
            :loading="pending"
            @click="saveEditor"
          >
            保存规则
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
