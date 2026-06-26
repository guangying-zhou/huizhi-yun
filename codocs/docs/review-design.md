>  请先了解一下codocs项目，然后设计文档审阅功能，实现：在部门文档或项目文档中选择文档，在预览窗口右上角的下拉菜单中增加"提交审阅"，弹窗设置审阅类型（对外发文/内部公文/投票表决/会议记录/产品资料/知识库/技术规范/企业文化/热点资讯/归档等），其中内部公文又可分为公司制度、部门规章、通知公告、法务合规等，可以考虑为每种类型设置审阅审批流程，也可在提交申请时指定审阅人与通过条件（如仅需几人通过即可进入下一环节）。提交审阅后，将文档置为只读状态。系统自动向审阅人发送企业微信消息。发起人可查看处理流程与状态，并可向审阅人发送提醒消息。审阅审批流程做好记录，最好能可视化展示。提供驳回修改功能。最终通过后自动归入相应栏目。请先进行设计，谢谢

```我已经详细了解了 codocs 项目的架构。总结一下你的需求：

你希望在 codocs 中新增一个**文档审阅审批功能**，允许用户从部门文档或项目文档中选择文档后，通过预览窗口右上角下拉菜单"提交审阅"，设置审阅类型和审批流程，提交后文档变为只读，系统自动通知审阅人，并提供流程可视化、驳回修改、最终归档等完整闭环。

在进入设计之前，我有几个关键问题需要确认：

[1]: 审阅审批流程的灵活度如何定义？
- a. 预设流程 - 每种审阅类型（如"对外发文"、"公司制度"等）在系统管理中预先配置好固定的审批链（如：部门经理→分管领导→总经理），提交时不可修改
- b. 混合模式 - 系统管理中可为每种类型预设默认流程，但提交时发起人可以调整审阅人和通过条件（你描述中提到的"指定审阅人与通过条件"）
- c. 完全自定义 - 不预设流程，每次提交时由发起人自行指定所有审阅人和规则

[2]: 审批节点的通过条件，除了"N人通过即可进入下一环节"（会签/或签），还需要支持哪些模式？
- a. 全部通过（会签）+ 任一通过（或签）两种即可
- b. 还需要支持**按比例通过**（如 2/3 通过）
- c. 还需要支持**按角色通过**（如必须包含部门经理的同意）

[3]: "最终通过后自动归入相应栏目"——我看到 company/ 下已有 rules（公司制度）、outsides（对外发文）、knowledge（知识库）等页面（目前都是 TODO 状态）。归档后的文档是：
- a. 复制一份到目标栏目（原文档保留在部门/项目文档中）
- b. 移动到目标栏目（从原位置消失）
- c. 引用/链接方式（原文档不动，目标栏目显示一个链接/引用）

 ▸ Credits: 5.70 • Time: 1m 38s

[plan] 30% > 1.采用预设流程吧;2.三种模式均需支持，其中a一般会要求多于一人通过；3.采用a方案，同时为原文档做标记，如该文档已发布为XXXX。

好的，需求已经明确了。让我继续深入几个实现细节：

[1]: 关于预设审批流程的管理，我注意到系统管理菜单中已有"发文流程"（/admin/publish）这个入口。审批流程模板的配置是否就放在这里？另外，一个审批流程可以有多少个节点（环节）？
- a. 固定上限 - 最多 5 个审批节点（如：部门审核→专业审核→领导审批→最终审批→归档确认）
- b. 不限节点数 - 管理员可自由添加任意数量的审批节点
- c. 建议数量 - 你有具体的典型流程示例吗？比如"对外发文"一般经过哪几个环节？

[2]: 关于企业微信消息通知，我看到已有独立的 wecomsg 服务（wecomsg.wiztek.cn）。通知的触发场景除了"提交审阅时通知审阅人"和"发起人发送提醒"，还需要在哪些节点自动通知？
- a. 基础通知 - 仅在提交审阅、被驳回时自动通知
- b. 全流程通知 - 提交审阅、每个节点通过/驳回、最终通过归档，都自动通知相关人
- c. 可配置通知 - 在流程模板中可配置每个节点是否发送通知

[3]: 关于驳回修改，驳回后的处理方式是：
- a. 驳回到发起人 - 无论在哪个节点驳回，都退回给发起人修改，修改后重新走完整流程
- b. 驳回到上一节点 - 驳回到前一个审批节点，由该节点重新审批
- c. 可选驳回 - 审阅人驳回时可以选择退回到发起人或退回到指定节点

 ▸ Credits: 0.39 • Time: 13s

[plan] 30% > 1.可以用这个入口，采用a吧；2.a,再加最终审批通过吧，归档确认由发起人进行；3.a,驳回要附驳回原因

>

好的，需求基本清晰了。让我确认最后几个技术细节：

[1]: 审阅流程的可视化展示，你提到"最好能可视化展示"。你倾向于哪种形式？
- a. 时间线/步骤条 - 类似 USteps 组件，横向或纵向展示每个节点的状态（待审/通过/驳回），点击可查看详情和意见
- b. 流程图 - 用 Mermaid 或自定义 SVG 绘制带箭头的流程图，节点用不同颜色标识状态
- c. 两者结合 - 简洁视图用步骤条，详细视图用流程图

[2]: 审阅人的选择范围——预设流程中配置审阅人时，是按具体用户还是按角色？
- a. 按角色 - 配置为"部门经理"、"分管领导"等角色，提交时系统自动匹配当前部门/项目的对应人员
- b. 按具体用户 - 管理员在流程模板中直接指定具体的审阅人（如张三、李四）
- c. 混合 - 某些节点按角色（如"部门经理"自动匹配），某些节点指定具体用户

[3]: 发起人"归档确认"这个环节，具体操作是什么？
- a. 一键确认 - 审批全部通过后，发起人只需点击"确认发布"，系统自动将文档复制到对应栏目
- b. 可调整归档 - 发起人可以在确认时修改归档目标栏目（比如原本选的"公司制度"，确认时改为"通知公告"）
- c. 确认并补充 - 发起人确认发布时可以补充摘要、标签等元信息

 ▸ Credits: 0.55 • Time: 13s

[plan] 31% > 1.b;2.a角色（或者某委员会成员）;3.b

>

好的，所有需求已经明确。现在让我进行技术研究，然后制定实现方案。
```


