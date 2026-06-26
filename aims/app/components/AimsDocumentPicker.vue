<script setup lang="ts">
import type { DocumentSource, DocumentSourceTab, DocumentRef, RepoDocFile } from '~/composables/useAimsDocumentPicker'
import type { ProjectRepo } from '~/types/aims'

type DefaultSourceProp = DocumentSource | DocumentSourceTab

const props = withDefaults(defineProps<{
  open: boolean
  title?: string
  deptCode?: string | null
  aimsProjectId?: number | null
  repos?: ProjectRepo[]
  /** 当前已选文档（用于"更换"场景展示并恢复来源） */
  initialValue?: DocumentRef | null
  /** 默认来源；支持 'codocs_dept' / 'codocs_portfolio' / 'repo'；兼容旧值 'codocs' → 'codocs_dept' */
  defaultSource?: DefaultSourceProp
  /** 允许的来源（tab），默认 ['codocs_dept','codocs_portfolio','repo'] */
  allowedSources?: DocumentSourceTab[]
  /** snapshot=选中时记录 commit_id；follow=不记录 */
  mode?: 'snapshot' | 'follow'
  confirmLabel?: string
}>(), {
  title: '选择文档',
  deptCode: null,
  aimsProjectId: null,
  repos: () => [],
  initialValue: null,
  defaultSource: undefined,
  allowedSources: () => ['codocs_portfolio', 'repo'],
  mode: 'snapshot',
  confirmLabel: '确定'
})

const emit = defineEmits<{
  'update:open': [v: boolean]
  'select': [ref: DocumentRef]
}>()

const {
  deptFolders, deptDocuments, deptLoading, loadDeptDocs,
  portfolioFolders, portfolioDocuments, portfolioLoading, portfolioGitGroup, loadPortfolioDocs,
  repoTree, repoLoading, loadRepoTree
} = useAimsDocumentPicker()

function normalizeDefaultSource(v: DefaultSourceProp | undefined): DocumentSourceTab | null {
  if (!v) return null
  if (v === 'codocs') return 'codocs_dept'
  return v
}

// ---- source tab ----
const resolvedDefaultTab = computed<DocumentSourceTab>(() => {
  const explicit = normalizeDefaultSource(props.defaultSource)
  if (explicit && (props.allowedSources || []).includes(explicit)) return explicit
  if ((props.repos || []).length > 0 && (props.allowedSources || []).includes('repo')) return 'repo'
  return (props.allowedSources || [])[0] || 'codocs_dept'
})

const sourceTab = ref<DocumentSourceTab>(resolvedDefaultTab.value)
const sourceOptions = computed(() => {
  const all: { label: string, value: DocumentSourceTab, disabled?: boolean }[] = [
    { label: '部门文档', value: 'codocs_dept' },
    { label: '项目组文档', value: 'codocs_portfolio' },
    { label: '项目仓库文档', value: 'repo', disabled: (props.repos || []).length === 0 }
  ]
  return all.filter(o => (props.allowedSources || []).includes(o.value))
})

const isCodocsTab = computed(() => sourceTab.value === 'codocs_dept' || sourceTab.value === 'codocs_portfolio')

// 当前 tab 对应的 codocs 数据源
const activeCodocsFolders = computed(() => sourceTab.value === 'codocs_portfolio' ? portfolioFolders.value : deptFolders.value)
const activeCodocsDocuments = computed(() => sourceTab.value === 'codocs_portfolio' ? portfolioDocuments.value : deptDocuments.value)
const activeCodocsLoading = computed(() => sourceTab.value === 'codocs_portfolio' ? portfolioLoading.value : deptLoading.value)

// ---- repo ----
const selectedRepoCode = ref<string>(props.repos?.[0]?.repoProjectCode || '')
watch(() => props.repos, (list) => {
  if (!list || list.length === 0) {
    selectedRepoCode.value = ''
    return
  }
  if (!selectedRepoCode.value || !list.some(r => r.repoProjectCode === selectedRepoCode.value)) {
    selectedRepoCode.value = list[0]!.repoProjectCode
  }
}, { immediate: true })

