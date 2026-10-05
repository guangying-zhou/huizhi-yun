<script setup lang="ts">
import type { TreeItem } from '@nuxt/ui'

interface AssignmentRole {
  roleCode: string
  roleName: string
}

interface SubjectItem {
  id: number
  subjectType: string
  subjectCode: string
  displayName: string
  externalRef: string | null
  parentSubjectId: number | null
  status: string
}

interface SubjectTreeItem extends TreeItem {
  id: string
  subject: SubjectItem
  children?: SubjectTreeItem[]
}

interface SubjectRoleAssignment {
  id: number
  subjectId: number
  subjectType: string
  subjectCode: string
  subjectDisplayName: string
  roleId: number
  roleCode: string
  roleName: string
  appCode: string | null
  roleSource: string
  sourceType: string
  sourceId: string | null
  grantedByUid: string | null
  grantedAt: string
  expiredAt: string | null
  active: boolean
}

const props = defineProps<{
  open: boolean
  selectedRole: AssignmentRole | null
  assignmentRoleId: number
  selectedSubjectSummary: string
  selectedSubjectsCount: number
  subjectTreeOpen: boolean
  subjectKeyword: string
  subjectTreeItems: SubjectTreeItem[]
  flatSubjectTreeItemsCount: number
  selectedSubjectTreeItems: SubjectTreeItem[]
  expiredAt: string
  includeExpired: boolean
  activeAssignmentCount: number
  assignments: SubjectRoleAssignment[]
  pendingAction: boolean
  pendingAssignments: boolean
  pendingSubjects: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:subjectTreeOpen': [value: boolean]
  'update:subjectKeyword': [value: string]
  'update:selectedSubjectTreeItems': [value: SubjectTreeItem[]]
  'update:expiredAt': [value: string]
  'update:includeExpired': [value: boolean]
  'clearSelectedSubjects': []
  'assign': []
  'refresh': []
  'revoke': [assignment: SubjectRoleAssignment]
}>()

function getSubjectTreeItemKey(item: SubjectTreeItem) {
  return item.id
}
</script>

