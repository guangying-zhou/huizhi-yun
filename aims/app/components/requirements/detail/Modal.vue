<script setup lang="ts">
const props = defineProps<{
  reqId: number
}>()

const emit = defineEmits<{
  close: []
}>()

const open = ref(true)
const loading = ref(true)

interface RequirementDetail {
  id: number
  itemKind: 'baseline' | 'change'
  parentRequirementId: number | null
  changeNo: number | null
  changeReason: string | null
  reqCode: string
  title: string
  type: string
  category: string | null
  priority: string
  source: string
  scopeNote: string | null
  milestoneName: string | null
  status: string
  currentVersion: number
  baselinedAt: string | null
  createdBy: string
  createdAt: string
  parentRequirement: {
    id: number
    reqCode: string
    title: string
  } | null
  contents: {
    id: number
    parentId: number | null
    sourceParentId?: number | null
    title: string
    headingDepth: number
    sortOrder: number
    status: string
    contentMd: string | null
  }[]
  contextModules?: {
    id: number
    title: string
    headingDepth: number
    sortOrder: number
    contentMd: string | null
  }[]
}

const req = ref<RequirementDetail | null>(null)
const { users: accountUsers } = useAccountUsers()
const changeDiff = ref<{
  requirement: {
    id: number
    reqCode: string
    title: string
    parentReqCode: string
    parentTitle: string
  }
  items: {
    contentOriginalId: number
    diffStatus: 'changed' | 'unchanged' | 'added'
    base: { id: number, title: string | null, contentMd: string | null, versionNo: number | null } | null
    change: { id: number, title: string, contentMd: string | null, versionNo: number }
  }[]
} | null>(null)

type DisplayContentNode = {
  id: number
  title: string
  headingDepth: number
  sortOrder: number
  status: string
  contentMd: string | null
  sourceParentId?: number | null
  children: DisplayContentNode[]
}

const contentRoots = computed<DisplayContentNode[]>(() => {
  const contents = req.value?.contents || []
  const contextModules = req.value?.contextModules || []
  const nodeMap = new Map<number, DisplayContentNode>()
  const directRoots: DisplayContentNode[] = []
  const displayRoots: DisplayContentNode[] = []
  const contextModuleMap = new Map<number, DisplayContentNode>()

  for (const content of contents) {
    nodeMap.set(content.id, { ...content, children: [] })
  }
  for (const module of contextModules) {
    contextModuleMap.set(module.id, {
      id: module.id,
      title: module.title,
      headingDepth: module.headingDepth,
      sortOrder: module.sortOrder,
      status: 'imported',
      contentMd: module.contentMd,
      children: []
    })
  }

  for (const content of contents) {
    const node = nodeMap.get(content.id)
    if (!node) continue

    const parent = content.parentId ? nodeMap.get(content.parentId) : null
    if (parent) {
      parent.children.push(node)
    } else {
      directRoots.push(node)
    }
  }

  for (const root of directRoots) {
    const sourceParentId = root.sourceParentId
    if (sourceParentId && contextModuleMap.has(sourceParentId)) {
      contextModuleMap.get(sourceParentId)!.children.push(root)
    } else {
      displayRoots.push(root)
    }
  }

  const contextRoots = [...contextModuleMap.values()]
    .filter(module => module.children.length > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)

  return [...contextRoots, ...displayRoots].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
})

function markdownHeading(title: string, depth: number): string {
  const level = Math.min(6, Math.max(1, depth || 3))
  return `${'#'.repeat(level)} ${title}`
}

function nestedContentMarkdown(node: DisplayContentNode): string {
  const parts: string[] = []
  if (node.contentMd?.trim()) {
    parts.push(node.contentMd.trim())
  }

  for (const child of node.children) {
    const childParts = [markdownHeading(child.title, child.headingDepth)]
    const childBody = nestedContentMarkdown(child)
    if (childBody) childParts.push(childBody)
    parts.push(childParts.join('\n\n'))
  }

  return parts.join('\n\n')
}

const statusLabel: Record<string, string> = {
  draft: '草稿',
  in_review: '评审中',
  baselined: '已基线',
  change_pending: '变更中',
  deprecated: '已废弃'
}

const statusColor: Record<string, string> = {
  draft: 'neutral',
  in_review: 'warning',
  baselined: 'success',
  change_pending: 'info',
  deprecated: 'error'
}

