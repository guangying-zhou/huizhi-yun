# 模态窗口最终修复

## 问题

提交审阅模态窗口无法正确打开。

## 根本原因

没有完全遵循项目中现有模态窗口的使用模式。

## 正确的使用模式（参考 ShareDocumentModal）

### 1. 在页面中的状态定义

```typescript
// Share Modal State
const isShareModalOpen = ref(false);
const sharingDocId = ref<string>("");
const sharingDocTitle = ref("");

const openShareModal = (doc: any) => {
  sharingDocId.value = doc.uuid;
  sharingDocTitle.value = doc.title;
  isShareModalOpen.value = true;
};
```

### 2. 在模板中的使用

```vue
<DocumentShareDocumentModal
  :open="isShareModalOpen"
  :doc-id="sharingDocId"
  :doc-title="sharingDocTitle"
  @update:open="isShareModalOpen = $event"
/>
```

### 关键点

1. ✅ **不使用 `v-if` 条件** - 组件始终存在
2. ✅ **不使用 `v-model:open`** - 分开写 `:open` 和 `@update:open`
3. ✅ **使用可选链或默认值** - `:document-uuid="reviewingDoc?.uuid || ''"`
4. ✅ **组件内部验证** - 在提交前检查必需的 props

## 最终修复

### departments/coworks.vue 和 git_projects/index.vue

**修复前：**

```vue
<ReviewSubmitReviewModal
  v-if="reviewingDoc && showSubmitReviewModal"
  :open="showSubmitReviewModal"
  @update:open="showSubmitReviewModal = $event"
  :document-uuid="reviewingDoc.uuid"
  @success="..."
/>
```

**修复后：**

```vue
<ReviewSubmitReviewModal
  :open="showSubmitReviewModal"
  @update:open="showSubmitReviewModal = $event"
  :document-uuid="reviewingDoc?.uuid || ''"
  @success="
    () => {
      showSubmitReviewModal = false;
      reviewingDoc = null;
      refreshDocs();
    }
  "
/>
```

### SubmitReviewModal.vue

**添加了验证：**

```typescript
const handleSubmit = async () => {
  if (!template.value) return;
  if (!props.documentUuid) {
    toast.add({
      title: "错误",
      description: "文档信息缺失",
      color: "red",
    });
    return;
  }
  // ... 提交逻辑
};
```

## 对比分析

| 特性       | 错误做法                                       | 正确做法                     |
| ---------- | ---------------------------------------------- | ---------------------------- |
| 条件渲染   | `v-if="reviewingDoc && showSubmitReviewModal"` | 无 `v-if`，组件始终存在      |
| 双向绑定   | `v-model:open`                                 | `:open` + `@update:open`     |
| Props 传递 | `reviewingDoc.uuid`                            | `reviewingDoc?.uuid \|\| ''` |
| 组件验证   | 无                                             | 提交前验证 `documentUuid`    |

## 为什么这样做？

1. **不使用 v-if**
   - 避免组件频繁创建和销毁
   - 保持组件状态稳定
   - 与项目中其他模态窗口保持一致

2. **分开写 :open 和 @update:open**
   - 更明确的数据流
   - 更容易调试
   - 符合项目约定

3. **使用可选链**
   - 防止访问 null/undefined 的属性
   - 提供默认值作为后备
   - 更安全的代码

4. **组件内部验证**
   - 防御性编程
   - 提供友好的错误提示
   - 避免无效的 API 调用

## 测试清单

- [x] 移除 `v-if` 条件
- [x] 使用 `:open` + `@update:open` 而不是 `v-model:open`
- [x] 使用可选链 `reviewingDoc?.uuid`
- [x] 添加默认值 `|| ''`
- [x] 组件内部添加验证
- [x] 所有文件通过诊断检查
- [x] 与 ShareDocumentModal 使用模式一致

## 结果

✅ 模态窗口现在应该可以正常打开
✅ 符合项目现有的代码风格
✅ 更安全和健壮的实现
