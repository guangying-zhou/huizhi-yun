<script setup lang="ts">
type RoleConflictEnforcement = 'warning' | 'enforce'
type InstanceConflictStatus = 'violated' | 'satisfied' | 'not_applicable'

interface InstanceConflictPermission {
  appCode: string
  resourceCode: string
  action: string
}

interface InstanceConflictPrincipal {
  kind: string
  uid: string
  matchesActor: boolean
}

interface InstanceConflictRuleExplanation {
  ruleCode: string
  ruleName: string
  enforcement: RoleConflictEnforcement
  status: InstanceConflictStatus
  reasonCode: string
  message: string
  requested: { permission: InstanceConflictPermission }
  counterpart: { permission: InstanceConflictPermission }
}

interface InstanceConflictExplainResult {
  uid: string
  requested: InstanceConflictPermission
  hasViolation: boolean
  hasBlockingViolation: boolean
  hasWarningViolation: boolean
  principals: InstanceConflictPrincipal[]
  rules: InstanceConflictRuleExplanation[]
}

interface InstanceConflictExplainForm {
  uid: string
  appCode: string
  resourceCode: string
  action: string
  activeRoleCode: string
  authorizationMode: 'merged' | 'role_simulation' | 'user_simulation'
  includeBaseline: boolean
  ownerUid: string
  departmentCode: string
  departmentTree: string
  projectCode: string
  projectMemberUids: string
  customerOwnerUid: string
  customerTeamUids: string
  assignedUid: string
  assignedUids: string
  matchedRelations: string
  environment: string
  deploymentEnvironment: string
  requesterUid: string
  applicantUid: string
  initiatorUid: string
  createdByUid: string
  handlerUid: string
  operatorUid: string
  submittedByUid: string
  makerUid: string
}

const props = defineProps<{
  open: boolean
  form: InstanceConflictExplainForm
  result: InstanceConflictExplainResult | null
  pending: boolean
  tenantCode: string
  userSubjectOptions: Array<{ label: string, value: string }>
  authorizationModeItems: Array<{ label: string, value: InstanceConflictExplainForm['authorizationMode'] }>
  canUseSelectedSubject: boolean
}>()

const emit = defineEmits<{
  run: []
  useSelectedSubject: []
}>()

const form = computed(() => props.form)

const decisionColor = computed(() => {
  if (!props.result) return 'neutral'
  if (props.result.hasBlockingViolation) return 'error'
  if (props.result.hasWarningViolation || props.result.hasViolation) return 'warning'
  return 'success'
})

const decisionLabel = computed(() => {
  if (!props.result) return '未解释'
  if (props.result.hasBlockingViolation) return '已拦截'
  if (props.result.hasWarningViolation || props.result.hasViolation) return '需关注'
  return '未发现冲突'
})

function instanceConflictStatusColor(status: InstanceConflictStatus) {
  if (status === 'violated') return 'warning'
  if (status === 'satisfied') return 'success'
  return 'neutral'
}

function instanceConflictStatusLabel(status: InstanceConflictStatus) {
  if (status === 'violated') return '已触发'
  if (status === 'satisfied') return '已通过'
  return '未适用'
}

function instanceConflictReasonLabel(reasonCode: string) {
  if (reasonCode === 'self_approval') return '当前用户与实例主体相同'
  if (reasonCode === 'different_instance_actor') return '实例主体不同'
  if (reasonCode === 'missing_requested_permission') return '缺少请求动作权限'
  if (reasonCode === 'missing_counterpart_permission') return '缺少对侧职责权限'
  if (reasonCode === 'non_approval_side') return '非审批侧动作'
  return reasonCode || '未知原因'
}

function instancePrincipalLabel(kind: string) {
  const labels: Record<string, string> = {
    requester: '请求人',
    applicant: '申请人',
    initiator: '发起人',
    creator: '创建人',
    owner: 'Owner',
    handler: '经办人',
    operator: '操作人',
    submitter: '提交人',
    maker: '制单人'
  }
  return labels[kind] || kind
}

