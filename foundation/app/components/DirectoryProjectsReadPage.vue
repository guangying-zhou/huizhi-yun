<script setup lang="ts">
import ContentPageHeader from './ContentPageHeader.vue'
import type { ConsoleDirectoryProject, ConsoleDirectoryProjectMember } from '../types/consoleDirectory'

usePageTitle('项目注册表')
const props = defineProps<{ apiPath: string, consolePath: string }>()
const route = useRoute()
const { search, debounced, flush, reset } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const deptCode = ref('')
const leaderUid = ref('')
const status = ref('active')
const { page, pageSize, resetFilters } = useListPage({ pageSize: 20, filters: { deptCode, leaderUid, status }, defaults: { leaderUid: '', deptCode: '', status: 'active' } })
const query = computed(() => ({ page: page.value, pageSize, search: debounced.value || undefined, deptCode: deptCode.value || undefined, leaderUid: leaderUid.value || undefined, status: status.value }))
const { data, pending, error, refresh } = await useFetch<{ code: number, canEdit?: boolean, data: { flat: ConsoleDirectoryProject[], total: number } }>(props.apiPath, { query })
const writeDenied = ref(0)
const canEdit = computed(() => data.value?.canEdit === true && !error.value && !writeDenied.value)
const forbidden = computed(() => error.value?.statusCode === 403 || writeDenied.value === 403)
const { data: departmentData } = await useFetch<{ code: number, data: { flat: Array<{ deptCode: string, name: string, level: number, orgType: string }> } }>('/enterprise/api/directory/departments')
async function refreshList() {
  await refresh()
  if (error.value) throw error.value
  writeDenied.value = 0
}
async function refreshPage() {
  await refresh()
  if (!error.value) writeDenied.value = 0
}
async function denied(status: number) {
  writeDenied.value = status
  await refresh()
}
function projectFormUrl(mode: 'edit' | 'members', project: ConsoleDirectoryProject) {
  return `/enterprise/directory/projects-${mode}?${new URLSearchParams({ projectCode: project.projectCode, returnTo: route.fullPath }).toString()}`
}
const createUrl = computed(() => `/enterprise/directory/projects-new?${new URLSearchParams({ returnTo: route.fullPath }).toString()}`)
const selectedCode = ref<string | null>(null)
const detailOpen = ref(false)
const detailPath = computed(() => `${props.apiPath}/${encodeURIComponent(selectedCode.value || '')}`)
const { data: detail, pending: detailPending, error: detailError, execute: loadDetail, clear: clearDetail } = await useFetch<{ code: number, data: ConsoleDirectoryProject }>(detailPath, { immediate: false, watch: false })
async function selectProject(user: ConsoleDirectoryProject) {
  clearDetail()
  selectedCode.value = user.projectCode
  detailOpen.value = true
  memberPage.value = 1
  memberSearch.value = ''
  clearMembers()
  await loadDetail()
  if (!detailError.value) await loadMembers()
}
function resetAll() {
  reset()
  resetFilters()
}
const statusOptions = [{ label: '正常', value: 'active' }, { label: '停用', value: 'inactive' }, { label: '归档', value: 'archived' }, { label: '已删除', value: 'deleted' }, { label: '全部', value: 'all' }]
const fields = computed(() => detail.value?.data
  ? [
      ['项目编码', detail.value.data.projectCode], ['名称', detail.value.data.name], ['父项目', detail.value.data.parentId],
      ['部门', detail.value.data.deptCode], ['负责人', detail.value.data.leaderUid || detail.value.data.ownerUid],
      ['类型', detail.value.data.isTemplate ? '模板' : detail.value.data.isGroup ? '项目组' : '项目'],
      ['状态', detail.value.data.status === 1 ? '正常' : detail.value.data.status === -1 ? '已删除' : detail.value.data.statusKey === 'archived' ? '归档' : '停用'],
      ['仓库', detail.value.data.repoUrl], ['说明', detail.value.data.description]
    ]
  : [])
const memberPage = ref(1)
const { search: memberSearch, debounced: memberDebounced } = useDebouncedSearch({ onChange: () => {
  memberPage.value = 1
} })
const memberQuery = computed(() => ({ projectCode: selectedCode.value || undefined, page: memberPage.value, pageSize: 20, status: 'active', search: memberDebounced.value || undefined }))
const { data: members, pending: membersPending, error: membersError, execute: loadMembers, clear: clearMembers } = await useFetch<{ code: number, data: { items: ConsoleDirectoryProjectMember[], total: number } }>(`${props.apiPath}/members`, { query: memberQuery, immediate: false, watch: false })
watch([memberPage, memberDebounced], () => {
  if (detailOpen.value && detail.value?.data && !detailError.value) loadMembers()
})
</script>

