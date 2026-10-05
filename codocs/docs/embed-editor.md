# Codocs 嵌入式编辑器

## 概述

Codocs 提供嵌入式文档编辑器，允许其他模块（aims、altoc、assets、workflow 等）通过 iframe 无缝集成 Milkdown 富文本编辑器，无需安装任何编辑器依赖。

```
其他模块页面
  ↓
<iframe src="https://codocs.wiztek.cn/embed/editor/:uuid" />
  ↓
Codocs 嵌入式编辑器（精简版，无导航栏/侧边栏）
```

## 快速开始

### 基础用法

```vue
<template>
  <iframe
    :src="`https://codocs.wiztek.cn/embed/editor/${docUuid}`"
    class="w-full h-full border-0"
    allow="clipboard-read; clipboard-write"
  />
</template>
```

### 只读预览

```vue
<iframe
  :src="`https://codocs.wiztek.cn/embed/editor/${docUuid}?readonly=1`"
  class="w-full h-full border-0"
/>
```

### 精简模式（无标题栏）

```vue
<iframe
  :src="`https://codocs.wiztek.cn/embed/editor/${docUuid}?title=0`"
  class="w-full h-full border-0"
/>
```

## URL 参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `readonly` | `0` \| `1` | `0` | 只读预览模式，禁用编辑和保存 |
| `toolbar` | `0` \| `1` | `1` | 是否显示编辑器工具栏 |
| `title` | `0` \| `1` | `1` | 是否显示顶部标题栏（文档名 + 保存状态） |

参数可组合使用：

```
/embed/editor/xxx?readonly=1&title=0    # 只读 + 无标题栏
/embed/editor/xxx?title=0               # 可编辑 + 无标题栏
```

## postMessage 通信

嵌入式编辑器通过 `window.postMessage` 与父页面通信，实现跨 iframe 交互。

### 父页面 → iframe

| 消息类型 | 说明 | 示例 |
|----------|------|------|
| `codocs:save` | 触发手动保存 | `iframe.contentWindow.postMessage({ type: 'codocs:save' }, '*')` |
| `codocs:getContent` | 获取当前编辑内容 | 编辑器回复 `codocs:content` 消息 |

### iframe → 父页面

| 消息类型 | 字段 | 说明 |
|----------|------|------|
| `codocs:ready` | `uuid` | 编辑器初始化完成，可以开始交互 |
| `codocs:change` | `uuid`, `content` | 编辑内容发生变化 |
| `codocs:saved` | `uuid` | 文档保存成功 |
| `codocs:content` | `uuid`, `content` | 响应 `getContent` 请求 |
| `codocs:error` | `uuid`, `message` | 发生错误（如文档加载失败） |

### 通信示例

```typescript
// 父页面：监听编辑器消息
window.addEventListener('message', (e) => {
  switch (e.data.type) {
    case 'codocs:ready':
      console.log('编辑器就绪:', e.data.uuid)
      break
    case 'codocs:change':
      console.log('内容变化:', e.data.content.length, '字符')
      break
    case 'codocs:saved':
      console.log('已保存')
      break
    case 'codocs:content':
      // 响应 getContent 请求
      const content = e.data.content
      break
  }
})

// 父页面：触发保存
const iframe = document.querySelector('iframe')
iframe.contentWindow.postMessage({ type: 'codocs:save' }, '*')

// 父页面：获取当前内容
iframe.contentWindow.postMessage({ type: 'codocs:getContent' }, '*')
```

## 功能特性

### 已支持

- Milkdown 富文本编辑器（完整 Markdown 语法）
- 代码高亮（CodeMirror）
- Mermaid 图表渲染
- LaTeX 数学公式
- 图片上传（拖拽/粘贴）
- 表格编辑
- 3 秒防抖自动保存
- 只读模式
- 标题栏显示文档名和保存状态
- postMessage 跨 iframe 通信
- CAS SSO 认证（跨子域 cookie 共享）

### 暂不支持

- 实时协作（通过 Collab Runtime）— 后续按需接入
- 版本历史
- 文档共享管理
- AI 辅助功能
- 标注/批注

## 认证方式

嵌入式编辑器使用 CAS SSO 共享 cookie 认证。前提条件：

1. 父页面和 codocs 在同一个顶级域下（如 `*.wiztek.cn`）
2. 用户已通过 CAS 登录（`auth_user` cookie 存在）

如果用户未登录，编辑器会显示错误提示。

## 安全说明

- `/embed/` 路径自动设置 `X-Frame-Options: ALLOWALL`，允许被任何页面嵌入
- 其他路径不受影响，仍遵循默认的安全策略
- 编辑器的文档访问权限由 codocs 后端 API 控制，未授权用户无法编辑
- `postMessage` 使用 `'*'` 作为 targetOrigin，生产环境建议限制为具体域名

## 文件清单

| 文件 | 说明 |
|------|------|
| `app/layouts/embed.vue` | 空白 layout（无侧边栏/导航） |
| `app/pages/embed/editor/[uuid].vue` | 嵌入式编辑器页面 |
| `server/middleware/embed-headers.ts` | 设置 iframe 允许的响应头 |

## 开发环境

开发时 iframe URL 使用 `http://localhost:3001`：

```vue
<iframe
  :src="`http://localhost:3001/embed/editor/${docUuid}`"
  class="w-full h-full border-0"
/>
```

建议通过环境变量配置：

```typescript
// 各模块的 nuxt.config.ts
runtimeConfig: {
  public: {
    codocsBaseUrl: process.env.CODOCS_BASE_URL || 'http://localhost:3001'
  }
}
```

```vue
<template>
  <iframe
    :src="`${config.public.codocsBaseUrl}/embed/editor/${docUuid}`"
    class="w-full h-full border-0"
  />
</template>

<script setup>
const config = useRuntimeConfig()
</script>
```

## Vue 组件封装示例

各模块可封装一个通用组件：

```vue
<!-- components/CodocsEditor.vue -->
<script setup lang="ts">
const props = defineProps<{
  uuid: string
  readonly?: boolean
  showTitle?: boolean
}>()

const config = useRuntimeConfig()
const baseUrl = (config.public.codocsBaseUrl as string) || 'https://codocs.wiztek.cn'

const src = computed(() => {
  const params = new URLSearchParams()
  if (props.readonly) params.set('readonly', '1')
  if (props.showTitle === false) params.set('title', '0')
  const qs = params.toString()
  return `${baseUrl}/embed/editor/${props.uuid}${qs ? '?' + qs : ''}`
})

const iframeRef = ref<HTMLIFrameElement | null>(null)

// 触发保存
const save = () => {
  iframeRef.value?.contentWindow?.postMessage({ type: 'codocs:save' }, '*')
}

// 获取内容
const getContent = (): Promise<string> => {
  return new Promise((resolve) => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'codocs:content') {
        window.removeEventListener('message', handler)
        resolve(e.data.content)
      }
    }
    window.addEventListener('message', handler)
    iframeRef.value?.contentWindow?.postMessage({ type: 'codocs:getContent' }, '*')
    // 超时兜底
    setTimeout(() => {
      window.removeEventListener('message', handler)
      resolve('')
    }, 3000)
  })
}

defineExpose({ save, getContent })
</script>

<template>
  <iframe
    ref="iframeRef"
    :src="src"
    class="w-full h-full border-0"
    allow="clipboard-read; clipboard-write"
  />
</template>
```

使用：

```vue
<template>
  <CodocsEditor ref="editorRef" :uuid="docUuid" />
  <button @click="editorRef?.save()">保存</button>
</template>

<script setup>
const editorRef = ref()
const docUuid = '...'
</script>
```
