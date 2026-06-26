<script setup lang="ts">
import type { Lead } from '~/types/altoc'
import {
  LEAD_STATUS_OPTIONS,
  SOURCE_TYPE_OPTIONS
} from '~/types/altoc'
import { unwrapApiPage } from '~/utils/apiResponse'
import { getLeadRuleScore, getLeadScoreColor } from '~/utils/leadScore'
import { getLeadRisks } from '~/utils/leadRisk'

const router = useRouter()

const keyword = ref('')
const statusFilter = ref<string | undefined>(undefined)
const sourceFilter = ref<string | undefined>(undefined)
const page = ref(1)
const pageSize = ref(20)

const queryParams = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  keyword: keyword.value || undefined,
  status: statusFilter.value || undefined,
  source_type: sourceFilter.value || undefined
}))

const { data: result, status, refresh } = useFetch('/api/v1/leads', {
  query: queryParams,
  transform: (res: unknown) => unwrapApiPage<Lead>(res)
})

const items = computed(() => result.value?.items || [])
const total = computed(() => result.value?.total || 0)

const columns = [
  { accessorKey: 'code', header: '编号' },
  { accessorKey: 'name', header: '线索名称' },
  { accessorKey: 'org_name', header: '组织名称' },
  { accessorKey: 'source_type', header: '来源' },
  { accessorKey: 'score', header: '规则评分' },
  { accessorKey: 'contact_name', header: '联系人' },
  { accessorKey: 'owner_user_id', header: '负责人' },
  { accessorKey: 'last_follow_up_at', header: '最近跟进' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'actions', header: '' }
]

function onSearch() {
  page.value = 1
  refresh()
}

function resetFilters() {
  keyword.value = ''
  statusFilter.value = undefined
  sourceFilter.value = undefined
  page.value = 1
}

function getStatusColor(s: string) {
  return LEAD_STATUS_OPTIONS.find(o => o.value === s)?.color || 'neutral'
}
function getStatusLabel(s: string) {
  return LEAD_STATUS_OPTIONS.find(o => o.value === s)?.label || s
}
function getSourceLabel(s: string | null) {
  return SOURCE_TYPE_OPTIONS.find(o => o.value === s)?.label || s || '-'
}

// 转化弹窗
const showConvertModal = ref(false)
const convertTarget = ref<Lead | null>(null)

function openConvert(lead: Lead) {
  convertTarget.value = lead
  showConvertModal.value = true
}

function handleLeadConverted(converted: { opportunity_id: number | string }) {
  showConvertModal.value = false
  refresh()
  router.push(`/opportunities/${converted.opportunity_id}`)
}

const statusSelectOptions = computed(() =>
  LEAD_STATUS_OPTIONS.map(o => ({ label: o.label, value: o.value }))
)
const sourceSelectOptions = computed(() =>
  SOURCE_TYPE_OPTIONS.map(o => ({ label: o.label, value: o.value }))
)
</script>

