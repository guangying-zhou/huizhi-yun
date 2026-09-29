<script setup lang="ts">
import ContentPageHeader from './ContentPageHeader.vue'
import type { ConsoleDirectoryDepartment } from '../types/consoleDirectory'
import { flattenDepartmentTree } from '../../shared/utils/consoleDepartmentTree'

usePageTitle('部门')
const props = defineProps<{ apiPath: string, consolePath: string }>()
const route = useRoute()
function formPath(deptCode?: string) {
  return { path: `/enterprise/directory/departments-${deptCode ? 'edit' : 'new'}`, query: { ...(deptCode ? { deptCode } : {}), returnTo: route.fullPath } }
}
const search = ref('')
const expandedCodes = ref(new Set<string>())
const { data, pending, error, refresh } = await useFetch<{ code: number, data: { tree: ConsoleDirectoryDepartment[], flat: ConsoleDirectoryDepartment[] }, canEdit?: boolean }>(props.apiPath)
watch(data, (value) => {
  expandedCodes.value = new Set((value?.data.flat || []).map(item => item.deptCode))
}, { immediate: true })
const writeDenied = ref(0)
const canEdit = computed(() => data.value?.canEdit === true && !error.value && !writeDenied.value)
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
const visible = computed(() => flattenDepartmentTree(data.value?.data.tree || [], search.value, expandedCodes.value))
function toggle(item: ConsoleDirectoryDepartment) {
  const next = new Set(expandedCodes.value)
  if (next.has(item.deptCode)) next.delete(item.deptCode)
  else next.add(item.deptCode)
  expandedCodes.value = next
}
const selectedCode = ref('')
const detailOpen = ref(false)
const detailPath = computed(() => `${props.apiPath}/${encodeURIComponent(selectedCode.value)}`)
const { data: detail, pending: detailPending, error: detailError, execute, clear } = await useFetch<{ code: number, data: ConsoleDirectoryDepartment }>(detailPath, { immediate: false, watch: false })
async function select(item: ConsoleDirectoryDepartment) {
  clear()
  selectedCode.value = item.deptCode
  detailOpen.value = true
  await execute()
}
const fields = computed(() => detail.value?.data
  ? [
      ['部门编码', detail.value.data.deptCode], ['名称', detail.value.data.name], ['父部门', detail.value.data.parentId],
      ['负责人', detail.value.data.manager || detail.value.data.managerId], ['Leader', detail.value.data.leader || detail.value.data.leaderId],
      ['组织类型', detail.value.data.orgType], ['部门分类', detail.value.data.deptCategory], ['说明', detail.value.data.description]
    ]
  : [])
</script>

<template>
  <UDashboardPanel id="enterprise-directory-departments">
    <template #body>
      <DirectoryDepartmentEditor
        v-slot="editor"
        :api-path="apiPath"
        :departments="data?.data.flat || []"
        :can-edit="canEdit"
        :refresh="refreshList"
        @denied="denied"
      >
        <ContentPageHeader hosted title="部门" description="查看企业组织树及部门资料。">
          <template #actions>
            <UButton
              v-if="canEdit"
              label="新建部门"
              icon="i-lucide-plus"
              :disabled="editor.saving"
              :to="formPath()"
            />
            <UButton
              color="neutral"
              icon="i-lucide-refresh-cw"
              aria-label="刷新部门"
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
          <UInput v-model="search" placeholder="搜索部门或负责人" />
          <UButton color="neutral" label="展开全部" @click="expandedCodes = new Set((data?.data.flat || []).map(item => item.deptCode))" />
          <UButton color="neutral" label="收起全部" @click="expandedCodes = new Set()" />
        </div>
        <CommonEmptyState v-if="error?.statusCode === 403 || writeDenied === 403" title="无权限" description="你没有查看目录部门的权限。" />
        <UAlert
          v-else-if="error || writeDenied === 401"
          color="error"
          title="部门加载失败"
          description="请稍后重试。"
        />
        <DirectoryDepartmentsTable
          v-else
          :items="visible"
          :loading="pending"
          :search="search"
          :expanded-codes="expandedCodes"
          :read-only="!canEdit"
          :mutating="editor.saving"
          @edit="navigateTo(formPath($event.deptCode))"
          @remove="editor.remove"
          @toggle="toggle"
          @select="select"
        />
        <p v-if="!error" class="text-sm text-muted">
          共 {{ visible.length }} 条（当前显示）
        </p>
        <USlideover v-model:open="detailOpen" title="部门资料">
          <template #body>
            <CommonEmptyState v-if="detailError?.statusCode === 403" title="无权限" description="你没有查看该部门的权限。" />
            <UAlert
              v-else-if="detailError"
              color="error"
              title="部门资料加载失败"
              description="请稍后重试。"
            />
            <USkeleton v-else-if="detailPending" class="h-48" />
            <dl v-else-if="detail?.data" class="space-y-3">
              <div v-for="[label, value] in fields" :key="label || ''" class="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 text-sm">
                <dt class="text-muted">
                  {{ label }}
                </dt><dd class="break-words">
                  {{ value || '—' }}
                </dd>
              </div>
            </dl>
          </template>
        </USlideover>
      </DirectoryDepartmentEditor>
    </template>
  </UDashboardPanel>
</template>