const sourceLabel: Record<string, string> = {
  customer: '客户',
  internal: '内部',
  compliance: '合规',
  regulation: '法规',
  other: '其他'
}

const accountUserNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const user of accountUsers.value) {
    map.set(user.uid, user.realName?.trim() || user.nickname?.trim() || user.uid)
  }
  return map
})

function getUserName(uid: string | null | undefined) {
  if (!uid) return '-'
  return accountUserNameMap.value.get(uid) || uid
}

async function fetchDetail() {
  loading.value = true
  try {
    const res = await $fetch<{ code: number, data: RequirementDetail }>(
      `/api/v1/requirements/${props.reqId}`
    )
    if (res.code === 0) {
      req.value = res.data
      if (res.data.itemKind === 'change') {
        const diffRes = await $fetch<{ code: number, data: NonNullable<typeof changeDiff.value> }>(
          `/api/v1/requirements/${props.reqId}/change-diff`
        )
        if (diffRes.code === 0) {
          changeDiff.value = diffRes.data
        }
      } else {
        changeDiff.value = null
      }
    }
  } finally {
    loading.value = false
  }
}

watch(open, (value) => {
  if (!value) emit('close')
})

onMounted(fetchDetail)
</script>

<template>
  <UModal
    v-model:open="open"
    :ui="{ content: 'sm:max-w-5xl', body: 'max-h-[75vh] overflow-y-auto' }"
  >
    <template #header>
      <div class="flex items-start justify-between gap-4 w-full">
        <div class="min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span
              v-if="req"
              class="font-mono text-xs text-muted"
            >
              {{ req.reqCode }}
            </span>
            <UBadge
              v-if="req"
              :color="(statusColor[req.status] as any)"
              variant="subtle"
              size="xs"
            >
              {{ statusLabel[req.status] || req.status }}
            </UBadge>
            <UBadge
              v-if="req"
              color="neutral"
              variant="outline"
              size="xs"
            >
              {{ req.priority }}
            </UBadge>
            <span
              v-if="req && req.currentVersion > 0"
              class="text-xs text-muted"
            >
              v{{ req.currentVersion }}
            </span>
          </div>
          <h2 class="text-base font-semibold truncate">
            {{ req?.title || '加载中...' }}
          </h2>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="open = false"
        />
      </div>
    </template>

    <template #body>
      <div
        v-if="loading"
        class="flex justify-center py-12"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="size-6 animate-spin text-muted"
        />
      </div>

      <template v-else-if="req">
        <div class="flex min-w-0 flex-col gap-6 lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside class="shrink-0 space-y-3 text-sm lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            <div>
              <div class="text-xs text-muted mb-1">
                类别
              </div>
              <div>{{ req.itemKind === 'change' ? '需求变更' : '基线需求' }}</div>
            </div>
            <div v-if="req.itemKind === 'change' && req.parentRequirement">
              <div class="text-xs text-muted mb-1">
                原需求
              </div>
              <div class="text-xs leading-5">
                <span class="font-mono text-muted">{{ req.parentRequirement.reqCode }}</span>
                <span class="ml-1">{{ req.parentRequirement.title }}</span>
              </div>
            </div>
            <div v-if="req.itemKind === 'change' && req.changeReason">
              <div class="text-xs text-muted mb-1">
                变更原因
              </div>
              <div class="text-xs leading-5 text-warning">
                {{ req.changeReason }}
              </div>
            </div>
            <div>
              <div class="text-xs text-muted mb-1">
                类型
              </div>
              <div>{{ req.type === 'functional' ? '功能需求' : '非功能需求' }}</div>
            </div>
            <div>
              <div class="text-xs text-muted mb-1">
                来源
              </div>
              <div>{{ sourceLabel[req.source] || req.source }}</div>
            </div>
            <div>
              <div class="text-xs text-muted mb-1">
                里程碑
              </div>
              <div>{{ req.milestoneName || '-' }}</div>
            </div>
            <div v-if="req.scopeNote">
              <div class="text-xs text-muted mb-1">
                范围说明
              </div>
              <div class="text-xs leading-5 text-warning">
                {{ req.scopeNote }}
              </div>
            </div>
            <div>
              <div class="text-xs text-muted mb-1">
                首次基线
              </div>
              <div>{{ req.baselinedAt ? req.baselinedAt.slice(0, 10) : '-' }}</div>
            </div>
            <div>
              <div class="text-xs text-muted mb-1">
                创建人
              </div>
              <div>{{ getUserName(req.createdBy) }}</div>
            </div>
            <div>
              <div class="text-xs text-muted mb-1">
                创建时间
              </div>
              <div>{{ req.createdAt?.slice(0, 16) || '-' }}</div>
            </div>
          </aside>

          <section class="min-w-0 flex flex-col">
            <div class="mb-3 flex shrink-0 items-center justify-between gap-3">
              <h3 class="text-sm font-semibold">
                {{ req.itemKind === 'change' ? '变更内容' : '需求内容' }}
              </h3>
              <span class="text-xs text-muted">
                {{ req.itemKind === 'change' ? `${changeDiff?.items.length || 0} 个变更项` : `${req.contents.length} 个章节` }}
              </span>
            </div>

            <div
              v-if="req.itemKind === 'baseline' && req.contents.length === 0"
              class="text-center text-muted py-12 rounded border border-dashed border-default"
            >
              未关联规格书内容
            </div>

            <div
              v-else-if="req.itemKind === 'baseline'"
              class="max-h-[calc(100dvh-22rem)] min-h-[240px] space-y-4 overflow-y-auto pr-2"
            >
              <article
                v-for="content in contentRoots"
                :key="content.id"
                class="rounded-lg border border-default overflow-hidden"
              >
                <div class="flex items-center gap-2 px-4 py-3 bg-elevated/40">
                  <UBadge
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  >
                    H{{ content.headingDepth }}
                  </UBadge>
                  <h4 class="font-medium text-sm">
                    {{ content.title }}
                  </h4>
                  <UBadge
                    v-if="content.status === 'modified'"
                    color="warning"
                    variant="subtle"
                    size="xs"
                  >
                    已修改
                  </UBadge>
                </div>
                <div class="p-4">
                  <MarkdownContent
                    v-if="nestedContentMarkdown(content)"
                    :markdown="nestedContentMarkdown(content)"
                  />
                  <div
                    v-else
                    class="text-sm text-muted italic"
                  >
                    暂无内容
                  </div>
                </div>
              </article>
            </div>

            <div
              v-else-if="changeDiff && changeDiff.items.length > 0"
              class="max-h-[calc(100dvh-22rem)] min-h-[240px] space-y-4 overflow-y-auto pr-2"
            >
              <div
                v-for="item in changeDiff.items"
                :key="item.change.id"
                class="rounded border border-default overflow-hidden"
              >
                <details :open="item.diffStatus !== 'unchanged'">
                  <summary class="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer bg-elevated/40">
                    <UBadge
                      :color="item.diffStatus === 'unchanged' ? 'neutral' : item.diffStatus === 'added' ? 'info' : 'warning'"
                      variant="subtle"
                      size="xs"
                    >
                      {{ item.diffStatus === 'unchanged' ? '未变化' : item.diffStatus === 'added' ? '新增' : '有变化' }}
                    </UBadge>
                    <span class="font-medium">{{ item.change.title }}</span>
                    <span class="text-muted">v{{ item.base?.versionNo || '-' }} → v{{ item.change.versionNo }}</span>
                  </summary>
                  <div class="grid grid-cols-1 xl:grid-cols-2 gap-3 p-3">
                    <div class="rounded border border-default p-3 bg-elevated/30">
                      <div class="text-xs font-semibold text-muted mb-2">
                        当前版本 v{{ item.base?.versionNo || '-' }} · {{ item.base?.title || '-' }}
                      </div>
                      <MarkdownContent
                        :markdown="item.base?.contentMd || '暂无内容'"
                      />
                    </div>
                    <div class="rounded border border-warning/30 p-3 bg-warning/5">
                      <div class="text-xs font-semibold text-warning mb-2">
                        变更版本 v{{ item.change.versionNo }} · {{ item.change.title }}
                      </div>
                      <MarkdownContent
                        :markdown="item.change.contentMd || '暂无内容'"
                      />
                    </div>
                  </div>
                </details>
              </div>
            </div>

            <div
              v-else
              class="text-center text-muted py-12 rounded border border-dashed border-default"
            >
              暂无变更内容
            </div>
          </section>
        </div>
      </template>
    </template>
  </UModal>
</template>