const repoSearch = ref('')
const filteredRepoFiles = computed<RepoDocFile[]>(() => {
  const files = repoTree.value?.files || []
  const q = repoSearch.value.trim().toLowerCase()
  if (!q) return files
  return files.filter(f => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
})

// ---- codocs ----
const selectedCodocsUuid = ref<string>('')

// ---- preview ----
interface RepoPreview {
  content: string
  commit_id: string
  path: string
  name: string
}
const repoPreview = ref<RepoPreview | null>(null)
const repoPreviewLoading = ref(false)

interface CodocsPreview {
  uuid: string
  title: string
}
const codocsPreview = ref<CodocsPreview | null>(null)

async function selectRepoFile(file: RepoDocFile) {
  repoPreviewLoading.value = true
  try {
    const ref = repoTree.value?.ref
    const content = await fetchRepoDocContent(selectedRepoCode.value, file.path, { ref })
    if (content) {
      repoPreview.value = {
        content: content.content,
        commit_id: content.commit_id,
        path: content.path,
        name: content.name
      }
    }
  } finally {
    repoPreviewLoading.value = false
  }
}

function selectCodocsDoc(uuid: string) {
  selectedCodocsUuid.value = uuid
  const doc = activeCodocsDocuments.value.find(d => d.uuid === uuid)
    || deptDocuments.value.find(d => d.uuid === uuid)
    || portfolioDocuments.value.find(d => d.uuid === uuid)
  codocsPreview.value = doc ? { uuid: doc.uuid, title: doc.title } : { uuid, title: '（已关联文档）' }
}

async function ensureTabLoaded(tab: DocumentSourceTab) {
  if (tab === 'codocs_dept' && deptDocuments.value.length === 0) {
    await loadDeptDocs(props.deptCode)
  } else if (tab === 'codocs_portfolio' && portfolioDocuments.value.length === 0) {
    await loadPortfolioDocs(props.aimsProjectId)
  } else if (tab === 'repo' && !repoTree.value && selectedRepoCode.value) {
    await loadRepoTree(selectedRepoCode.value)
  }
}

// ---- open / reset ----
async function initOnOpen() {
  // 根据 initialValue 恢复来源 tab 与选中项
  if (props.initialValue) {
    if (props.initialValue.source === 'repo' && (props.allowedSources || []).includes('repo')) {
      sourceTab.value = 'repo'
    } else if (props.initialValue.source === 'codocs') {
      // 保留当前 tab 若已是 codocs_*, 否则默认到部门文档
      if (!isCodocsTab.value) {
        sourceTab.value = (props.allowedSources || []).includes('codocs_dept') ? 'codocs_dept' : 'codocs_portfolio'
      }
    }
  } else {
    sourceTab.value = resolvedDefaultTab.value
  }
  selectedCodocsUuid.value = ''
  codocsPreview.value = null
  repoPreview.value = null
  repoSearch.value = ''

  // 预加载
  await ensureTabLoaded(sourceTab.value)

  if (props.initialValue?.source === 'codocs' && props.initialValue.codocsUuid) {
    selectCodocsDoc(props.initialValue.codocsUuid)
    if (props.initialValue.title) codocsPreview.value = { uuid: props.initialValue.codocsUuid, title: props.initialValue.title }
  } else if (props.initialValue?.source === 'repo' && props.initialValue.repoFilePath
    && props.initialValue.repoProjectCode === selectedRepoCode.value
    && repoTree.value) {
    const f = repoTree.value.files.find(x => x.path === props.initialValue!.repoFilePath)
    if (f) await selectRepoFile(f)
  }
}

watch(() => props.open, async (v) => {
  if (v) await initOnOpen()
})

// tab 切换时懒加载
watch(sourceTab, async (tab) => {
  if (!props.open) return
  await ensureTabLoaded(tab)
})

// 仓库切换时重新加载
watch(selectedRepoCode, async (v) => {
  if (!props.open) return
  if (sourceTab.value === 'repo' && v) await loadRepoTree(v)
  repoPreview.value = null
})

// ---- confirm ----
const canConfirm = computed(() => {
  if (isCodocsTab.value) return !!selectedCodocsUuid.value
  return !!repoPreview.value
})

function handleConfirm() {
  if (!canConfirm.value) return
  if (isCodocsTab.value) {
    const doc = activeCodocsDocuments.value.find(d => d.uuid === selectedCodocsUuid.value)
      || deptDocuments.value.find(d => d.uuid === selectedCodocsUuid.value)
      || portfolioDocuments.value.find(d => d.uuid === selectedCodocsUuid.value)
    if (!doc && !codocsPreview.value) return
    emit('select', {
      source: 'codocs',
      title: doc?.title || codocsPreview.value?.title || '',
      codocsUuid: selectedCodocsUuid.value
    })
  } else {
    if (!repoPreview.value) return
    emit('select', {
      source: 'repo',
      title: repoPreview.value.name,
      repoProjectCode: selectedRepoCode.value,
      repoFilePath: repoPreview.value.path,
      repoCommitId: props.mode === 'snapshot' ? repoPreview.value.commit_id : null
    })
  }
  emit('update:open', false)
}

function handleClose() {
  emit('update:open', false)
}

// 分组：仓库文件按顶级目录分组
const groupedRepoFiles = computed(() => {
  const groups = new Map<string, RepoDocFile[]>()
  for (const f of filteredRepoFiles.value) {
    const dir = f.path.includes('/') ? (f.path.split('/').slice(0, -1).join('/') + '/') : '(根目录)'
    const list = groups.get(dir) || []
    list.push(f)
    groups.set(dir, list)
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
})

// 下拉开关
const dropdownOpen = ref(false)

// 触发按钮显示：当前选中的标题/路径
const triggerLabel = computed(() => {
  if (isCodocsTab.value) {
    if (!selectedCodocsUuid.value) return '选择文档...'
    return codocsPreview.value?.title
      || activeCodocsDocuments.value.find(d => d.uuid === selectedCodocsUuid.value)?.title
      || '选择文档...'
  }
  return repoPreview.value ? repoPreview.value.path : '选择文档...'
})
const hasSelection = computed(() => {
  if (isCodocsTab.value) return !!selectedCodocsUuid.value
  return !!repoPreview.value
})

// 选中后关闭下拉
function onCodocsPicked(uuid: string) {
  selectCodocsDoc(uuid)
  dropdownOpen.value = false
}
async function onRepoFilePicked(file: RepoDocFile) {
  await selectRepoFile(file)
  dropdownOpen.value = false
}
</script>

<template>
  <UModal :open="open" :ui="{ content: 'sm:max-w-4xl', body: 'overflow-hidden p-0' }" @update:open="emit('update:open', $event)">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-file-search" class="size-5 text-primary" />
        <span class="font-semibold">{{ title }}</span>
      </div>
    </template>
    <template #body>
      <div class="p-4 space-y-4">
        <!-- 来源切换 -->
        <div v-if="sourceOptions.length > 1" class="flex items-center gap-3">
          <span class="text-sm text-muted shrink-0">来源：</span>
          <div class="flex gap-1">
            <UButton
              v-for="opt in sourceOptions"
              :key="opt.value"
              :label="opt.label"
              :color="(sourceTab === opt.value ? 'primary' : 'neutral') as any"
              :variant="sourceTab === opt.value ? 'soft' : 'ghost'"
              size="xs"
              :disabled="opt.disabled"
              @click="sourceTab = opt.value"
            />
          </div>
          <span v-if="mode === 'snapshot' && sourceTab === 'repo'" class="text-xs text-dimmed ml-2">
            选中时将记录 commit_id（版本快照）
          </span>
          <span v-else-if="sourceTab === 'codocs_portfolio' && portfolioGitGroup" class="text-xs text-dimmed ml-2">
            项目集 GitLab 群组：{{ portfolioGitGroup }}
          </span>
        </div>

        <!-- 仓库选择（多仓库时显示） -->
        <div v-if="sourceTab === 'repo' && repos.length > 1" class="flex items-center gap-2">
          <span class="text-sm text-muted shrink-0">仓库：</span>
          <USelect
            v-model="selectedRepoCode"
            :items="repos.map(r => ({ label: r.repoProjectCode, value: r.repoProjectCode }))"
            size="sm"
            class="flex-1"
          />
        </div>

        <!-- 文档选择下拉（trigger 宽度匹配 content） -->
        <UPopover
          v-model:open="dropdownOpen"
          :content="{ align: 'start', sideOffset: 4 }"
          :ui="{ content: 'w-(--reka-popper-anchor-width)' }"
        >
          <UButton
            variant="outline"
            color="neutral"
            class="w-full justify-between font-normal"
            trailing-icon="i-lucide-chevron-down"
          >
            <span class="flex items-center gap-2 min-w-0">
              <UIcon
                :name="hasSelection ? 'i-lucide-file-text' : 'i-lucide-file-search'"
                class="size-4 shrink-0"
                :class="hasSelection ? 'text-primary' : 'text-muted'"
              />
              <span class="truncate" :class="hasSelection ? '' : 'text-dimmed'">
                {{ triggerLabel }}
              </span>
            </span>
          </UButton>

          <template #content>
            <div class="flex flex-col">
              <!-- 部门文档 / 项目组文档（两种 codocs 来源共用树展示） -->
              <div v-if="isCodocsTab" class="p-1">
                <div v-if="sourceTab === 'codocs_portfolio' && !portfolioGitGroup && !activeCodocsLoading" class="text-center py-6 text-sm text-muted px-2">
                  项目未绑定项目集或项目集未设置 GitLab 群组
                </div>
                <ProjectProposalDocumentTree
                  v-else
                  :folders="activeCodocsFolders"
                  :documents="activeCodocsDocuments"
                  :selected-uuid="selectedCodocsUuid"
                  :loading="activeCodocsLoading"
                  @select="onCodocsPicked"
                />
              </div>

              <!-- 项目仓库文档 -->
              <div v-else class="flex flex-col">
                <div class="p-2 border-b border-default">
                  <UInput
                    v-model="repoSearch"
                    icon="i-lucide-search"
                    size="sm"
                    placeholder="按路径搜索..."
                    :ui="{ base: 'w-full' }"
                  />
                </div>
                <div class="max-h-72 overflow-y-auto">
                  <div v-if="repoLoading" class="flex items-center justify-center py-6 text-muted">
                    <UIcon name="i-lucide-loader-2" class="size-4 animate-spin mr-2" />
                    加载中...
                  </div>
                  <div v-else-if="!repoTree || repoTree.files.length === 0" class="text-center py-6 text-sm text-muted">
                    仓库中未找到 docs/ 目录下的 Markdown 文档
                  </div>
                  <div v-else-if="filteredRepoFiles.length === 0" class="text-center py-6 text-sm text-muted">
                    未找到匹配文档
                  </div>
                  <div v-else class="py-1 text-sm">
                    <template v-for="[dir, files] in groupedRepoFiles" :key="dir">
                      <div class="px-2 py-1 text-xs text-dimmed bg-elevated/40 flex items-center gap-1.5">
                        <UIcon name="i-lucide-folder" class="size-3.5" />
                        {{ dir }}
                      </div>
                      <button
                        v-for="f in files"
                        :key="f.path"
                        type="button"
                        class="w-full flex items-center gap-2 px-4 py-1.5 text-left transition-colors"
                        :class="repoPreview?.path === f.path ? 'bg-primary-50 text-primary dark:bg-primary-950/40' : 'hover:bg-elevated/60'"
                        @click="onRepoFilePicked(f)"
                      >
                        <UIcon name="i-lucide-file-text" class="size-4 shrink-0" :class="repoPreview?.path === f.path ? 'text-primary' : 'text-info'" />
                        <span class="truncate">{{ f.name }}</span>
                        <UIcon
                          v-if="repoPreview?.path === f.path"
                          name="i-lucide-check"
                          class="size-4 text-primary ml-auto"
                        />
                      </button>
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </UPopover>

        <!-- 仓库分支/HEAD 提示（快照模式） -->
        <div v-if="sourceTab === 'repo' && repoTree && mode === 'snapshot'" class="text-xs text-dimmed">
          当前分支 {{ repoTree.ref }} · HEAD {{ repoTree.head_commit_id ? repoTree.head_commit_id.slice(0, 8) : '-' }}
        </div>

        <!-- 预览 -->
        <div class="rounded-lg border border-default bg-elevated/40 p-3 h-[60vh] min-h-96">
          <div v-if="isCodocsTab" class="h-full">
            <div v-if="codocsPreview" class="h-full">
              <CodocsPreview :key="codocsPreview.uuid" :uuid="codocsPreview.uuid" />
            </div>
            <div v-else class="flex items-center justify-center h-full text-sm text-muted">
              选中文档后将在这里预览
            </div>
          </div>
          <div v-else class="h-full">
            <div v-if="repoPreviewLoading" class="flex items-center justify-center h-full text-muted">
              <UIcon name="i-lucide-loader-2" class="size-5 animate-spin" />
            </div>
            <div v-else-if="repoPreview" class="h-full overflow-y-auto">
              <div class="flex items-center gap-2 mb-2 text-xs text-muted font-mono">
                <UIcon name="i-lucide-file-text" class="size-3.5" />
                <span>{{ repoPreview.path }}</span>
                <span v-if="mode === 'snapshot'" class="ml-auto">@ {{ repoPreview.commit_id.slice(0, 8) }}</span>
              </div>
              <MarkdownContent :markdown="repoPreview.content" />
            </div>
            <div v-else class="flex items-center justify-center h-full text-sm text-muted">
              选中文档后将在这里预览
            </div>
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="取消"
          color="neutral"
          variant="ghost"
          @click="handleClose"
        />
        <UButton
          :label="confirmLabel"
          color="primary"
          :disabled="!canConfirm"
          @click="handleConfirm"
        />
      </div>
    </template>
  </UModal>
</template>
