<script setup lang="ts">
import CommonEmptyState from './common/EmptyState.vue'
import DirectoryProjectEditor from './DirectoryProjectEditor.vue'
import type { ConsoleDirectoryProject, ConsoleDirectoryDepartment } from '../types/consoleDirectory'

const props = defineProps<{ mode: 'create' | 'edit' | 'members' }>()
const route = useRoute()
const apiPath = '/enterprise/api/directory/projects'
const code = typeof route.query.projectCode === 'string' ? route.query.projectCode : ''
const returnPath = computed(() => {
  const value = typeof route.query.returnTo === 'string' ? route.query.returnTo : ''
  return value.split(/[?#]/)[0] === '/enterprise/directory/projects' ? value : '/enterprise/directory/projects'
})
const { data, error, refresh } = await useFetch<{ code: number, canEdit?: boolean, data: { flat: ConsoleDirectoryProject[] } }>(apiPath)
const { data: departments, error: departmentsError } = await useFetch<{ code: number, data: { flat: ConsoleDirectoryDepartment[] } }>('/enterprise/api/directory/departments')
const { data: detail, error: detailError, refresh: refreshDetail } = await useFetch<{ code: number, data: ConsoleDirectoryProject }>(`${apiPath}/${encodeURIComponent(code)}`, { immediate: props.mode !== 'create' && Boolean(code), watch: false })
const denied = ref(0)
const canEdit = computed(() => data.value?.canEdit === true && !error.value && !denied.value)
const opened = ref(canEdit.value && (props.mode === 'create' || Boolean(detail.value?.data)))
function leave() {
  void navigateTo(returnPath.value)
}
async function retry() {
  await refresh()
  if (props.mode !== 'create' && code) await refreshDetail()
  if (canEdit.value && (props.mode === 'create' || detail.value?.data)) opened.value = true
}
</script>

<template>
  <UDashboardPanel id="directory-project-form" :ui="{ body: 'p-0 sm:p-0' }">
    <template #body>
      <DirectoryProjectEditor
        v-if="opened"
        page
        :initial-mode="mode"
        :initial-project="detail?.data || null"
        :api-path="apiPath"
        :projects="data?.data.flat || []"
        :departments="departments?.data.flat || []"
        :can-edit="canEdit"
        :refresh="async () => {}"
        @closed="leave"
        @denied="denied = $event"
      />
      <CommonEmptyState
        v-else
        icon="i-lucide-lock-keyhole"
        :title="!canEdit ? '无法编辑项目' : '无法加载项目'"
        :description="error || detailError || departmentsError ? '请稍后重试，或联系管理员确认访问权限。' : mode !== 'create' && !code ? '缺少项目编码，请从项目列表进入。' : '请返回列表，确认项目及编辑权限。'"
      >
        <UButton color="neutral" variant="outline" @click="leave">
          返回项目列表
        </UButton>
        <UButton v-if="error || detailError || departmentsError" @click="retry">
          重试
        </UButton>
      </CommonEmptyState>
    </template>
  </UDashboardPanel>
</template>