<template>
  <UDashboardPanel id="enterprise-directory-projects">
    <template #body>
      <DirectoryProjectEditor
        v-slot="editor"
        :api-path="apiPath"
        :projects="data?.data.flat || []"
        :departments="departmentData?.data.flat || []"
        :can-edit="canEdit"
        :refresh="refreshList"
        @denied="denied"
      >
        <ContentPageHeader hosted title="项目注册表" description="查询企业目录与项目资料。">
          <template #actions>
            <UButton
              v-if="canEdit"
              icon="i-lucide-plus"
              label="新建项目"
              :disabled="editor.saving"
              @click="navigateTo(createUrl)"
            />
            <UButton
              color="neutral"
              icon="i-lucide-refresh-cw"
              aria-label="刷新项目"
              :loading="pending"
              @click="refreshPage"
            />
            <UButton
              :to="consolePath"
              external
              color="neutral"
              variant="outline"
              label="在控制台管理"
            />
          </template>
        </ContentPageHeader>
        <div class="flex flex-wrap gap-2">
          <UInput v-model="search" placeholder="搜索项目" @keyup.enter="flush" />
          <UInput v-model="deptCode" placeholder="部门编码" />
          <UInput v-model="leaderUid" placeholder="负责人 UID" />
          <USelect v-model="status" :items="statusOptions" aria-label="项目状态" />
          <UButton
            color="neutral"
            variant="ghost"
            label="重置"
            @click="resetAll"
          />
        </div>
        <CommonEmptyState v-if="forbidden" title="无权限" description="你没有查看项目注册表的权限。" />
        <UAlert
          v-else-if="error || writeDenied"
          color="error"
          title="项目注册表加载失败"
          description="请稍后重试。"
        />
        <template v-else>
          <DirectoryProjectsTable
            :items="data?.data.flat || []"
            :loading="pending"
            :read-only="!canEdit"
            :mutating="editor.saving"
            @edit="navigateTo(projectFormUrl('edit', $event))"
            @remove="editor.remove"
            @select="selectProject"
            @members="canEdit ? navigateTo(projectFormUrl('members', $event)) : selectProject($event)"
          />
          <div class="flex flex-wrap items-center justify-between gap-3">
            <span class="text-sm text-muted">共 {{ data?.data.total || 0 }} 条</span>
            <UPagination v-model:page="page" :items-per-page="pageSize" :total="data?.data.total || 0" />
          </div>
        </template>
        <USlideover v-model:open="detailOpen" title="项目资料">
          <template #body>
            <CommonEmptyState v-if="detailError?.statusCode === 403" title="无权限" description="你没有查看这位项目资料的权限。" />
            <UAlert
              v-else-if="detailError"
              color="error"
              title="项目资料加载失败"
              description="请稍后重试。"
            />
            <USkeleton v-else-if="detailPending" class="h-48" />
            <template v-else-if="detail?.data">
              <dl class="space-y-3">
                <div v-for="[label, value] in fields" :key="label || ''" class="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 text-sm">
                  <dt class="text-muted">
                    {{ label }}
                  </dt><dd class="break-words">
                    {{ value || '—' }}
                  </dd>
                </div>
              </dl>
              <h3 class="mt-6 font-medium">
                成员
              </h3>
              <UInput v-model="memberSearch" placeholder="搜索成员" class="my-3" />
              <CommonEmptyState v-if="membersError?.statusCode === 403" title="无权限" description="你没有查看项目成员的权限。" />
              <UAlert
                v-else-if="membersError"
                color="error"
                title="成员加载失败"
                description="请稍后重试。"
              />
              <template v-else>
                <DirectoryProjectMembersTable :items="members?.data.items || []" :loading="membersPending" />
                <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <span class="text-sm text-muted">共 {{ members?.data.total || 0 }} 条</span>
                  <UPagination v-model:page="memberPage" :items-per-page="20" :total="members?.data.total || 0" />
                </div>
              </template>
            </template>
          </template>
        </USlideover>
      </DirectoryProjectEditor>
    </template>
  </UDashboardPanel>
</template>
