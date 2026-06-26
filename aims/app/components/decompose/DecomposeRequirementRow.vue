<script setup lang="ts">
/* eslint-disable vue/no-mutating-props */
/**
 * 需求分解页的"需求行"组件（target candidate）
 *
 * 展示一个 target 候选（分类模式下是 H3，平铺模式下是 H2），
 * 包含：勾选框、拆分/直转切换、优先级、子任务列表与打包操作。
 *
 * 注：该组件故意通过 prop 直接修改 node 的内部字段——整棵大纲树是父页面持有的
 * 响应式状态容器，所有行节点共享同一个可变树。禁用 vue/no-mutating-props 规则是刻意的。
 */
import type { UiNode, DeliverableType } from '~/types/decompose'

const props = withDefaults(defineProps<{
  node: UiNode
  defaultDeliverableType: DeliverableType
  expandable?: boolean
}>(), {
  expandable: false
})

const emit = defineEmits<{
  (e: 'toggle-pack'): void
  (e: 'unpack', bundleId: string): void
  (e: 'child-change', child: UiNode): void
}>()

// 正文展开状态（组件本地，不污染 UiNode）
const expanded = ref(false)
const childExpanded = ref<Set<string>>(new Set())

function toggleExpand(event: Event) {
  if (!props.expandable) return
  event.stopPropagation()
  expanded.value = !expanded.value
}

function toggleChildExpand(key: string, event: Event) {
  if (!props.expandable) return
  event.stopPropagation()
  if (childExpanded.value.has(key)) {
    childExpanded.value.delete(key)
  } else {
    childExpanded.value.add(key)
  }
  // 触发响应式更新
  childExpanded.value = new Set(childExpanded.value)
}

// 初始化：根据默认值设置 deliverableType
onMounted(() => {
  props.node.deliverableType = props.defaultDeliverableType
  // 同步给子节点
  for (const c of props.node.children) {
    c.deliverableType = props.defaultDeliverableType
  }
})

watch(() => props.defaultDeliverableType, (newType) => {
  props.node.deliverableType = newType
  for (const c of props.node.children) {
    c.deliverableType = newType
  }
})

const subHeadingDepth = computed(() => (props.node.depth + 1) as 3 | 4)
const subHeadings = computed(() =>
  props.node.children.filter(c => c.depth === subHeadingDepth.value)
)

const hasSubHeadings = computed(() => subHeadings.value.length > 0)

// 规则 1：没有子标题 → 永远强制"直转"
watch(hasSubHeadings, (has) => {
  if (!has) props.node.targetMode = 'direct'
}, { immediate: true })

// 规则 2：H2 从未勾选变成勾选，且此时没有任何子项被勾 → 默认"直转"
watch(() => props.node.selected, (now, was) => {
  if (!now || was) return
  if (!hasSubHeadings.value) return // 规则 1 已处理
  const anyChildSelected = subHeadings.value.some(c => c.selected && !c.locked)
  if (!anyChildSelected) {
    props.node.targetMode = 'direct'
  }
})

// 规则 3：子项被勾选时（无论是直接点还是级联），若父级处于"直转"则自动切回"拆分"
const anyChildSelectedComputed = computed(
  () => subHeadings.value.some(c => c.selected && !c.locked)
)
watch(anyChildSelectedComputed, (now, was) => {
  if (now && !was && props.node.targetMode === 'direct' && hasSubHeadings.value) {
    props.node.targetMode = 'split'
  }
})

// 分组展示的 bundle
interface BundleGroup {
  bundleId: string | null
  items: UiNode[]
}

const bundleGroups = computed<BundleGroup[]>(() => {
  const groups: BundleGroup[] = []
  for (const c of subHeadings.value) {
    if (c.packBundleId) {
      const existing = groups.find(g => g.bundleId === c.packBundleId)
      if (existing) {
        existing.items.push(c)
        continue
      }
    }
    groups.push({ bundleId: c.packBundleId, items: [c] })
  }
  return groups
})

// 只统计"已勾选且还没被合并进任何 bundle"的子项
// 已经在合并束里的不能再次参与合并
const selectedChildCount = computed(() =>
  subHeadings.value.filter(c => c.selected && !c.locked && !c.packBundleId).length
)

function togglePack() {
  emit('toggle-pack')
}

function unpack(bundleId: string) {
  emit('unpack', bundleId)
}

function onChildSelect(child: UiNode) {
  emit('child-change', child)
}
</script>