# 文档审阅审批功能 - 设计文档

**作者：** AI 辅助设计
**日期：** 2026-03-09
**版本：** 1.0

---

## 1. 问题描述

Codocs 目前缺少文档审阅审批机制。部门文档和项目文档编写完成后，无法通过正式流程进行审阅、审批和归档发布。需要建立一套完整的审阅审批工作流，支持多种文档类型分类、预设审批流程、企业微信通知、流程可视化和驳回修改。

---

## 2. 需求清单

1. 在部门文档（`departments/coworks`）和项目文档（`git_projects/index`）预览窗口右上角下拉菜单中增加"提交审阅"选项
2. 弹窗选择审阅类型（对外发文/内部公文/投票表决/会议记录/产品资料/知识库/技术规范/企业文化/热点资讯/归档），内部公文可细分为公司制度/部门规章/通知公告/法务合规
3. 每种审阅类型预设审批流程（最多5个节点），审批节点按角色或委员会成员配置
4. 通过条件支持三种模式：全部通过（会签，可要求多于1人）、任一通过（或签）、按比例通过
5. 提交后文档置为只读
6. 自动通过 wecomsg 服务向审阅人发送企业微信消息（提交时、驳回时、最终通过时通知）
7. 独立审阅页面：文档预览+批注（复用现有 annotations）+ 流程图 + 操作面板
8. 驳回退回发起人，附驳回原因，审阅人可做批注，修改后重新走完整流程
9. 流程可视化用 Mermaid 流程图展示（灰=待审、蓝=当前、绿=通过、红=驳回）
10. 最终通过后发起人确认归档，可调整目标栏目，文档复制到目标栏目，原文档标记"已发布为XXX"

---

## 3. 技术背景

- **技术栈：** Nuxt 4 + Nuxt UI v4 + MySQL + 阿里云 OSS
- **现有 `documents` 表：** 有 `readonly_flag`、`status`（1=正常, 0=已删除, 2=已发布）、`doc_type` 字段
- **企业微信消息服务：** 独立部署在 `wecomsg.wiztek.cn`，支持 text/markdown/textcard 消息，通过 HTTP POST `/send` 调用
- **用户角色：** 通过 Account 模块 API 获取（部门经理 managerId、分管领导 leaderId）
- **现有下拉菜单：** 使用 `UDropdownMenu` 组件
- **系统管理菜单：** 已有"发文流程"入口（`/admin/publish`）
- **批注功能：** 现有 `document_annotations` + `annotation_replies` 表及相关 API 可复用
- **Mermaid：** 已在 package.json 依赖中（`mermaid: ^11.12.2`）
- **`company/` 栏目页面：** rules, outsides, knowledge 等目前为 TODO 状态

