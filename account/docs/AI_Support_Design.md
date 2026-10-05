# Codocs 文档编辑器 AI 功能设计方案

```
请利用新实现的API为codocs项目的文档编辑功能设计增加AI支持的方案，谢谢
```


> **版本：** v1.0
> **创建日期：** 2026-03-15
> **状态：** 设计中

---

## 1. 现有基础

codocs 已具备 AI 集成的基础设施：

- 数据库已有 `ai_abstract` 字段和 `ai_enabled` 系统开关
- Account API 连接已配置（`HZY_ACCOUNT_API_URL/KEY/SECRET`）
- 编辑器使用 Milkdown Crepe v7.18.0，支持 Slash Commands、Block Handles、Toolbar
- Account 模块已实现 AI 网关（`/api/v1/ai/chat`、`/api/v1/ai/completions`），默认接入通义千问

---

## 2. 功能规划

### P0 - 核心功能（首批实现）

| 功能     | 触发方式                | 说明                                     |
| -------- | ----------------------- | ---------------------------------------- |
| AI 续写  | Slash 命令 `/ai`        | 基于光标前的上下文自动续写               |
| 选中改写 | 右键菜单 / Toolbar 按钮 | 选中文本后改写（润色、精简、扩展、翻译） |
| 格式纠正 | 右键菜单 / Toolbar 按钮 | 修正选中内容的 Markdown 格式问题         |
| AI 摘要  | 侧边栏按钮              | 生成文档摘要，写入 `ai_abstract` 字段    |

### P1 - 增强功能

| 功能     | 触发方式           | 说明                         |
| -------- | ------------------ | ---------------------------- |
| 智能补全 | 输入停顿时自动触发 | 光标处灰色提示文字，Tab 确认 |
| 全文润色 | 侧边栏按钮         | 对整篇文档进行格式和表达优化 |
| 内容总结 | 侧边栏按钮         | 生成要点列表或思维导图大纲   |

### P2 - 高级功能

| 功能           | 触发方式                 | 说明                       |
| -------------- | ------------------------ | -------------------------- |
| AI 问答        | 侧边栏对话面板           | 基于当前文档内容的问答     |
| 表格生成       | Slash 命令 `/ai-table`   | 根据描述生成 Markdown 表格 |
| Mermaid 图生成 | Slash 命令 `/ai-diagram` | 根据描述生成流程图/时序图  |

---

## 3. 架构设计

```
┌─────────────────── Codocs 前端 ───────────────────┐
│                                                    │
│  MilkdownEditor.client.vue                         │
│  ├── AI Toolbar Button (选中文本时出现)             │
│  ├── Slash Command (/ai, /ai-table, /ai-diagram)  │
│  └── Inline Ghost Text (智能补全)                  │
│                                                    │
│  EditorSidebar.vue                                 │
│  └── AI Tab (摘要、润色、问答)                      │
│                                                    │
│  composables/useAi.ts (统一 AI 调用逻辑)           │
│                                                    │
└──────────────┬────────────────┬────────────────────┘
               │ 非流式          │ 流式 (SSE)
               ▼                ▼
┌─────────── Codocs Server (Nitro) ──────────────────┐
│                                                     │
│  server/api/ai/chat.post.ts      ── 代理转发 ──┐   │
│  server/api/ai/completions.post.ts ─────────────┤   │
│  server/utils/accountAi.ts (封装调用逻辑)       │   │
│                                                  │   │
└──────────────────────────────────────────────────┼───┘
                                                   │
                                                   ▼
                                    Account AI Gateway
                                    POST /api/v1/ai/chat
                                    POST /api/v1/ai/completions
```

---

## 4. 关键文件设计

### 4.1 `codocs/server/utils/accountAi.ts` — Account AI 代理工具

封装对 Account AI API 的调用，复用已有的 `HZY_ACCOUNT_API_URL/KEY/SECRET` 配置。

```typescript
export async function aiChat(params: {
  messages: Array<{ role: string, content: string }>
  model?: string
  stream?: boolean
  maxTokens?: number
  temperature?: number
  action: string
  uid: string
}): Promise<Response | object>

export async function aiCompletions(params: {
  prompt: string
  stream?: boolean
  maxTokens?: number
  action: string
  uid: string
}): Promise<Response | object>
```

### 4.2 `codocs/server/api/ai/chat.post.ts` — 前端调用入口

前端通过 codocs 自己的 API 调用，不直接访问 Account。好处：

1. 前端不暴露 Account API Key
2. 可附加文档上下文（如当前文档内容）
3. 可做 codocs 级别的权限检查