<template>
  <div class="space-y-2">
    <!-- 需求本行 -->
    <div
      class="flex items-center gap-2 rounded-lg border border-default px-3 py-2"
      :class="{
        'bg-elevated/50 opacity-60': node.locked,
        'bg-primary/5 border-primary/30': node.selected && !node.locked
      }"
    >
      <UCheckbox
        v-if="!node.locked"
        v-model="node.selected"
      />
      <UIcon v-else name="i-lucide-lock" class="size-4 text-warning" />

      <button
        v-if="expandable"
        class="shrink-0 p-0.5 rounded hover:bg-muted"
        type="button"
        @click="toggleExpand"
      >
        <UIcon
          :name="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="size-3.5 text-muted"
        />
      </button>

      <!-- <span class="font-mono text-xs text-muted shrink-0">{{ depthLabel(node.depth) }}</span> -->
      <span
        class="flex-1 text-sm font-medium"
        :class="{ 'cursor-pointer hover:text-primary': expandable }"
        @click="toggleExpand"
      >{{ node.title }}</span>

      <UBadge
        v-if="node.locked"
        color="warning"
        variant="subtle"
        size="xs"
      >
        已分解 · {{ node.lockedWorkItemKey }}
      </UBadge>

      <template v-if="!node.locked && node.selected">
        <!-- 拆分 / 直转 单选（优先级和交付物类型在右栏预览中编辑） -->
        <URadioGroup
          v-model="node.targetMode"
          :items="[
            { label: '拆分开发任务', value: 'split', disabled: !hasSubHeadings },
            { label: '直转开发任务', value: 'direct' }
          ]"
          orientation="horizontal"
          :ui="{ label: 'text-xs', fieldset: 'gap-3' }"
        />
      </template>
    </div>

    <!-- 章节正文展开 -->
    <MarkdownContent
      v-if="expandable && expanded"
      :markdown="node.bodyMarkdown"
      class="ml-6 mr-2 p-3 rounded border border-dashed border-default bg-elevated/40 text-xs"
    />

    <!-- 子任务列表：始终显示，不因为父级未勾选而隐藏 -->
    <!-- 用户可直接勾选子项，父级会通过 child-change 事件级联勾选 -->
    <div
      v-if="!node.locked && node.targetMode === 'split' && hasSubHeadings"
      class="ml-6 space-y-1"
    >
      <template v-for="group in bundleGroups" :key="group.bundleId || group.items[0]?.key">
        <!-- 未打包的单项 -->
        <div
          v-if="!group.bundleId && group.items.length === 1"
          class="space-y-1"
        >
          <div
            class="flex items-center gap-2 rounded border border-dashed border-default px-3 py-1.5"
            :class="{
              'bg-elevated/50 opacity-60': group.items[0]!.locked,
              'bg-primary/5': group.items[0]!.selected && !group.items[0]!.locked
            }"
          >
            <UCheckbox
              v-if="!group.items[0]!.locked"
              v-model="group.items[0]!.selected"
              @update:model-value="onChildSelect(group.items[0]!)"
            />
            <UIcon v-else name="i-lucide-lock" class="size-4 text-warning" />
            <button
              v-if="expandable"
              class="shrink-0 p-0.5 rounded hover:bg-muted"
              type="button"
              @click="(e: MouseEvent) => toggleChildExpand(group.items[0]!.key, e)"
            >
              <UIcon
                :name="childExpanded.has(group.items[0]!.key) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                class="size-3 text-muted"
              />
            </button>
            <!-- <span class="font-mono text-xs text-muted">{{ depthLabel(group.items[0]!.depth) }}</span> -->
            <span
              class="flex-1 text-sm"
              :class="{ 'cursor-pointer hover:text-primary': expandable }"
              @click="(e: MouseEvent) => toggleChildExpand(group.items[0]!.key, e)"
            >{{ group.items[0]!.title }}</span>
            <UBadge
              v-if="group.items[0]!.locked"
              color="warning"
              variant="subtle"
              size="xs"
            >
              已分解 · {{ group.items[0]!.lockedWorkItemKey }}
            </UBadge>
          </div>
          <MarkdownContent
            v-if="expandable && childExpanded.has(group.items[0]!.key)"
            :markdown="group.items[0]!.bodyMarkdown"
            class="ml-8 mr-2 p-2 rounded border border-dashed border-default bg-elevated/40 text-xs"
          />
        </div>

        <!-- 打包束 -->
        <div
          v-else-if="group.bundleId"
          class="rounded border border-info/40 bg-info/5 px-3 py-2"
        >
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-package" class="size-4 text-info" />
            <span class="text-sm font-medium">
              合并开发任务（{{ group.items.length }} 项）
            </span>
            <div class="flex-1" />
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-split"
              @click="unpack(group.bundleId!)"
            >
              拆分
            </UButton>
          </div>
          <div class="mt-1.5 ml-6 space-y-0.5 text-xs text-muted">
            <div v-for="it in group.items" :key="it.key">
              — {{ it.title }}
            </div>
          </div>
        </div>
      </template>

      <div v-if="selectedChildCount >= 2" class="pt-1">
        <UButton
          color="info"
          variant="soft"
          size="xs"
          icon="i-lucide-package-plus"
          @click="togglePack"
        >
          合并所选为一个开发任务（{{ selectedChildCount }} 项）
        </UButton>
      </div>
    </div>

    <!-- 直转开发任务提示 -->
    <div
      v-if="!node.locked && node.selected && node.targetMode === 'direct'"
      class="ml-6 text-xs text-muted"
    >
      将直接生成一个开发任务（在右栏预览里配置优先级与交付物类型）
    </div>
  </div>
</template>
