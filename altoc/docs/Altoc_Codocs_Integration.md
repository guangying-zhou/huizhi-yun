# Altoc × Codocs 文档集成方案

## 1. 文档信息

* 文档名称：Altoc 与 Codocs 文档集成说明
* 当前版本：v1.0
* 文档状态：已实施
* 更新时间：2026-03-22

## 2. 集成目标

在 Altoc 销售管理流程中复用 Codocs 的在线协同编辑器和 OSS 存储能力，让销售过程中的文档（方案、纪要、合同文本、投标材料等）在统一平台内创建、编辑、预览和管理。

## 3. 架构概览

```
┌──────────────────┐         REST API          ┌──────────────────┐
│                  │  POST /api/v1/codocs/documents │              │
│     Altoc        │ ──────创建文档──────────>   │     Codocs       │
│   (端口 3003)     │                           │   (端口 3001)     │
│                  │  GET /api/v1/codocs/documents/:uuid/content │  │
│                  │ ──────获取内容──────────>   │                  │
│                  │                           │                  │
│  document_link   │         浏览器跳转          │  documents 表    │
│  (关联表)         │ ──────编辑文档──────────>   │  OSS 存储        │
│                  │                           │  Hocuspocus 协作  │
└──────────────────┘                           └──────────────────┘
         │                                              │
         └──── Console OIDC + service token ────────────┘
```

## 4. Codocs 侧改动

### 4.1 新增文档类型 `sale`

**数据库：** `hzy_codocs.documents` 表 `doc_type` 枚举新增 `sale` 值

```sql
ALTER TABLE documents MODIFY COLUMN doc_type
  ENUM('private','shared','department','project','git-project','company','knowledge','product','sale')
  NOT NULL COMMENT '文档类型';
```

**OSS 路径映射：** `server/utils/oss.ts`

```typescript
const DOC_PATH_MAP = {
  // ... 原有类型
  sale: 'sale'    // 新增
}
```

**存储路径格式：**

```
codocs/sale/{entity_code}/docs/{filename}.md
```

示例：`codocs/sale/OP-20260300001/docs/项目方案-a3k2x9.md`

* `entity_code` — Altoc 实体编码（商机编码 OP-xxx、合同编码 CT-xxx 等）
* `filename` — 文档标题 + 随机短码（避免同名冲突）

**类型定义：** `app/types/index.ts` 的 `ProjectFileItem.docType` 联合类型新增 `'sale'`

### 4.2 涉及修改的文件

| 文件 | 改动 |
|------|------|
| `codocs/docs/codocs_schema.sql` | doc_type ENUM 新增 `sale` |
| `codocs/server/utils/oss.ts` | DOC_PATH_MAP 新增 `sale`，路径生成和文件列表逻辑支持 `sale` 类型 |
| `codocs/app/types/index.ts` | docType 类型定义新增 `sale` |

## 5. Altoc 侧实现

### 5.1 数据模型

**document_link 表** — 记录 Altoc 实体与 Codocs 文档的关联关系

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT PK | 主键 |
| entity_type | VARCHAR(30) | 实体类型：opportunity/contract/quotation/customer/tender |
| entity_id | BIGINT | 实体ID |
| document_uuid | CHAR(36) | Codocs 文档 UUID |
| document_title | VARCHAR(255) | 文档标题（冗余，用于列表展示） |
| link_type | VARCHAR(30) | 关联类型：proposal/contract_text/legacy_contract_scan/meeting_memo/tender_doc/general |
| created_by | VARCHAR(50) | 创建人 |
| created_at | DATETIME | 创建时间 |

**唯一约束：** `(entity_type, entity_id, document_uuid)` — 同一文档不会重复关联到同一实体

### 5.2 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/documents?entity_type=xxx&entity_id=xxx` | 获取实体的关联文档列表 |
| POST | `/api/v1/documents` | 创建文档并关联，或用 `document_uuid` 关联已有 Codocs 文档 |
| DELETE | `/api/v1/documents/:id` | 取消关联（不删除 Codocs 文档） |
| GET | `/api/v1/documents/preview?uuid=xxx` | 代理获取文档内容（用于预览） |

**创建流程：**