### 4.3 `codocs/app/composables/useAi.ts` — 前端 AI 组合式函数

```typescript
export function useAi() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 非流式调用
  async function request(params): Promise<string>

  // 流式调用
  async function stream(params, onChunk: (text: string) => void): Promise<string>

  // ---- 业务快捷方法 ----
  async function continueWriting(contextBefore: string, onChunk): Promise<string>
  async function rewrite(text: string, mode: 'polish'|'simplify'|'expand'|'translate', onChunk): Promise<string>
  async function fixFormat(text: string): Promise<string>
  async function summarize(fullContent: string): Promise<string>
  async function generateTable(description: string): Promise<string>
  async function generateDiagram(description: string): Promise<string>

  return { loading, error, request, stream,
           continueWriting, rewrite, fixFormat, summarize,
           generateTable, generateDiagram }
}
```

---

## 5. 编辑器 UI 集成点

### 5.1 AI Toolbar（选中文本时浮现）

当用户选中文本时，在已有的格式工具栏旁显示 AI 按钮组：

```
[润色] [精简] [扩展] [格式纠正] [翻译]
```

点击后：

1. 获取选中的 Markdown 文本
2. 调用对应 AI 方法（流式）
3. 弹出预览面板显示结果（逐字显示）
4. 用户确认「替换」或「取消」

### 5.2 Slash Command

扩展 Milkdown Crepe 的 Slash Menu，新增：

- `/ai` — AI 续写（基于上文）
- `/ai-table` — AI 生成表格（输入描述）
- `/ai-diagram` — AI 生成图表（输入描述）

### 5.3 侧边栏 AI Tab

在 EditorSidebar 中新增「AI」标签页：

```
┌─────────────────────┐
│ 大纲  AI  ...       │
├─────────────────────┤
│                     │
│ [生成摘要]          │
│ ┌─────────────────┐ │
│ │ AI 生成的摘要... │ │
│ └─────────────────┘ │
│                     │
│ [全文润色]          │
│                     │
│ ─── AI 问答 ───     │
│ ┌─────────────────┐ │
│ │ 基于本文档的     │ │
│ │ 智能问答对话...  │ │
│ └─────────────────┘ │
│ [输入问题...]  [发送]│
└─────────────────────┘
```

---

## 6. Prompt 模板设计

每个场景预设 system prompt，保证输出质量：

| 场景     | temperature | System Prompt 要点                                 |
| -------- | ----------- | -------------------------------------------------- |
| 续写     | 0.7         | 根据上下文自然续写，保持风格一致，只输出续写内容   |
| 润色     | 0.5         | 优化表达，更通顺专业，保持原意，只输出结果         |
| 精简     | 0.3         | 去除冗余，保留核心信息，只输出结果                 |
| 扩展     | 0.7         | 丰富内容细节，增加论述和示例，只输出结果           |
| 格式纠正 | 0.1         | 修正 Markdown 格式问题，不修改文本内容，只输出结果 |
| 摘要     | 0.3         | 生成 100-200 字摘要，概括核心内容和要点            |
| 翻译     | 0.3         | 中英互译，保持专业术语准确，只输出翻译结果         |
| 生成表格 | 0.3         | 根据描述生成标准 Markdown 表格，只输出表格         |
| 生成图表 | 0.3         | 根据描述生成 Mermaid 语法代码，只输出代码块        |

---

## 7. 流式替换交互方案

对于改写/续写等需要替换编辑器内容的场景：

1. 用户触发 AI 操作
2. 编辑器出现浮动面板（锚定在选区或光标位置）
3. AI 内容在面板中逐字流式显示
4. 面板底部显示 **[采纳]** **[放弃]** **[重试]** 按钮
5. 点击「采纳」→ 通过 `crepe.editor.action()` 替换编辑器内容
6. 点击「放弃」→ 关闭面板，不修改文档

---

## 8. 实施步骤

### 第一步（P0 快速见效）

1. 创建 `server/utils/accountAi.ts` + `server/api/ai/chat.post.ts`
2. 创建 `composables/useAi.ts`
3. 在 EditorSidebar 新增 AI Tab，实现「生成摘要」
4. 实现选中文本改写（润色/格式纠正）

### 第二步（P0 完善）

5. 实现 Slash Command `/ai` 续写
6. 实现精简、扩展、翻译

### 第三步（P1）

7. 智能补全（Ghost Text）
8. 全文润色
9. AI 问答面板

### 第四步（P2）

10. 表格生成
11. Mermaid 图生成