<template>
  <UModal
    :open="props.open"
    :title="props.selectedRole ? `为 ${props.selectedRole.roleName} 授权` : '主体角色分配'"
    :description="props.selectedRole ? props.selectedRole.roleCode : '从列表选择一个企业角色后进行授权。'"
    :ui="{
      content: 'max-w-6xl h-[min(86dvh,54rem)] overflow-visible',
      body: 'min-h-0 overflow-y-auto'
    }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_16rem]">
          <div class="tenant-field">
            <span class="tenant-field__label">主体</span>
            <div class="subject-picker">
              <button
                type="button"
                class="subject-picker__trigger"
                :disabled="!props.selectedRole"
                @click="emit('update:subjectTreeOpen', !props.subjectTreeOpen)"
              >
                <span class="truncate">{{ props.selectedSubjectSummary }}</span>
                <UIcon
                  name="i-lucide-chevron-down"
                  class="h-4 w-4 shrink-0 text-muted"
                />
              </button>

              <div
                v-if="props.subjectTreeOpen"
                class="subject-picker__menu"
              >
                <UInput
                  :model-value="props.subjectKeyword"
                  icon="i-lucide-search"
                  placeholder="搜索员工或部门"
                  @update:model-value="emit('update:subjectKeyword', $event)"
                />

                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-default pb-2">
                  <span class="text-xs text-muted">
                    已选 {{ props.selectedSubjectsCount }} 名员工
                  </span>
                  <div class="flex flex-wrap gap-2">
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      :disabled="props.selectedSubjectsCount === 0"
                      @click="emit('clearSelectedSubjects')"
                    >
                      清空
                    </UButton>
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="soft"
                      :disabled="props.flatSubjectTreeItemsCount === 0"
                      @click="emit('update:subjectTreeOpen', false)"
                    >
                      确定
                    </UButton>
                  </div>
                </div>

                <div class="subject-tree">
                  <UTree
                    v-if="props.subjectTreeItems.length > 0"
                    :model-value="props.selectedSubjectTreeItems"
                    :as="{ link: 'div' }"
                    :items="props.subjectTreeItems"
                    :get-key="getSubjectTreeItemKey"
                    multiple
                    propagate-select
                    bubble-select
                    color="neutral"
                    size="sm"
                    :ui="{
                      root: 'subject-tree__component',
                      link: 'subject-tree__link',
                      linkLabel: 'min-w-0',
                      linkTrailing: 'subject-tree__trailing'
                    }"
                    @update:model-value="emit('update:selectedSubjectTreeItems', $event)"
                  >
                    <template #item-leading="{ selected, indeterminate, handleSelect }">
                      <UCheckbox
                        :model-value="indeterminate ? 'indeterminate' : selected"
                        tabindex="-1"
                        @change="handleSelect"
                        @click.stop
                      />
                    </template>

                    <template #item-label="{ item }">
                      <span class="subject-tree__label">
                        <span class="truncate text-sm font-medium text-highlighted">
                          {{ item.subject.displayName }}
                        </span>
                        <span class="truncate font-mono text-xs text-muted">
                          {{ item.subject.subjectType === 'department' ? '部门' : '员工' }}：{{ item.subject.subjectCode }}
                        </span>
                      </span>
                    </template>

                    <template #item-trailing="{ item, expanded, handleToggle }">
                      <button
                        v-if="item.children?.length"
                        type="button"
                        class="subject-tree__toggle"
                        @click.stop="handleToggle"
                      >
                        <UBadge
                          color="neutral"
                          variant="soft"
                          size="sm"
                        >
                          {{ item.children.length }}
                        </UBadge>
                        <UIcon
                          name="i-lucide-chevron-down"
                          class="subject-tree__toggle-icon"
                          :class="{ 'is-expanded': expanded }"
                        />
                      </button>
                    </template>
                  </UTree>

                  <div
                    v-if="!props.pendingSubjects && props.subjectTreeItems.length === 0"
                    class="rounded-lg border border-dashed border-default bg-muted px-4 py-6 text-center text-sm text-muted"
                  >
                    当前搜索下没有可选员工。
                  </div>
                </div>
              </div>
            </div>
          </div>

          <label class="tenant-field">
            <span class="tenant-field__label">过期时间</span>
            <UInput
              :model-value="props.expiredAt"
              type="datetime-local"
              size="lg"
              :disabled="!props.selectedRole"
              @update:model-value="emit('update:expiredAt', $event)"
            />
          </label>
        </div>

        <div class="flex flex-wrap gap-2">
          <UButton
            color="primary"
            icon="i-lucide-plus"
            :loading="props.pendingAction"
            :disabled="!props.selectedRole || props.selectedSubjectsCount === 0"
            @click="emit('assign')"
          >
            授予{{ props.selectedSubjectsCount === 0 ? '' : props.selectedSubjectsCount + ' 个' }}员工
          </UButton>
          <UButton
            color="neutral"
            variant="soft"
            :loading="props.pendingAssignments"
            :disabled="!props.assignmentRoleId"
            @click="emit('refresh')"
          >
            刷新授权
          </UButton>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4">
          <UCheckbox
            :model-value="props.includeExpired"
            label="显示过期授权"
            @update:model-value="emit('update:includeExpired', $event === true)"
          />
          <span class="text-sm text-muted">
            有效 {{ props.activeAssignmentCount }} / 共 {{ props.assignments.length }} 条
          </span>
        </div>

        <div class="grid gap-3">
          <div
            v-for="item in props.assignments"
            :key="item.id"
            class="rounded-lg border border-default bg-default px-4 py-3"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="font-semibold text-highlighted">
                    {{ item.subjectDisplayName }}
                  </p>
                  <UBadge
                    :color="item.active ? 'success' : 'neutral'"
                    variant="soft"
                  >
                    {{ item.active ? 'active' : 'expired' }}
                  </UBadge>
                </div>
                <p class="font-mono text-xs text-muted">
                  {{ item.subjectType }}:{{ item.subjectCode }} → {{ item.roleCode }}
                </p>
                <p class="text-xs text-muted">
                  {{ item.roleSource }} · {{ item.appCode || 'platform' }}
                </p>
                <p class="text-xs text-muted">
                  granted {{ item.grantedAt }}<span v-if="item.expiredAt"> · expires {{ item.expiredAt }}</span>
                </p>
              </div>
              <UButton
                color="error"
                variant="soft"
                size="sm"
                :disabled="!item.active"
                :loading="props.pendingAction"
                @click="emit('revoke', item)"
              >
                撤销
              </UButton>
            </div>
          </div>

          <div
            v-if="!props.pendingAssignments && props.assignments.length === 0"
            class="rounded-lg border border-dashed border-default bg-muted px-4 py-8 text-center text-sm text-muted"
          >
            当前角色还没有匹配的主体授权。
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.subject-picker {
  position: relative;
}

.subject-picker__trigger {
  display: flex;
  width: 100%;
  min-height: 2.5rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border: 1px solid rgb(203 213 225);
  border-radius: 0.5rem;
  background: white;
  padding: 0.5rem 0.75rem;
  color: rgb(15 23 42);
  text-align: left;
}

.subject-picker__trigger:disabled {
  cursor: not-allowed;
  background: rgb(248 250 252);
  color: rgb(148 163 184);
}

.subject-picker__menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 0.375rem);
  left: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  width: min(24rem, calc(100vw - 2rem));
  max-height: min(38rem, calc(100dvh - 14rem));
  gap: 0.75rem;
  overflow: hidden;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.5rem;
  background: white;
  padding: 0.75rem;
  box-shadow: 0 20px 45px rgb(15 23 42 / 0.16);
}

.subject-tree {
  display: grid;
  min-height: 0;
  overflow-y: auto;
  padding-right: 0.25rem;
}

.subject-tree__component {
  min-width: 0;
}

:deep(.subject-tree__link) {
  align-items: center;
  min-height: 2.75rem;
  border-radius: 0.45rem;
}

:deep(.subject-tree__link:hover) {
  background: rgb(248 250 252);
}

.subject-tree__label {
  display: grid;
  min-width: 0;
  gap: 0.1rem;
  text-align: left;
}

:deep(.subject-tree__trailing) {
  margin-inline-start: auto;
}

.subject-tree__toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.subject-tree__toggle-icon {
  width: 1rem;
  height: 1rem;
  color: rgb(100 116 139);
  transition: transform 0.16s ease;
}

.subject-tree__toggle-icon.is-expanded {
  transform: rotate(180deg);
}

@media (max-width: 768px) {
  .subject-picker__menu {
    position: fixed;
    inset: auto 1rem 1rem 1rem;
    width: auto;
    max-height: min(34rem, calc(100vh - 6rem));
  }
}
</style>
