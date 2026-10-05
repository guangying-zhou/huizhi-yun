# 汇智云粘贴板

> 跨模块临时粘贴板，支持在 Codocs 编辑器中复制富文本片段并在其他文档/页面中粘贴。

## 功能概述

- 选中编辑器中的图文内容，点击工具栏的**云复制**按钮，将内容（Markdown 格式）发送到服务端缓存
- 在另一个文档或页面中，点击加号菜单的**从汇智云粘贴**，将缓存内容解析并插入到光标位置
- 每用户仅保留最新一条，覆盖式写入，**30 分钟后自动过期**
- 纯内存缓存，无数据库依赖

## 使用方式

### 云复制（工具栏）

1. 在编辑器中选中一段内容
2. 点击工具栏中的 **cloud-upload** 图标按钮（位于标注、AI 按钮同一栏）
3. 提示"已复制到汇智云粘贴板"

### 云粘贴（加号菜单）

1. 在编辑器中将光标定位到目标位置
2. 点击左侧 **+** 按钮，或输入 `/`
3. 在菜单"汇智云"分组中选择 **从汇智云粘贴**
4. 粘贴板内容以富文本形式插入

## 技术架构

```
┌──────────────────────────────────────────────────┐
│  Codocs 前端（MilkdownEditor）                     │
│                                                    │
│  选中内容 → serializerCtx → Markdown 字符串         │
│       ↓                                            │
│  POST /api/account/clipboard                       │
│       ↓                                            │
│  ┌──────────────────────────────────────────────┐  │
│  │  Codocs Server（代理路由）                     │  │
│  │  POST /api/account/clipboard                  │  │
│  │  GET  /api/account/clipboard                  │  │
│  └───────────────┬──────────────────────────────┘  │
│                  ↓                                  │
│  ┌──────────────────────────────────────────────┐  │
│  │  Account Server（/api/v1/clipboard）           │  │
│  │                                               │  │
│  │  clipboard.ts — Map<uid, ClipboardEntry>      │  │
│  │  TTL: 30 分钟 | 定时清理: 每 10 分钟          │  │
│  └──────────────────────────────────────────────┘  │
│                  ↓                                  │
│  GET /api/account/clipboard → parserCtx → 插入编辑器│
└──────────────────────────────────────────────────┘
```

## API 接口

详见 [Account API 文档](../../account/docs/API_SPEC.md) 第 14 章"粘贴板"。

### POST /api/v1/clipboard

写入粘贴板。

| 参数        | 类型   | 必填 | 说明                                         |
| ----------- | ------ | ---- | -------------------------------------------- |
| uid         | string | 是   | 用户 UID                                     |
| content     | string | 是   | 粘贴板内容（最大 512 KB）                    |
| contentType | string | 否   | 内容类型：`markdown`（默认）、`text`、`json` |
| sourceApp   | string | 否   | 来源模块编码                                 |

### GET /api/v1/clipboard?uid=xxx

读取粘贴板。过期或为空时 `data` 返回 `null`。

## 涉及文件

### Account 模块

| 文件 | 说明 |
| --- | --- |
| `server/utils/clipboard.ts` | 内存缓存实现（Map + TTL） |
| `server/api/v1/clipboard/index.post.ts` | 写入接口 |
| `server/api/v1/clipboard/index.get.ts` | 读取接口 |
| `docs/API_SPEC.md` | 接口文档（第 14 章，v1.11） |

### Codocs 模块

| 文件 | 说明 |
| --- | --- |
| `server/api/account/clipboard.post.ts` | 代理写入请求 |
| `server/api/account/clipboard.get.ts` | 代理读取请求 |
| `app/components/editor/MilkdownEditor.client.vue` | 编辑器集成（工具栏 + 加号菜单） |

## 设计决策

| 决策 | 原因 |
| --- | --- |
| 内存缓存而非数据库 | 临时工具，无需持久化，30 分钟过期即可 |
| 每用户仅一条 | 简化实现，覆盖式写入避免管理多条记录 |
| 存储 Markdown 而非 ProseMirror JSON | Markdown 是 Milkdown Crepe 的原生序列化格式，跨版本兼容性好 |
| 云复制在工具栏，云粘贴在加号菜单 | 复制是对选中内容的操作（适合工具栏），粘贴是插入新内容（适合加号菜单） |
| API 放在 Account 模块 | 统一服务，其他模块通过代理路由调用，未来可扩展到全模块 |

## 后续扩展

- 其他模块（如 nuxt-template）可通过同样的代理路由模式接入
- 如需支持非编辑器场景（如表单字段），可封装通用的 `useCloudClipboard` composable
