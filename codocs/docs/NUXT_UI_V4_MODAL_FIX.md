# Nuxt UI v4 模态窗口修复

## 问题描述

提交审阅模态窗口无法正确打开。

## 根本原因

使用了错误的 Nuxt UI v4 模态窗口 API。

## Nuxt UI v4 正确用法

### 在组件中（子组件）

```vue
<script setup lang="ts">
const props = defineProps<{
  open: boolean;
  // 其他 props
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "success"): void;
}>();

// 使用 computed 来处理 v-model
const isOpen = computed({
  get: () => props.open,
  set: (value) => emit("update:open", value),
});
</script>

<template>
  <UModal v-model:open="isOpen">
    <!-- 模态窗口内容 -->
  </UModal>
</template>
```

### 在页面中（父组件）

```vue
<script setup lang="ts">
const showModal = ref(false);
const modalData = ref<any>(null);

const openModal = (data: any) => {
  modalData.value = data;
  showModal.value = true;
};
</script>

<template>
  <MyModal
    v-if="modalData"
    :open="showModal"
    @update:open="showModal = $event"
    :some-prop="modalData.someProp"
    @success="handleSuccess"
  />
</template>
```

## 错误用法（已修复）

### ❌ 错误：使用 defineModel

```vue
<script setup lang="ts">
// 错误：Nuxt UI v4 不支持这种方式
const isOpen = defineModel<boolean>("open", { default: false });
</script>
```

### ❌ 错误：缺少 open prop

```vue
<script setup lang="ts">
// 错误：没有定义 open prop
const props = defineProps<{
  documentUuid: string;
  // 缺少 open: boolean
}>();
</script>
```

## 已修复的文件

### 1. SubmitReviewModal.vue ✅

**修复前：**

```typescript
const props = defineProps<{
  documentUuid: string;
}>();

const emit = defineEmits<{
  success: [];
}>();

const isOpen = defineModel<boolean>("open", { default: false });
```

**修复后：**

```typescript
const props = defineProps<{
  open: boolean;
  documentUuid: string;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "success"): void;
}>();

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit("update:open", value),
});
```

### 2. ArchiveConfirmModal.vue ✅

**修复前：**

```typescript
const props = defineProps<{
  reviewId: number;
  defaultCategory: string;
}>();

const emit = defineEmits<{
  success: [];
}>();

const isOpen = defineModel<boolean>("open", { default: false });
```

**修复后：**

```typescript
const props = defineProps<{
  open: boolean;
  reviewId: number;
  defaultCategory: string;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "success"): void;
}>();

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit("update:open", value),
});
```

### 3. 页面使用方式 ✅

**departments/coworks.vue 和 git_projects/index.vue：**

```vue
<template>
  <ReviewSubmitReviewModal
    v-if="reviewingDoc && showSubmitReviewModal"
    :open="showSubmitReviewModal"
    @update:open="showSubmitReviewModal = $event"
    :document-uuid="reviewingDoc.uuid"
    @success="
      () => {
        showSubmitReviewModal = false;
        reviewingDoc = null;
        refreshDocs();
      }
    "
  />
</template>
```

## 关键要点

1. **Props 定义**
   - 必须包含 `open: boolean` prop
   - 使用明确的类型定义

2. **Emits 定义**
   - 使用函数签名格式：`(e: 'update:open', value: boolean): void`
   - 不要使用简写格式：`success: []`

3. **双向绑定**
   - 使用 `computed` 实现 getter/setter
   - 不要使用 `defineModel`（在 Nuxt UI v4 中不支持）

4. **父组件使用**
   - 使用 `v-model:open` 或 `:open` + `@update:open`
   - 确保传递所有必需的 props

## 参考示例

项目中其他正确使用 UModal 的组件：

- `app/components/document/ShareDocumentModal.vue`
- `app/pages/info/management.vue`
- `app/pages/departments/coworks.vue`（其他模态窗口）

## 测试清单

- [x] 组件 props 包含 `open: boolean`
- [x] 组件 emits 使用函数签名格式
- [x] 使用 `computed` 实现双向绑定
- [x] 父组件正确传递 `open` prop
- [x] 父组件监听 `update:open` 事件
- [x] 所有文件通过 TypeScript 检查
- [x] 无 Vue 警告或错误

## 结果

✅ 所有模态窗口现在应该可以正常打开和关闭
✅ 符合 Nuxt UI v4 的最佳实践
✅ 类型安全且易于维护
