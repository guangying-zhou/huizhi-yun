<script setup lang="ts">
import CommonEmptyState from './common/EmptyState.vue'
import DirectoryDepartmentEditor from './DirectoryDepartmentEditor.vue'
import type { ConsoleDirectoryDepartment } from '../types/consoleDirectory'

const props = defineProps<{ editing?: boolean }>()
const route = useRoute()
const apiPath = '/enterprise/api/directory/departments'
const code = typeof route.query.deptCode === 'string' ? route.query.deptCode : ''
const returnPath = computed(() => {
  const value = typeof route.query.returnTo === 'string' ? route.query.returnTo : ''
  return value.split(/[?#]/)[0] === '/enterprise/directory/departments' ? value : '/enterprise/directory/departments'
})
const { data, error, refresh } = await useFetch<{ code: number, data: { flat: ConsoleDirectoryDepartment[] }, canEdit?: boolean }>(apiPath)
const { data: detail, error: detailError, refresh: refreshDetail } = await useFetch<{ code: number, data: ConsoleDirectoryDepartment }>(`${apiPath}/${encodeURIComponent(code)}`, { immediate: props.editing && Boolean(code), watch: false })
const denied = ref(0)
const canEdit = computed(() => data.value?.canEdit === true && !error.value && !denied.value)
const opened = ref(canEdit.value && (!props.editing || Boolean(detail.value?.data)))
function leave() {
  void navigateTo(returnPath.value)
}
async function retry() {
  await refresh()
  if (props.editing && code) await refreshDetail()
  if (canEdit.value && (!props.editing || detail.value?.data)) opened.value = true
}
</script>

<template>
  <UDashboardPanel id="directory-department-form" :ui="{ body: 'p-0 sm:p-0' }">
    <template #body>
      <DirectoryDepartmentEditor
        v-if="opened"
        page
        :initial-department="editing ? detail?.data : null"
        :api-path="apiPath"
        :departments="data?.data.flat || []"
        :can-edit="canEdit"
        :refresh="async () => {}"
        @closed="leave"
        @denied="denied = $event"
      />
      <CommonEmptyState
        v-else
        icon="i-lucide-lock-keyhole"
        :title="!canEdit ? '无法编辑部门' : '无法加载部门'"
        :description="error || detailError ? '请稍后重试，或联系管理员确认访问权限。' : editing && !code ? '缺少部门编码，请从部门列表进入编辑。' : '请返回列表，确认部门及编辑权限。'"
      >
        <UButton color="neutral" variant="outline" @click="leave">
          返回部门列表
        </UButton>
        <UButton v-if="error || detailError" @click="retry">
          重试
        </UButton>
      </CommonEmptyState>
    </template>
  </UDashboardPanel>
</template>