---

## 4. 方案设计

### 4.1 整体流程

mermaid
graph TD
A[发起人选择文档] --> B[点击提交审阅]
B --> C[选择审阅类型 加载预设流程]
C --> D[确认提交]
D --> E[文档置为只读 + 创建审阅记录]
E --> F[企微通知第一节点审阅人]

F --> G[审阅人打开审阅页面]
G --> H[查看文档 + 可做批注]
H --> I{通过 or 驳回?}

I -->|通过| J{满足通过条件?}
J -->|否 等待其他人| G
J -->|是| K{还有下一节点?}
K -->|是| F
K -->|否| L[企微通知发起人: 审批通过]

I -->|驳回 + 原因 + 批注| M[企微通知发起人: 被驳回]
M --> N[发起人查看批注和驳回原因]
N --> O[修改文档 解除只读]
O --> D

L --> P[发起人确认归档 可调整栏目]
P --> Q[复制文档到目标栏目]
Q --> R[原文档标记已发布为XXX]

### 4.2 数据库设计（3张新表 + documents 表扩展）

mermaid
erDiagram
review_flow_templates {
BIGINT id PK
VARCHAR name "流程名称"
VARCHAR review_type "审阅类型"
VARCHAR sub_type "子类型 nullable"
VARCHAR target_category "默认归档栏目"
JSON nodes "审批节点配置"
TINYINT status "1启用 0禁用"
VARCHAR created_by "创建人"
DATETIME created_at
DATETIME updated_at
}

document_reviews {
BIGINT id PK
BIGINT document_id FK
VARCHAR document_uuid
BIGINT template_id FK
VARCHAR review_type
VARCHAR sub_type
VARCHAR initiator_uid "发起人"
VARCHAR target_category "归档目标栏目"
ENUM status "pending/in_progress/approved/rejected/archived"
INT current_node "当前节点序号"
JSON flow_snapshot "流程快照含解析后的具体用户"
DATETIME created_at
DATETIME updated_at
}

review_actions {
BIGINT id PK
BIGINT review_id FK
INT node_index "节点序号"
VARCHAR actor_uid "操作人"
ENUM action "approve/reject/remind"
TEXT comment "意见或驳回原因"
DATETIME created_at
}

documents {
VARCHAR publish_info "已发布为XXX 标记"
}

