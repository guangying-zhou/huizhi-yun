<script setup lang="ts">
interface AuthorizationExplainScope {
  dimension: string
  predicate: string
  value?: string | null
  group?: string
  source: string
}

interface AuthorizationExplainPermission {
  appCode: string
  resourceCode: string
  action: string
}

interface AuthorizationExplainGrant {
  grantId: string
  roleCode: string | null
  subjectType: string
  sourceType: string
  permission: AuthorizationExplainPermission
  active: boolean
  actionMatched: boolean
  scopeMatched: boolean
  defaultScopes: AuthorizationExplainScope[]
  assignmentScopes: AuthorizationExplainScope[]
  relationScopes: AuthorizationExplainScope[]
}

interface AuthorizationExplainResult {
  uid: string
  tenantCode: string
  subjectId: number | null
  selectedRoleCodes: string[]
  availableRoleCodes: string[]
  activeRoleCode: string | null
  allowed: boolean
  reasonCode: string
  matchedAction: string | null
  matchedGrant: AuthorizationExplainGrant | null
  candidateGrants: AuthorizationExplainGrant[]
}

interface AuthorizationExplainForm {
  uid: string
  appCode: string
  resourceCode: string
  action: string
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
}

const props = defineProps<{
  open: boolean
  form: AuthorizationExplainForm
  result: AuthorizationExplainResult | null
  pending: boolean
  tenantCode: string
  userSubjectOptions: Array<{ label: string, value: string }>
  canUseSelectedSubject: boolean
}>()

const emit = defineEmits<{
  run: []
  useSelectedSubject: []
}>()

const form = computed(() => props.form)

const decisionColor = computed(() => {
  if (!props.result) return 'neutral'
  return props.result.allowed ? 'success' : 'error'
})

function reasonLabel(reasonCode: string) {
  if (reasonCode === 'allowed') return '允许'
  if (reasonCode === 'scope_not_matched') return '权限存在但对象范围不匹配'
  if (reasonCode === 'no_permission') return '没有匹配权限'
  return reasonCode || '未知'
}

function scopeText(scope: AuthorizationExplainScope) {
  const value = scope.value ? `:${scope.value}` : ''
  return `${scope.dimension}:${scope.predicate}${value}`
}

function grantScopeText(grant: AuthorizationExplainGrant) {
  const scopes = [
    ...grant.defaultScopes,
    ...grant.assignmentScopes,
    ...grant.relationScopes
  ]
  if (scopes.length === 0) return '无范围限制'
  return scopes.map(scope => `${scopeText(scope)} (${scope.source})`).join(' / ')
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
            检查员工是否有某项权限
          </h2>
          <p class="mt-1 text-sm text-muted">
            {{ result ? reasonLabel(result.reasonCode) : '仅在排查“为什么能/不能打开或操作某个对象”时使用' }}
          </p>
        </div>
        <UBadge
          v-if="result"
          :color="decisionColor"
          variant="soft"
        >
          {{ result.allowed ? '允许' : '不允许' }}
        </UBadge>
      </div>
    </template>

    <div class="space-y-4">
      <div class="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_auto]">
        <UFormField label="员工">
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
              placeholder="view"
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
            检查权限
          </UButton>
        </div>
      </div>

      <div class="grid gap-3 lg:grid-cols-3">
        <UFormField label="对象负责人">
          <UInput
            v-model="form.ownerUid"
            placeholder="用于本人范围判断"
          />
        </UFormField>
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
        <UFormField label="已匹配关系">
          <UInput
            v-model="form.matchedRelations"
            placeholder="relation:participant"
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
            {{ reasonLabel(result.reasonCode) }}
          </UBadge>
          <span class="text-xs text-muted">已使用角色：{{ result.selectedRoleCodes.join(' / ') || '无' }}</span>
          <span
            v-if="result.matchedAction"
            class="text-xs text-muted"
          >
            实际匹配操作：{{ result.matchedAction }}
          </span>
        </div>

        <div
          v-if="result.matchedGrant"
          class="mt-3 rounded-lg border border-default bg-default px-3 py-2 text-sm"
        >
          <p class="font-semibold text-highlighted">
            {{ result.matchedGrant.roleCode || '未知角色' }}
          </p>
          <p class="mt-1 text-xs text-muted">
            {{ result.matchedGrant.sourceType }} · {{ result.matchedGrant.subjectType }} · {{ grantScopeText(result.matchedGrant) }}
          </p>
        </div>

        <div
          v-else-if="result.candidateGrants.length > 0"
          class="mt-3 grid gap-2"
        >
          <div
            v-for="grant in result.candidateGrants"
            :key="grant.grantId"
            class="rounded-lg border border-default bg-default px-3 py-2 text-sm"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-semibold text-highlighted">{{ grant.roleCode || '未知角色' }}</span>
              <UBadge
                :color="grant.scopeMatched ? 'success' : 'warning'"
                variant="soft"
              >
                {{ grant.scopeMatched ? '对象范围匹配' : '对象范围不匹配' }}
              </UBadge>
            </div>
            <p class="mt-1 text-xs text-muted">
              {{ grant.sourceType }} · {{ grant.permission.appCode }}:{{ grant.permission.resourceCode }}:{{ grant.permission.action }} · {{ grantScopeText(grant) }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </UCard>
</template>