<template>
  <UDashboardPanel
    id="leads"
    :ui="{
      root: '!h-full !min-h-0 !flex-1 !shrink !overflow-hidden',
      body: '!min-h-0 !flex-1 !gap-0 !overflow-hidden !p-0 sm:!p-0'
    }"
  >
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          线索管理
        </h1>
      </Teleport>
      <Teleport to="#altoc-layout-header-actions">
        <UButton
          label="新建线索"
          icon="i-lucide-plus"
          color="primary"
          @click="router.push('/leads/new')"
        />
      </Teleport>

      <div class="altoc-list-page">
        <!-- 筛选栏 -->
        <div class="altoc-list-toolbar flex flex-wrap items-center gap-2 px-4 py-3 border-b border-default">
          <UInput
            v-model="keyword"
            placeholder="搜索线索/组织/联系人..."
            icon="i-lucide-search"
            class="w-56"
            @keyup.enter="onSearch"
          />
          <USelect
            v-model="statusFilter"
            :items="statusSelectOptions"
            placeholder="全部状态"
            class="w-32"
            @update:model-value="onSearch"
          />
          <USelect
            v-model="sourceFilter"
            :items="sourceSelectOptions"
            placeholder="全部来源"
            class="w-32"
            @update:model-value="onSearch"
          />
          <UButton
            label="重置"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="resetFilters"
          />
        </div>

        <!-- 表格 -->
        <div class="altoc-list-table">
          <UTable
            :data="items"
            :columns="columns"
            :loading="status === 'pending'"
            sticky="header"
            class="altoc-sticky-table w-full"
            :ui="{ thead: 'z-20 bg-default' }"
          >
            <template #code-cell="{ row }">
              <span class="font-mono text-xs text-muted">{{ row.original.code }}</span>
            </template>

            <template #name-cell="{ row }">
              <div class="flex flex-wrap items-center gap-1">
                <NuxtLink :to="`/leads/${row.original.id}`" class="font-medium text-primary hover:underline">
                  {{ row.original.name }}
                </NuxtLink>
                <UBadge
                  v-for="risk in getLeadRisks(row.original)"
                  :key="risk.key"
                  :color="risk.color"
                  variant="subtle"
                  size="xs"
                >
                  {{ risk.label }}
                </UBadge>
              </div>
            </template>

            <template #org_name-cell="{ row }">
              {{ row.original.org_name || '-' }}
            </template>

            <template #source_type-cell="{ row }">
              {{ getSourceLabel(row.original.source_type) }}
            </template>

            <template #score-cell="{ row }">
              <UBadge
                :color="getLeadScoreColor(getLeadRuleScore(row.original))"
                variant="subtle"
                size="sm"
              >
                {{ getLeadRuleScore(row.original) }}
              </UBadge>
            </template>

            <template #contact_name-cell="{ row }">
              <div>
                <span>{{ row.original.contact_name || '-' }}</span>
                <span v-if="row.original.contact_mobile" class="text-xs text-muted ml-1">{{ row.original.contact_mobile }}</span>
              </div>
            </template>

            <template #owner_user_id-cell="{ row }">
              <UserName :uid="row.original.owner_user_id" />
            </template>

            <template #last_follow_up_at-cell="{ row }">
              <span class="text-xs text-muted">{{ row.original.last_follow_up_at || '-' }}</span>
            </template>

            <template #status-cell="{ row }">
              <UBadge :color="getStatusColor(row.original.status)" variant="subtle" size="sm">
                {{ getStatusLabel(row.original.status) }}
              </UBadge>
            </template>

            <template #actions-cell="{ row }">
              <div class="flex items-center gap-1">
                <UButton
                  v-if="row.original.status !== 'converted' && row.original.status !== 'closed_invalid'"
                  icon="i-lucide-arrow-right-circle"
                  variant="ghost"
                  color="primary"
                  size="xs"
                  title="转化"
                  @click="openConvert(row.original)"
                />
                <UButton
                  icon="i-lucide-eye"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  @click="router.push(`/leads/${row.original.id}`)"
                />
              </div>
            </template>

            <template #empty>
              <div class="flex flex-col items-center py-12 text-muted">
                <UIcon name="i-lucide-target" class="text-4xl mb-3" />
                <p class="text-sm mb-3">
                  暂无线索数据
                </p>
                <UButton
                  label="创建第一条线索"
                  color="primary"
                  variant="soft"
                  @click="router.push('/leads/new')"
                />
              </div>
            </template>
          </UTable>
        </div>

        <div v-if="total > 0" class="altoc-list-pagination flex items-center justify-between px-4 py-3 border-t border-default">
          <span class="text-sm text-muted">共 {{ total }} 条</span>
          <UPagination v-model:page="page" :items-per-page="pageSize" :total="total" />
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <LeadConvertModal
    v-model:open="showConvertModal"
    :lead="convertTarget"
    @converted="handleLeadConverted"
  />
</template>