review_flow_templates ||--o{ document_reviews : "模板"
document_reviews ||--o{ review_actions : "操作记录"

### 4.3 节点配置 JSON 结构

`review_flow_templates.nodes` 示例：

json
[
{
"index": 0,
"name": "部门审核",
"role": "dept_manager",
"pass_type": "all",
"pass_count": 2
},
{
"index": 1,
"name": "领导审批",
"role": "supervisor",
"pass_type": "any",
"pass_count": 1
},
{
"index": 2,
"name": "最终审批",
"role": "admin",
"pass_type": "ratio",
"pass_count": 2,
"pass_total": 3
}
]

**字段说明：**

| 字段                  | 说明                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `role`                | `dept_manager`（部门经理）、`supervisor`（分管领导）、`admin`（管理员）、`committee:xxx`（委员会成员）、`committee_members`（当前部门委员会成员） |
| `pass_type`           | `all`（会签，需 pass_count 人通过）、`any`（或签，任一人通过）、`ratio`（按比例，pass_count/pass_total）                                          |
| `committee_mode`      | 委员会内审节点专用：`assist`（协助审查）、`vote`（会签投票）                                                                                      |
| `committee_vote_type` | 会签投票时专用：`majority`（一般表决，半数通过）、`supermajority`（2/3表决）                                                                      |

### 4.3.1 委员会内审模式

当部门类型为委员会（`orgType === 'committee'`）时，提交审阅弹窗会显示**内审模式**选项：

**协助审查（assist）**
- 从委员会成员中随机选取指定人数进行审查
- 默认2人，最多不超过部门人数的一半
- 全部通过后进入下一环节
- 节点配置：`pass_type: "all"`, `committee_mode: "assist"`

**会签投票（vote）**
- 全体委员会成员参与投票表决
- 一般表决：半数以上通过（`committee_vote_type: "majority"`）
- 2/3表决：三分之二以上通过（`committee_vote_type: "supermajority"`）
- 节点配置：`pass_type: "ratio"`, `committee_mode: "vote"`

### 4.4 流程快照 JSON 结构

`document_reviews.flow_snapshot` 在提交时将角色解析为具体用户：

json
[
{
"index": 0,
"name": "部门审核",
"role": "dept_manager",
"pass_type": "all",
"pass_count": 2,
"reviewers": ["uid_zhangsan", "uid_lisi"]
},
{
"index": 1,
"name": "领导审批",
"role": "supervisor",
"pass_type": "any",
"pass_count": 1,
"reviewers": ["uid_wangwu"]
}
]

### 4.5 审阅类型与归档栏目映射

| 审阅类型 | 子类型   | 归档目标 doc_type | 栏目页面路由             |
| -------- | -------- | ----------------- | ------------------------ |
| 对外发文 | -        | company           | /company/outsides        |
| 内部公文 | 公司制度 | company           | /company/rules           |
| 内部公文 | 部门规章 | department        | /departments/XXX/rules   |
| 内部公文 | 通知公告 | company           | /company/notice          |
| 内部公文 | 法务合规 | company           | /company/legal           |
| 投票表决 | -        | department        | /department/XXX/records  |
| 会议记录 | -        | department        | /departments/XXX/records |
| 产品资料 | -        | product           | /company/products        |
| 知识库   | -        | knowledge         | /company/knowledge       |
| 技术规范 | -        | company           | /company/tech-specs      |
| 企业文化 | -        | company           | /company/culture         |
| 归档     | -        | company           | /company/archive         |

### 4.6 审阅页面布局

┌─────────────────────────────────────────────────────────────┐
│ ← 返回审阅列表 文档标题 审阅类型标签 状态标签 │
├──────────────────────────────┬──────────────────────────────┤
│ │ 📋 审阅信息 │
│ │ 发起人: xxx 时间: xxx │
│ │ │
│ 文档内容（只读预览） │ 📊 流程图 (Mermaid) │
│ │ ┌──┐ ┌──┐ ┌──┐ │
│ 支持批注功能 │ │节1├─→│节2├─→│节3│ │
│ (annotations) │ └──┘ └──┘ └──┘ │
│ │ │
│ │ 📝 操作记录时间线 │
│ │ ● 张三 通过 - 同意发布 │
│ │ ● 李四 通过 - 无意见 │
│ │ │
│ │ ───────────────── │
│ │ [✓ 通过] [✗ 驳回] │
│ │ 或 │
│ │ [📤 发送提醒] [📁 确认发布] │
└──────────────────────────────┴──────────────────────────────┘

---

## 5. 任务分解

### Task 1: 数据库表创建与迁移脚本

- **目标：** 创建审阅功能所需的数据库表并扩展 documents 表
- **实现：**
  - 创建 `server/migrations/create_review_tables.sql`，包含 `review_flow_templates`、`document_reviews`、`review_actions` 三张表
  - ALTER `documents` 表新增 `publish_info` VARCHAR(255) NULL 字段
- **测试：** 执行 SQL 后通过 MySQL 客户端验证表结构和索引
- **Demo：** 数据库中存在新表，documents 表有 publish_info 字段

### Task 2: 审批流程模板管理 - 后端 API

- **目标：** 实现流程模板 CRUD
- **实现：**
  - `server/api/reviews/templates/index.get.ts` - 列表（支持按 review_type 筛选）
  - `server/api/reviews/templates/index.post.ts` - 创建（校验 nodes 最多5个，校验 pass_type/pass_count）
  - `server/api/reviews/templates/[id].patch.ts` - 更新
  - `server/api/reviews/templates/[id].delete.ts` - 删除
- **测试：** 通过 curl/Postman 验证 CRUD 操作
- **Demo：** 可通过 API 管理审批流程模板

### Task 3: 审批流程模板管理 - 前端页面

- **目标：** 管理员在 `/admin/publish` 配置审批流程模板
- **实现：**
  - 新建 `app/pages/admin/publish.vue`
  - 模板列表（UTable）+ 新建/编辑弹窗
  - 弹窗内容：名称、审阅类型选择（含内部公文子类型级联）、目标归档栏目、审批节点配置（动态添加/删除，最多5个）
  - 每个节点：名称输入、角色下拉（部门经理/分管领导/管理员/委员会）、通过条件选择、通过人数
  - 启用/禁用开关
- **Demo：** 管理员可在页面上创建"对外发文"流程模板，配置3个审批节点

### Task 4: 提交审阅与查询 - 后端 API

- **目标：** 实现提交审阅、查询审阅状态的 API
- **实现：**
  - `server/api/reviews/index.post.ts` - 提交审阅：
    - 根据 review_type + sub_type 查找启用的模板
    - 无模板时自动生成默认流程（逐级领导审批）
    - 委员会部门支持 `committee_mode`（assist/vote）、`committee_pass_count`、`committee_vote_type`（majority/supermajority）参数
    - 调用 Account API 将角色解析为具体用户 UID，生成 flow_snapshot
    - 创建 document_reviews 记录（status=in_progress, current_node=0）
    - 将文档 readonly_flag 设为 1
  - `server/api/reviews/[id].get.ts` - 审阅详情（含 flow_snapshot + 所有 review_actions）
  - `server/api/reviews/by-document/[uuid].get.ts` - 按文档查询审阅
  - `server/api/reviews/my.get.ts` - 我发起的 / 待我审阅的列表
- **Demo：** 提交审阅后文档变只读，可查询审阅详情

### Task 5: 审阅操作与企微通知 - 后端 API

- **目标：** 实现通过/驳回/提醒操作及企业微信消息通知
- **实现：**
  - `server/utils/reviewNotify.ts` - 封装通知逻辑，调用 wecomsg 服务发送 textcard 消息（含审阅页面链接）
  - `server/utils/reviewEngine.ts` - 审批引擎：检查通过条件（会签/或签/比例），推进节点
  - `server/api/reviews/[id]/approve.post.ts` - 通过：记录 action，引擎检查条件，满足则推进或完成
  - `server/api/reviews/[id]/reject.post.ts` - 驳回：必须有 comment，状态设为 rejected，文档解除只读
  - `server/api/reviews/[id]/remind.post.ts` - 提醒：仅发起人可调用，发送企微提醒
  - `server/api/reviews/[id]/resubmit.post.ts` - 重新提交：驳回后修改完重新提交，重置流程
  - 通知时机：提交时通知首节点审阅人、驳回时通知发起人、最终通过时通知发起人、提醒时通知当前节点审阅人
- **Demo：** 审阅人通过/驳回后流程正确推进，相关人收到企微消息

### Task 6: 归档确认 - 后端 API

- **目标：** 实现发起人确认归档
- **实现：**
  - `server/api/reviews/[id]/archive.post.ts`：
    - 归档路径由后端根据审阅类型（review_type/sub_type）自动决定
    - 在 documents 表新建记录（doc_type 映射到目标栏目类型，status=2，复制 OSS 文件到新路径）
    - 原文档 `publish_info` 设为"已发布为{栏目名称}"
    - 审阅 status 更新为 archived
- **Demo：** 归档后目标栏目出现新文档，原文档显示发布标记

### Task 7: 提交审阅 - 前端弹窗

- **目标：** 在部门文档和项目文档预览窗口添加"提交审阅"入口和弹窗
- **实现：**
  - 新建 `app/components/review/SubmitReviewModal.vue`：
    - 审阅类型选择（USelectMenu，内部公文展开子类型）
    - 选择后自动加载预设流程，展示节点预览（名称+角色+通过条件）
    - 无预设模板时提示将使用默认审批流程（逐级领导审批），允许提交
    - 委员会部门显示内审模式选项：协助审查（可设审阅人数）/ 会签投票（一般表决/2/3表决）
    - 确认提交按钮
  - 修改 `departments/coworks.vue` 的 UDropdownMenu，添加"提交审阅"项
  - 修改 `git_projects/index.vue` 的 UDropdownMenu，添加"提交审阅"项
- **Demo：** 点击下拉菜单"提交审阅"，弹窗选择类型，确认后文档进入审阅流程

### Task 8: 审阅页面 - 文档预览+批注+审阅操作

- **目标：** 实现独立的审阅页面，审阅人可查看文档、做批注、执行审阅操作
- **实现：**
  - 新建 `app/pages/reviews/[id].vue` - 审阅页面，左右分栏布局：
    - **左侧（约60%）：** 文档内容只读渲染（复用 MilkdownEditor 只读模式），集成现有 annotations 批注功能（审阅人可添加批注，发起人可查看）
    - **右侧（约40%）：** 审阅面板
      - 顶部：文档标题、审阅类型、发起人、提交时间
      - 中部：Mermaid 流程图（节点颜色区分状态）
      - 下部：操作记录时间线
      - 底部操作区：
        - 审阅人看到：通过按钮 + 驳回按钮（驳回弹窗填写原因）
        - 发起人看到：发送提醒按钮；审批通过后显示"确认发布"按钮（可调整目标栏目）；被驳回后显示"修改文档"按钮 + "重新提交"按钮
  - 新建 `app/components/review/ReviewFlowChart.vue` - Mermaid 流程图组件
  - 新建 `app/components/review/ReviewTimeline.vue` - 操作记录时间线组件
  - 新建 `app/components/review/ArchiveConfirmModal.vue` - 发布确认弹窗
- **Demo：** 审阅人打开审阅页面，左侧看文档并做批注，右侧看流程图并点击通过/驳回

### Task 9: 审阅中心列表页面与导航集成

- **目标：** 提供集中管理审阅任务的入口
- **实现：**
  - 新建 `app/pages/reviews/index.vue`：
    - 三个 Tab：我发起的 / 待我审阅的 / 已完成的
    - UTable 列表：文档名称、审阅类型、状态标签（颜色区分）、发起人、当前节点、时间
    - 点击行跳转到 `/reviews/[id]`
  - 在 `config/permissions.ts` 中：
    - `resources` 添加 `{ code: 'reviews', name: '审阅中心', ... }`
    - `menus` 添加"审阅中心"菜单项（icon: `i-lucide-clipboard-check`，to: `/reviews`）
    - `routeRules` 添加 `{ pattern: '/reviews/**', resource: 'reviews' }`
- **Demo：** 导航栏出现"审阅中心"，点击进入列表页，可切换 Tab 查看不同状态的审阅任务

### Task 10: 归档栏目页面对接与端到端集成

- **目标：** 归档文档在对应栏目展示，完成端到端闭环
- **实现：**
  - 改造 `company/rules.vue`、`company/outsides.vue`、`company/knowledge.vue` 等页面，调用 `/api/documents` 查询对应类型且 status=2 的文档
  - 文档预览页 `documents/[uuid].vue` 显示 `publish_info` 标记
  - 更新 `codocs_schema.sql` 追加新表定义
- **Demo：** 完整流程演示：选文档 → 提交审阅 → 审阅人批注+通过 → 发起人归档 → 文档出现在目标栏目页面

---

## 6. 新增文件清单

### 数据库

- `server/migrations/create_review_tables.sql`

### 后端 API

- `server/api/reviews/templates/index.get.ts`
- `server/api/reviews/templates/index.post.ts`
- `server/api/reviews/templates/[id].patch.ts`
- `server/api/reviews/templates/[id].delete.ts`
- `server/api/reviews/index.post.ts`
- `server/api/reviews/[id].get.ts`
- `server/api/reviews/by-document/[uuid].get.ts`
- `server/api/reviews/my.get.ts`
- `server/api/reviews/[id]/approve.post.ts`
- `server/api/reviews/[id]/reject.post.ts`
- `server/api/reviews/[id]/remind.post.ts`
- `server/api/reviews/[id]/resubmit.post.ts`
- `server/api/reviews/[id]/archive.post.ts`
- `server/api/account/department-info.get.ts`
- `server/utils/reviewNotify.ts`
- `server/utils/reviewEngine.ts`

### 前端页面

- `app/pages/admin/publish.vue`
- `app/pages/reviews/index.vue`
- `app/pages/reviews/[id].vue`

### 前端组件

- `app/components/review/SubmitReviewModal.vue`
- `app/components/review/ReviewFlowChart.vue`
- `app/components/review/ReviewTimeline.vue`
- `app/components/review/ArchiveConfirmModal.vue`

### 修改文件

- `app/pages/departments/coworks.vue` - 下拉菜单添加"提交审阅"
- `app/pages/projects/index.vue` - 下拉菜单添加"提交审阅"
- `app/pages/documents/[uuid].vue` - 显示 publish_info 标记
- `app/config/permissions.ts` - 添加审阅中心菜单和权限
- `app/pages/company/rules.vue` - 对接归档文档查询
- `app/pages/company/outsides.vue` - 对接归档文档查询
- `app/pages/company/knowledge.vue` - 对接归档文档查询
- `codocs/docs/codocs_schema.sql` - 追加新表定义