```
1. Altoc 前端 → POST /api/v1/documents (title, entity_type, entity_id, link_type)
2. Altoc 后端 → 查询实体编码（如 OP-20260300001）
3. Altoc 后端 → 通过 Console service token 调用 `POST /api/v1/codocs/documents`（`docType=sale`、`ownerUid`、`projectCode=实体编码`）
4. Codocs → 验证 service token scope `codocs:documents:write`，创建数据库记录 + 上传初始内容到 OSS → 返回 `{ code: 0, data: { uuid } }`
5. Altoc 后端 → INSERT INTO document_link (entity_type, entity_id, document_uuid, ...)
6. Altoc 前端 → 自动打开新窗口跳转 Codocs 编辑器
```

### 5.3 前端组件

**DocumentsPanel** (`app/components/DocumentsPanel.vue`)

可复用的文档面板组件，通过 props 指定实体类型和 ID：

```vue
<DocumentsPanel entity-type="opportunity" :entity-id="123" />
```

功能：
* 展示已关联文档列表（标题、类型标签、创建时间）
* 新建文档弹窗（标题 + 文档类型选择）
* 点击文档 → 弹出预览窗口
* 取消关联按钮

**DocumentPreview** (`app/components/DocumentPreview.vue`)

文档预览弹窗组件：

```vue
<DocumentPreview v-model:open="open" :uuid="uuid" :title="title" />
```

功能：
* 从 Codocs 获取 Markdown 内容并渲染为 HTML
* 支持标题、粗体、斜体、列表、代码、图片、链接
* 图片 URL 自动补全 Codocs 域名
* 「在 Codocs 中编辑」按钮跳转编辑器
* 底部显示作者（真实姓名）和最后更新时间

### 5.4 已集成的页面

| 页面 | 集成方式 |
|------|---------|
| 商机详情 `/opportunities/:id` | 「文档」tab |
| 合同详情 `/contracts/:id` | 「文档」tab |
| 报价详情 `/quotes/:id` | 底部文档面板 |

### 5.5 文档关联类型

| 编码 | 名称 | 适用场景 |
|------|------|---------|
| general | 通用文档 | 默认类型 |
| proposal | 方案文档 | 需求分析、技术方案、投标方案 |
| contract_text | 合同文本 | 合同正文、补充协议 |
| meeting_memo | 会议纪要 | 客户会议、内部评审 |
| tender_doc | 投标材料 | 标书、资质文件、案例 |

## 6. 配置

### 6.1 环境变量

Altoc 不再新增 `CODOCS_BASE_URL` 等 Codocs 私有环境变量。服务端调用 Codocs 时先从 Console runtime config 查找 `codocs` 应用的 `homeUrl` 与 `apiBase`，本地开发缺省回退到 sibling app URL（`http://localhost:3001/api/v1/codocs`）。

前端打开 Codocs 编辑器仍使用 `nuxt.config.ts` 推导出的 `public.codocsBaseUrl`，该值来自统一网关/本地端口约定，而不是业务环境变量。

### 6.2 认证

用户访问前端走 Foundation/Console OIDC。Altoc 后端调用 Codocs v1 API 时通过 Foundation `requestServiceAccessToken({ audience: 'codocs', scope })` 换取短期 Console service token：

- 创建文档：`codocs:documents:write`
- 预览内容/校验已有文档：`codocs:documents:read`

迁移期 token bootstrap 仍可使用本应用 `license.lic`；接口不再透传用户 Cookie，也不再依赖旧 Account CAS 会话。

## 7. 使用流程

### 7.1 创建文档

1. 打开商机/合同/报价详情页
2. 切换到「文档」tab
3. 点击「新建文档」
4. 输入标题，选择文档类型
5. 点击「创建并打开」
6. 自动跳转 Codocs 编辑器，开始编写

### 7.2 查看文档

1. 在文档列表中点击文档标题
2. 弹出预览窗口，显示 Markdown 渲染后的内容
3. 如需编辑，点击右上角「在 Codocs 中编辑」

### 7.3 协作编辑

1. 在 Codocs 编辑器中，通过分享功能邀请团队成员
2. 多人可同时在线编辑（Y.js CRDT 实时协作）
3. 编辑历史自动保存到 OSS

## 8. 后续扩展

### 8.1 第二层：嵌入式编辑（P2）

* 在 Altoc 页面中嵌入 Codocs 的 Milkdown 编辑器
* 无需跳转即可编辑文档
* 可通过 iframe 或提取编辑器为独立组件实现

### 8.2 更多集成场景

* 客户详情页文档 tab
* 销售活动记录中直接关联文档
* AI 纪要结构化后自动创建文档
* 投标材料文件夹管理（P2 投标模块）

### 8.3 文档模板

* 预置方案模板、纪要模板、合同模板
* 创建文档时可选模板，自动填充初始内容
