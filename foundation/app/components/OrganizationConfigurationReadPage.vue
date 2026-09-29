<script setup lang="ts">
import type { ConsoleOrganizationRead, ConsoleRegion, ConsoleRegionDivision } from '../types/consoleOrganization'

const props = defineProps<{ kind: 'business-domains' | 'regions', title: string }>()
usePageTitle(props.title)
const apiPath = `/enterprise/api/organization/${props.kind}`
const consolePath = `/console/admin/${props.kind}`
const { data, pending, error, refresh } = await useFetch<{ code: number, data: ConsoleOrganizationRead }>(apiPath)
const search = ref('')
const selectedRegion = ref<ConsoleRegion | null>(null)
const divisions = ref<ConsoleRegionDivision[]>([])
const divisionPending = ref(false)
const divisionFailed = ref(false)
let selectionRevision = 0
const rows = computed(() => props.kind === 'business-domains' ? data.value?.data.domains || [] : data.value?.data.regions || [])
const filtered = computed(() => rows.value.filter(row => Object.values(row).join(' ').toLowerCase().includes(search.value.trim().toLowerCase())))
const columns = computed(() => props.kind === 'business-domains'
  ? [
      { accessorKey: 'domainCode', header: '编码' }, { accessorKey: 'displayName', header: '显示名称' }, { accessorKey: 'domainName', header: '领域名称' },
      { accessorKey: 'category', header: '类型' }, { accessorKey: 'source', header: '来源' }, { accessorKey: 'sortOrder', header: '排序' }
    ]
  : [
      { accessorKey: 'regionCode', header: '编码' }, { accessorKey: 'regionName', header: '区域名称' }, { accessorKey: 'description', header: '说明' },
      { accessorKey: 'divisionCount', header: '区划数' }, { accessorKey: 'sortOrder', header: '排序' }, { id: 'details', header: '区划' }
    ])
async function viewDivisions(region: ConsoleRegion) {
  const revision = ++selectionRevision
  selectedRegion.value = region
  divisions.value = []
  divisionPending.value = true
  divisionFailed.value = false
  try {
    const result = await $fetch<{ code: number, data: { items: ConsoleRegionDivision[] } }>(`${apiPath}/${encodeURIComponent(region.regionCode)}/divisions`)
    if (revision === selectionRevision) divisions.value = result.data.items
  } catch {
    if (revision === selectionRevision) divisionFailed.value = true
  } finally {
    if (revision === selectionRevision) divisionPending.value = false
  }
}
async function refreshAll() {
  selectionRevision++
  selectedRegion.value = null
  divisions.value = []
  await refresh()
}
</script>

<template>
  <UDashboardPanel :id="`enterprise-${kind}`">
    <template #body>
      <ContentPageHeader hosted :title="title" description="查看当前企业的配置。管理操作在控制台完成。" />
      <div class="flex flex-wrap items-center gap-2">
        <span class="min-w-0 break-words text-sm text-muted">{{ data?.data.company.companyName || '当前企业' }}</span>
        <UInput
          v-model="search"
          :aria-label="`筛选${title}`"
          placeholder="按编码或名称筛选"
          icon="i-lucide-search"
          class="w-full sm:w-64"
        />
        <UButton
          :to="consolePath"
          external
          color="neutral"
          variant="outline"
          label="在控制台管理"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          aria-label="刷新配置"
          :loading="pending"
          @click="refreshAll"
        />
      </div>
      <CommonEmptyState v-if="error?.statusCode === 403" title="无权限" description="你没有查看企业配置的权限。" />
      <UAlert
        v-else-if="error"
        color="error"
        title="配置加载失败"
        description="请稍后重试。"
      />
      <UTable
        v-else
        :data="filtered"
        :columns="columns"
        :loading="pending"
        class="w-full"
        :ui="{ td: 'whitespace-normal break-words', th: 'whitespace-nowrap' }"
      >
        <template #details-cell="{ row }">
          <UButton label="查看区划" variant="link" @click="viewDivisions(row.original as ConsoleRegion)" />
        </template>
        <template #empty>
          <CommonEmptyState title="暂无配置" description="当前企业没有符合筛选条件的配置。">
            <UButton :to="consolePath" external label="在控制台管理" />
          </CommonEmptyState>
        </template>
      </UTable>
      <section v-if="selectedRegion" class="min-w-0 space-y-3">
        <h2 class="break-words font-semibold">
          {{ selectedRegion.regionName }} · 区划
        </h2>
        <UAlert
          v-if="divisionFailed"
          color="error"
          title="区划加载失败"
          description="请重新点击查看区划。"
        />
        <UTable
          v-else
          :data="divisions"
          :loading="divisionPending"
          :columns="[{ accessorKey: 'divisionCode', header: '区划编码' }, { accessorKey: 'divisionName', header: '区划名称' }, { accessorKey: 'includeChildren', header: '包含下级' }]"
          :ui="{ td: 'whitespace-normal break-words' }"
        >
          <template #includeChildren-cell="{ row }">
            {{ row.original.includeChildren ? '是' : '否' }}
          </template>
          <template #empty>
            <CommonEmptyState title="暂无区划" description="该区域尚未绑定行政区划。" />
          </template>
        </UTable>
      </section>
    </template>
  </UDashboardPanel>
</template>