function instanceConflictPermissionText(permission: InstanceConflictPermission) {
  return `${permission.appCode}:${permission.resourceCode}:${permission.action}`
}

function conflictRuleEnforcementColor(enforcement: RoleConflictEnforcement) {
  return enforcement === 'enforce' ? 'error' : 'warning'
}

function conflictRuleEnforcementLabel(enforcement: RoleConflictEnforcement) {
  return enforcement === 'enforce' ? '拦截' : '提醒'
}
</script>

<template>
  <UCard
    v-if="open"
    class="shrink-0"
  >
    <template #header>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            检查单据是否会触发职责冲突
          </h2>
          <p class="mt-1 text-sm text-muted">
            {{ result ? `命中规则 ${result.rules.length} 条` : '仅在排查“为什么不能审批/确认这张单据”时使用' }}
          </p>
        </div>
        <UBadge
          v-if="result"
          :color="decisionColor"
          variant="soft"
        >
          {{ decisionLabel }}
        </UBadge>
      </div>
    </template>

    <div class="space-y-4">
      <div class="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_auto]">
        <UFormField label="执行动作的员工">
          <USelect
            v-model="form.uid"
            :items="userSubjectOptions"
            placeholder="选择员工"
          />
        </UFormField>
        <div class="grid gap-3 sm:grid-cols-3">
          <UFormField label="应用编码">
            <UInput
              v-model="form.appCode"
              placeholder="finance"
            />
          </UFormField>
          <UFormField label="业务对象">
            <UInput
              v-model="form.resourceCode"
              placeholder="expenses"
            />
          </UFormField>
          <UFormField label="操作">
            <UInput
              v-model="form.action"
              placeholder="confirm"
            />
          </UFormField>
        </div>
        <div class="flex flex-wrap items-end gap-2">
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-user-check"
            :disabled="!canUseSelectedSubject"
            @click="emit('useSelectedSubject')"
          >
            使用已选员工
          </UButton>
          <UButton
            color="primary"
            icon="i-lucide-search-check"
            :loading="pending"
            :disabled="!tenantCode"
            @click="emit('run')"
          >
            检查冲突
          </UButton>
        </div>
      </div>

      <div class="grid gap-3 lg:grid-cols-4">
        <UFormField label="计算方式">
          <USelect
            v-model="form.authorizationMode"
            :items="authorizationModeItems"
          />
        </UFormField>
        <UFormField label="模拟角色">
          <UInput
            v-model="form.activeRoleCode"
            placeholder="仅模拟角色时填写"
          />
        </UFormField>
        <UFormField label="同时检查内置规则">
          <USwitch v-model="form.includeBaseline" />
        </UFormField>
        <UFormField label="对象负责人">
          <UInput
            v-model="form.ownerUid"
            placeholder="用于本人范围判断"
          />
        </UFormField>
      </div>

      <div class="grid gap-3 lg:grid-cols-3">
        <UFormField label="申请人">
          <UInput
            v-model="form.applicantUid"
            placeholder="申请人 / 报销人"
          />
        </UFormField>
        <UFormField label="经办人">
          <UInput
            v-model="form.handlerUid"
            placeholder="经办人"
          />
        </UFormField>
        <UFormField label="制单人">
          <UInput
            v-model="form.makerUid"
            placeholder="制单人"
          />
        </UFormField>
        <UFormField label="请求人">
          <UInput
            v-model="form.requesterUid"
            placeholder="请求人"
          />
        </UFormField>
        <UFormField label="发起人">
          <UInput
            v-model="form.initiatorUid"
            placeholder="发起人"
          />
        </UFormField>
        <UFormField label="创建人">
          <UInput
            v-model="form.createdByUid"
            placeholder="创建人"
          />
        </UFormField>
        <UFormField label="操作人">
          <UInput
            v-model="form.operatorUid"
            placeholder="操作人"
          />
        </UFormField>
        <UFormField label="提交人">
          <UInput
            v-model="form.submittedByUid"
            placeholder="提交人"
          />
        </UFormField>
        <UFormField label="已匹配关系">
          <UInput
            v-model="form.matchedRelations"
            placeholder="relation:participant"
          />
        </UFormField>
      </div>

      <div class="grid gap-3 lg:grid-cols-3">
        <UFormField label="部门">
          <UInput
            v-model="form.departmentCode"
            placeholder="dept-sales"
          />
        </UFormField>
        <UFormField label="上级部门链">
          <UInput
            v-model="form.departmentTree"
            placeholder="dept-root,dept-sales"
          />
        </UFormField>
        <UFormField label="项目">
          <UInput
            v-model="form.projectCode"
            placeholder="PRJ-001"
          />
        </UFormField>
        <UFormField label="项目成员">
          <UInput
            v-model="form.projectMemberUids"
            placeholder="u1,u2"
          />
        </UFormField>
        <UFormField label="客户负责人">
          <UInput
            v-model="form.customerOwnerUid"
            placeholder="u1"
          />
        </UFormField>
        <UFormField label="客户团队">
          <UInput
            v-model="form.customerTeamUids"
            placeholder="u1,u2"
          />
        </UFormField>
        <UFormField label="指派人">
          <UInput
            v-model="form.assignedUid"
            placeholder="u1"
          />
        </UFormField>
        <UFormField label="指派成员">
          <UInput
            v-model="form.assignedUids"
            placeholder="u1,u2"
          />
        </UFormField>
        <UFormField label="运行环境">
          <UInput
            v-model="form.environment"
            placeholder="prod"
          />
        </UFormField>
        <UFormField label="部署环境">
          <UInput
            v-model="form.deploymentEnvironment"
            placeholder="prod"
          />
        </UFormField>
      </div>

      <div
        v-if="result"
        class="rounded-lg border border-default bg-muted px-4 py-3"
      >
        <div class="flex flex-wrap items-center gap-2">
          <UBadge
            :color="decisionColor"
            variant="soft"
          >
            {{ decisionLabel }}
          </UBadge>
          <span class="font-mono text-xs text-muted">{{ instanceConflictPermissionText(result.requested) }}</span>
          <span class="text-xs text-muted">员工：{{ result.uid }}</span>
        </div>

        <div
          v-if="result.principals.length > 0"
          class="mt-3 flex flex-wrap gap-1.5"
        >
          <UBadge
            v-for="principal in result.principals"
            :key="`${principal.kind}:${principal.uid}`"
            :color="principal.matchesActor ? 'warning' : 'neutral'"
            variant="soft"
            class="font-mono"
          >
            {{ instancePrincipalLabel(principal.kind) }}={{ principal.uid }}
          </UBadge>
        </div>

        <div
          v-if="result.rules.length > 0"
          class="mt-3 grid gap-2"
        >
          <div
            v-for="rule in result.rules"
            :key="rule.ruleCode"
            class="rounded-lg border border-default bg-default px-3 py-2 text-sm"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-semibold text-highlighted">{{ rule.ruleName }}</span>
              <UBadge
                :color="instanceConflictStatusColor(rule.status)"
                variant="soft"
              >
                {{ instanceConflictStatusLabel(rule.status) }}
              </UBadge>
              <UBadge
                :color="conflictRuleEnforcementColor(rule.enforcement)"
                variant="soft"
              >
                {{ conflictRuleEnforcementLabel(rule.enforcement) }}
              </UBadge>
            </div>
            <p class="mt-1 text-xs text-muted">
              {{ rule.message }}
            </p>
            <p class="mt-1 font-mono text-xs text-muted">
              {{ instanceConflictPermissionText(rule.counterpart.permission) }}
              ↔
              {{ instanceConflictPermissionText(rule.requested.permission) }}
              · {{ instanceConflictReasonLabel(rule.reasonCode) }}
            </p>
          </div>
        </div>

        <div
          v-else
          class="mt-3 rounded-lg border border-dashed border-default bg-default px-4 py-4 text-center text-sm text-muted"
        >
          这次检查没有命中已启用的职责冲突规则。
        </div>
      </div>
    </div>
  </UCard>
</template>
