# 文档资产 DOC-05 / DOC-06 实施细化稿

日期：2026-10-04。版本：0.1（待用户与协调方确认后开工）。起草：Claude（Fable）。

上位文档：[文档资产统一管理设计](./Document-Asset-Unified-Management-Design.md)（下称“设计”）。本文只细化 DOC-05（项目集成员与授权）和 DOC-06（文档表存储维度）的表结构、代码范围、迁移步骤与验收；不包含代码，也不声明任何一项已实施。表结构变更在任何环境执行前仍需逐项批准。

已确定的前提（用户 2026-10-04）：组内项目成员默认可读项目集/产品线文档，可逐份关闭；密级 L2 及以上不继承；项目集的 GitLab 文档仓库在项目集设置中登记；GitLab 内容在平台内只读。

## 1 代码核对后的两点修正

1. **Codocs 文档表不在统一业务库。** 统一库登记的域是 aims、assets、altoc、finance、people、align、insights、workflow；`documents` 等表在 Codocs 自己的库，由 Runtime 的 Codocs 适配器访问。因此 DOC-06 不涉及统一库映射与兼容视图，改动面是 Codocs 库 + Codocs 适配器 + 调用方。
2. **`git-project` 现在表示“仓库文档的 OSS 副本，放在项目文档桶”。** 这些文档的内容实际在 OSS，不在 GitLab。所以它们迁移后是 `storage_type=oss`、桶为项目文档桶，并带一条“来源于某仓库某路径某 commit”的记录；真正的 `storage_type=git`（内容只在仓库、平台按 commit 读取）目前只存在于 Aims `project_documents.document_source='repo'`，要到 DOC-07 才进入主表。

受影响面（引用 `oss_path` 的文件数，仅供估量）：Runtime Codocs 适配器 41、Codocs 服务端 75、Enterprise 服务端 22。因此 DOC-06 必须分步、每步可独立上线并可回退。

## 2 DOC-06 文档表存储维度

### 2.1 表结构（Codocs 库，全部为新增列，不改现有列）

`documents`：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `storage_type` | `ENUM('oss','git') NOT NULL DEFAULT 'oss'` | 内容所在的存储 |
| `storage_locator` | `JSON NULL` | `oss`：`{"bucket":"documents"\|"projects"}`，对象路径仍用 `oss_path`。`git`：`{"integrationCode","repoPath","filePath","ref"}` |
| `origin_json` | `JSON NULL` | 来源记录，不参与读取定位。仓库副本：`{"type":"git","repoPath","filePath","commitId"}` |

`document_versions`：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `storage_revision` | `VARCHAR(128) NULL` | `git` 文档的 commit ID；`oss` 文档为空，继续使用 `oss_version_id` / `object_key` |

约定：

- `oss_path` 本阶段保持 `NOT NULL`。`storage_type=git` 的记录写空串，读取代码以 `storage_type` 为准，不再以 `oss_path` 非空推断。是否改为可空留到全部读取路径收口之后。
- `storage_locator` 为空等价于 `{"bucket":"documents"}`，保证存量零回填也能正确读取；回填只是把隐含值写实。
- `content_sha256` 两种存储都填写。

### 2.2 分步

| 步 | 内容 | 行为变化 | 可回退性 |
| --- | --- | --- | --- |
| 6a | 加列；回填：`doc_type='git-project'` 的行写 `storage_locator={"bucket":"projects"}`，其余写 `{"bucket":"documents"}` | 无 | 新列可保留不用 |
| 6b | 判别收口（即原 DOC-04 的代码部分）：Codocs TS 与 Runtime Go 各新增一个定位函数，输入文档行，输出 `{存储, 桶, 路径 \| 仓库, 文件, 版本}`；把约 20 处 `git-project` 判断与桶选择改为调用它。函数在 `storage_locator` 为空时回落到旧的 `doc_type` 判断 | 无（回归覆盖两种桶） | 代码回退即可 |
| 6c | `storage_type=git` 的读取：详情、预览、按固定 commit 读内容，经平台判权后走 Runtime 的 GitLab 只读固定操作；编辑、快照、协作、删除内容等写入口对 `git` 文档固定返回 `409 document_storage_read_only`；页面不显示编辑入口 | 新能力，存量无此类记录 | 无此类记录时等同未启用 |
| 6d | 取值规范：`git-project` 改写为 `project`，同时写入 `origin_json`；停止写入旧值。前提是 6b 已在所有运行 Codocs 代码的进程上线 | 列表筛选与标签沿用新口径 | 改写前导出 `id, doc_type` 清单，可按清单恢复 |

6a、6b 可以先行；6c 与 DOC-07（把 Aims 的仓库引用登记进主表）一起才有实际数据；6d 最后做。

### 2.3 代码范围

| 模块 | 文件或位置 |
| --- | --- |
| Codocs schema | `codocs/docs/codocs_schema.sql`、新迁移 `codocs/docs/migrations/20261005_document_storage_dimension.sql` |
| Runtime Codocs 适配器 | `data-runtime/internal/apps/codocs/`：新增 `document_storage.go`（定位函数）；改 `document_queries.go`、`document_lifecycle.go`、`collaboration.go`、`issues.go` 中按 `project`/`git-project` 的判断；写入口加只读拒绝 |
| Codocs 服务端 | `codocs/server/utils/oss.ts`（桶选择）、新增 `documentStorage.ts`；`projectDocumentQualityService.ts`、`api/documents/download-content.post.ts`、`api/documents/[uuid]/versions/[versionId].get.ts`、`api/project-docs/files/[...projectCode].get.ts` |
| Codocs 页面 | `app/utils/oss-client.ts`、`app/composables/useRecycleBin.ts`、`app/pages/documents/index.vue`、`app/pages/documents/[uuid].vue`、`app/pages/projects/repos.vue`、`app/types/index.ts` |
| Enterprise | 仅 6c：文档详情与预览的只读呈现；不改现有个人/部门文档写路径 |
| 文档 | Codocs schema 与 API 文档、`MODULE_CONTRACTS.md`、设计文档状态 |

不改：快照发布、协作会话、文件柜、个人与部门文档的现有读写行为。

### 2.4 验收

- 6a：迁移可重复执行；回填前后各 `doc_type` 行数不变；新列默认值正确。
- 6b：直接比较 `git-project` 的代码只剩定位函数；两种桶的列表、详情、版本读取、下载、回收站、质量评审回归通过；`storage_locator` 为空与已回填两种数据都通过。
- 6c：`git` 文档可读取并显示当前 commit；无权限用户 403；写入口 409 且不产生任何 OSS 或 GitLab 请求；GitLab 不可用时 503 而不是 403。
- 6d：改写前后数量对账；`origin_json` 与原 OSS 元数据中的 commit 一致；恢复清单可用。

## 3 DOC-05 项目集成员与授权

### 3.1 表结构

Aims 域（统一库）新增 `project_portfolio_members`，结构参照 `product_members`：

| 列 | 说明 |
| --- | --- |
| `portfolio_id` | 项目集 |
| `uid` | 成员 |
| `relation_type` | `manager` / `contributor` / `viewer` |
| `status` | `active` / `inactive` |
| `valid_from`、`valid_until` | 生效与失效时间；约束 `valid_until > valid_from` |
| `revision` | 乐观并发 |
| `created_by`、`updated_by`、`created_at`、`updated_at` | 审计 |

同一项目集、同一人、同一关系类型只允许一条生效记录。项目集负责人（`owner_uid`）视为 `manager`，不要求另建成员行。

`project_portfolios` 新增 `doc_repo_path VARCHAR(255) NULL`：登记的文档仓库（可空）。现有 `git_group` 保留为代码组织信息，不参与授权。

Codocs `document_access_policies` 新增：

| 列 | 说明 |
| --- | --- |
| `source_owner_type` | `ENUM('project','portfolio','product_line') NOT NULL DEFAULT 'project'`。项目集编码与项目编码可能同名，必须显式区分归属类型，不能靠编码猜 |
| `inherit_to_member_projects` | `TINYINT NOT NULL DEFAULT 1`。组内项目成员是否可读；默认可读 |

统一库加表需按既有协议登记映射并安装兼容视图。

### 3.2 授权规则

资源与动作沿用 Aims manifest 现有的 `portfolios`（view / edit / admin），不新增资源或静态角色；成员关系作为动态关系参与判权。产品线沿用 `products` 与已有的 `product_members`。

| 主体 | 项目集文档 |
| --- | --- |
| 项目集 `manager`（含负责人） | 读、写、删除、改访问策略 |
| 项目集 `contributor` | 读、写 |
| 项目集 `viewer` | 读 |
| 组内项目的成员（非项目集成员） | 仅读，且同时满足：文档密级为 L0 或 L1；该文档 `inherit_to_member_projects=1` |
| 其他人 | 按文档分享关系与企业内访问策略，与现状一致 |

要点：

1. 判权在服务端一次完成，保留“角色、权限、数据范围、来源、有效期”的同一上下文：静态权限 `portfolios:view/edit` 与成员关系必须同时成立，不能分别满足后拼接。
2. “组内项目的成员”按当前事实判定：项目当前归属该项目集，且此人当前是该项目的有效成员。项目移出项目集或成员失效后立即失去继承的读取权。
3. L2、L3 不继承；继承只给读取，不给下载以外的任何写入或授权能力。下载是否随读取开放沿用文档策略的 `default_permission`。
4. 权限判定来源统一为 Codocs 的关系索引与访问策略；Aims `project_documents` 上的镜像字段只用于展示。
5. 成员的增删改需要 `portfolios:admin` 且为该项目集的 `manager`；写入带稳定幂等键，记录审计。

### 3.3 代码范围

| 模块 | 内容 |
| --- | --- |
| Aims schema 与 manifest | 新表、`doc_repo_path`；manifest 中 `portfolios` 的数据范围说明；`aims/docs` 的 schema 与 API 文档 |
| Runtime Aims 适配器 | 项目集成员的读写（固定用户操作，走现有 `aims:enterprise-host:execute`，不新增服务能力）；项目集范围复核函数；把 `enterprise_project_document_write.go` 中项目集归属固定 409 的分支换成真实判权；项目文档列表与可访问文档查询纳入项目集文档 |
| Runtime Codocs 适配器 | 访问策略新增两列的读写；继承读取的判定 |
| Foundation | 项目集命令授权的 permit 编译（参照 `projectCommandAuthorization`）；统一授权 helper 的关系来源扩展 |
| Enterprise | 项目集设置页增加成员页签与文档仓库登记；项目文档页显示所属项目集的文档（只读区）；固定操作登记与就绪清单重新生成 |
| 统一库 | 新表的映射、兼容视图与安装规格 |

新增 Runtime 固定用户操作预计 4 个（成员列表、成员保存、项目集文档列表、项目集文档写入复用现有创建/摘要/删除并扩展归属），不新增能力或授权条目。

### 3.4 验收

- 成员增删、生效与失效时间、撤权后立即拒绝；负责人无成员行也按 `manager` 判定。
- 继承：组内项目成员可读 L0、L1；L2、L3 拒绝；`inherit_to_member_projects=0` 拒绝；项目移出项目集后拒绝；成员失效后拒绝。
- 同名编码：项目集编码与某项目编码相同时，归属类型不被混淆，权限不串。
- 写入：`viewer` 与继承读取者写入 403；跨项目集对象 403；重放幂等；旧幂等键在撤权后仍被拒绝。
- 授权回归矩阵：角色合并、模拟隔离、自定义角色、动作蕴含、数据范围、过期授权。
- 存量：此前在 Host 上被固定拒绝的项目集文档可按新规则读写；项目页不再把项目集文档混入或排除错误。

## 4 顺序、依赖与批准点

| 顺序 | 项 | 依赖 | 需要批准的环境动作 |
| --- | --- | --- | --- |
| 1 | DOC-06a、6b | 无 | Codocs 库加列与回填（逐环境） |
| 2 | DOC-05 | 无（可与 1 并行；与 Codocs 策略表的两列新增合并进同一次 Codocs 迁移） | 统一库加表与视图安装；Codocs 库加列；策略包如有变化需重新生成 |
| 3 | DOC-06c + DOC-07 | 1、2 | 数据登记回填 |
| 4 | DOC-06d | 3，且 6b 已在全部相关进程上线 | 数据改写 |

与其它主线的协调：DOC-05 会改 `aims` 的 Runtime 适配器、manifest 与 Enterprise 项目文档相关文件；DOC-06 会改 Codocs 适配器与 Codocs 应用。开工前把精确文件清单发协调方，避开在途改动。

## 5 已确认事项（用户 2026-10-04）

1. 项目集成员关系沿用与产品成员一致的三种：`manager` / `contributor` / `viewer`。
2. 本批只做项目集；产品线沿用已有产品成员，在判权函数里预留归属类型，下一批接入。
3. 继承的读取不额外放宽下载，是否可下载由每份文档策略的 `default_permission` 决定。

## 6 进度

- DOC-06a（加列与回填迁移 `codocs/docs/migrations/20261005_document_storage_dimension.sql`）、DOC-06b（判别收口：Runtime `document_storage.go`、Codocs `shared/utils/documentStorage.ts`）代码已完成，待合入；迁移未在任何环境执行。
- DOC-06a 迁移的执行方式：两条 `ALTER TABLE ... ADD COLUMN` 只能执行一次，执行前先确认列不存在；需要重跑时只执行文件末尾的两条回填 `UPDATE`。
- DOC-05a（项目集成员与文档仓库登记，后端与 Host 路由）代码已完成，待合入；表未在任何环境安装。与 §3.1 的差异：成员表命名为 `aims_portfolio_members`，每个项目集每人一行（一人一种关系）；文档仓库不在 `project_portfolios` 上加列，而是独立表 `aims_portfolio_doc_repos`，避免改动已安装的兼容视图；两表不进兼容视图族，统一库经域安装子集 `aims-portfolio-members` 安装。统一库安装器子集尚未交付。
- DOC-05 拆为三段：5a 成员（本条）；5b 项目集文档判权与继承、Codocs 访问策略两列；5c 页面。
- 5b 再拆为 5b-1（只读，已合入，见 §8）与 5b-2（登记、移除引用与策略维护，代码已完成，待合入，见 §9）。迁移 `codocs/docs/migrations/20261007_document_access_policy_owner.sql` 未在任何环境执行。

## 7 目录登记与内容访问合同（DOC-07，取代原 §2.2 的 6c 与设计 §4.4 的补登记做法）

协调方代用户决定（2026-10-04）：外部文档的登记不写入 `documents`，而是放在结构上隔离的独立目录表。原因是 Runtime 中直接访问 `documents` 的语句有 102 处、分布在 38 个文件，逐处过滤与只读守卫无法保证不遗漏；独立表使登记记录对所有现有读写路径天然不可见、不可写，也保住“代码与迁移可任意先后上线”。因此 DOC-06a 的 `storage_type` 维持 `('oss','git')`，不加 `module`；原 6c（`documents` 内的 git 文档读取与 409 守卫）不再需要。

### 7.1 数据（Codocs 库，候选迁移 `codocs/docs/migrations/20261006_document_catalog.sql`）

| 对象 | 说明 |
| --- | --- |
| `document_catalog_entries` | 一行一个外部文档：确定性 `uuid`、租户、来源（app、kind、object id）、标题、归属（project / portfolio / product_line + 编码）、`storage_type`（`git` / `module`）、`storage_locator`、当前 `storage_revision`、`content_sha256`、`status`（active / inactive）、行版本 |
| `document_catalog_entry_versions` | 每个文档每个版本一行，只增不改 |
| 视图 `document_catalog` | `documents`（只取元数据列，排除已删除与回收站）与有效登记的并集，只读；不依赖 DOC-06a 的新增列 |

- 身份：`uuid = UUIDv5(固定命名空间, tenant \0 app \0 kind \0 objectId)`，命名空间 `3f6c8f0e-6b0a-5c1e-9d4a-7a2b8c5e1f90` 属于合同，不得更改。
- 封闭的来源集合：`aims/project_repo_document`（git）、`aims/requirement_spec`（module）、`aims/project_weekly_report`（module）。其它 app 或 kind 一律拒绝。
- 只登记元数据，不复制正文；撤销或消失的对象标记 `inactive`，不物理删除；同一身份重新出现时恢复为 `active`。
- CREATE TABLE / CREATE VIEW 只执行一次，执行前用 `SHOW FULL TABLES LIKE 'document_catalog%'` 检查。仅适用于独立 Codocs 库；Codocs 进入统一库时的安装子集另议。

### 7.2 登记内容（由 Aims 给出“应登记清单”，目录对账到该状态）

| kind | 应登记的对象 | 对象标识 | 版本 | 内容哈希 |
| --- | --- | --- | --- | --- |
| `project_repo_document` | `project_documents` 中 `document_source='repo'`、非文件夹、仓库与路径齐全的行；归属项目，仅有项目集归属时归项目集 | 文档行 id | `repo_commit_id`；跟随分支时为空 | 无 |
| `requirement_spec` | 每个存在已基线章节的项目一条 | 项目 id | 已基线章节按稳定顺序计算的 SHA-256 | 同版本 |
| `project_weekly_report` | 状态为 frozen 且有冻结版本的周报 | 周报 id | 冻结版本号 | 事实快照哈希 |

### 7.3 写入路径

- **进程内 typed 调用**（ADR-018a D11，同进程同租户，不签服务令牌、不登记 grant）：Runtime 构造时把 Codocs 的目录存储注入 Aims；Aims 在自己的事务**提交之后**投递一次对账请求。
- **触发一律定向**，全量只留给对账命令：

  | 提交点 | 对账范围 |
  | --- | --- |
  | 项目文档写入（Enterprise 路径） | `project_repo_document`，按归属收窄到该项目（owner = project + 项目编码），可发现该项目下新增、变更与删除的行 |
  | 需求评审通过 | `requirement_spec`，该项目 |
  | 周汇总发布冻结 | `project_weekly_report`，本次纳入的周报 id |
  | 周汇总撤销解冻 | `project_weekly_report`，事务内先取出将被解冻的周报 id |

  空范围的请求不会被投递。独立 Aims 旧路径（兼容适配器的通用写入）**不挂触发点**，其变更只靠对账命令补齐。
- **单 worker 合并队列**（`documentcatalog.Syncer`）：触发只把 (kind, 范围) 记入内存中的待处理集合后立即返回，绝不阻塞、不失败 Aims 请求。同一 kind 的待处理请求合并（对象 id 取并集，归属逐个保留，全量覆盖定向）；一个后台 worker 串行执行。每个 kind 的待处理对象与归属合计上限 1000，超出部分丢弃并计数、记日志。Runtime 关闭时不等待队列排空；进程退出、丢弃、目录库不可用、表未安装或超时造成的缺口都不影响 Aims 业务结果，由对账命令修复。
- **次序合同（先取锁再读来源）**：写入型对账先在专用连接上取得按 `tenant / app / kind` 命名的库级锁（`GET_LOCK`，等待 10 秒，超时返回“目录忙”并放弃本次），**取锁之后**才读取 Aims 的应登记清单，再在同一连接的事务内写入，最后释放。因此任何一次写入所依据的来源状态，都不早于此前已完成写入所依据的状态；先开始的对账不可能用旧读数覆盖后开始的结果，当前版本指针不会回退。该保证同样覆盖多个 Runtime 进程以及对账命令与后台 worker 并发的情形。dry-run 不取锁、不写入。
- **对账命令** `data-runtime/cmd/hzy-document-catalog-reconcile`：默认只读 dry-run，输出各 kind 的差异（create / update / deactivate）；`--apply` 幂等写入。它是存量回填和一切漏登记的修复手段，也是唯一的全量入口。不做双向同步。

### 7.4 可见性与访问

- 目录表与视图只允许 `internal/documentcatalog` 引用；Runtime 其它包、Codocs / Enterprise / Foundation / Aims / Console / Workflow 的服务端与页面、Enterprise 路由、Gateway 拓扑与 egress 清单均不得出现，由源码级测试强制。
- 登记记录不出现在任何用户可达的列表、详情、搜索、统计中；本批不提供跳转或读取入口。
- 内容读取与判权留在原模块（项目范围、访问策略）。后续 DOC-09 索引使用目录时，必须由原模块按提问人实时判权，目录本身不授予任何访问权。

### 7.5 验证

- 单测：身份稳定与隔离、封闭合同拒绝、未安装返回“目录不可用”、dry-run 不写、create / update / deactivate、源码级单一归属。
- 单测（合并队列）：worker 忙时同 kind 的多次触发合并后只执行一次且串行；全量覆盖定向；队列满时丢弃并计数，调用方不被阻塞；空范围的业务触发不投递；四个触发点都紧跟在提交之后。
- 隔离 MySQL `node data-runtime/scripts/test-document-catalog-mysql.mjs`：真实迁移与视图；未安装 → 不可用；dry-run 零写；apply 与重放幂等；新版本追加一条版本行；定向对账不动其它对象；按归属对账只动该归属；并发两次对账时，后一次在取得锁之前不读来源，最终版本为最新且旧读数未被写入（可控伪来源模拟乱序）；其它租户的对账不被该锁阻塞；消失标记 inactive、重现恢复；租户隔离；`documents` 表全程不变；视图不含已删除与回收站文档且不可写。
- 隔离 MySQL（项目成员 runner 的子测试 `DOC-07 document catalog source`）：三类来源在规范 Aims 表结构上的取数口径。

## 8 项目集文档只读（DOC-05 5b-1）

范围：只读。项目集归属文档的写入仍固定 409（5b-2）；单份文档的打开与页面在 5c。

### 8.1 关系与判权

| 关系 | 来源（均按当前事实） | 可见文档 |
| --- | --- | --- |
| `manager` | 有效负责人，或有效的 `manager` 成员行 | 全部项目集文档 |
| `contributor` / `viewer` | 有效的成员行 | 全部项目集文档 |
| `inherited` | 当前归属该项目集的项目的负责人或有效成员 | 策略行显式归属本项目集、密级 L0/L1、`inherit_to_member_projects=1` 的 Codocs 文档；仓库引用文档不继承 |
| 无 | — | `403 portfolio_document_relation_required` |

- 人员权限 `portfolios:view`（Host）与关系（Runtime）必须同时成立；关系只由 Runtime 按签名 actor 计算。
- 负责人在 Directory 已非有效员工时视同无负责人（访问侧不再是隐含 `manager`；成员写侧按 5a 引导规则与最后一名管理者保护的“无负责人”分支计算）。目录预读在业务事务之前，只读负责人一个 uid，并与事务内锁定行绑定。
- 策略行缺失、归属类型不是 `portfolio` 或编码不一致时，一律按限制性默认（L2、草稿、不继承）：直接关系可读，`inherited` 不可读。任何情况下都不走“来源项目成员”规则。
- `inherited` 看不到被过滤文档的标题与数量；文件夹只作为可见文档的祖先出现。
- 下载只看策略 `default_permission`；全部结果只读。

### 8.2 存量策略行

加列后存量行默认 `source_owner_type='project'`。`hzy-document-catalog-reconcile --portfolio-policy-owners` 以 Aims 的项目集归属文档为准，把已存在的策略行标记为 `portfolio` 并写入项目集编码；默认 dry-run，`--apply` 幂等，不创建、不删除策略行，不改密级等其它字段，每次变更记一条 `policy_update` 审计。未标记前：项目集路径按限制性默认处理（安全但不继承）；项目路径的同名编码缺口仍在，启用前必须执行。

### 8.3 不可用时的行为

| 条件 | 项目集文档列表 | 项目文档列表 |
| --- | --- | --- |
| 成员表未安装 | `503 aims_portfolio_members_unavailable` | 省略 `portfolioDocuments`，`portfolioDocumentsUnavailable=true` |
| 策略两列未安装 | `503 codocs_portfolio_policy_unavailable` | 同上 |
| Directory 不可用 | `503 directory_subject_status_unavailable` | 同上 |

### 8.4 验证

- 隔离 MySQL `node data-runtime/scripts/test-portfolio-documents-mysql.mjs`：规范 Codocs 表 + 真实候选迁移；列未安装失败关闭且项目路径不受影响；同名编码反例（存量行不继承、不走来源项目成员；标记后项目路径也拒绝）；L0/L1 继承、L2/L3 不继承、关闭继承、其它项目集的策略行不采用；下载随 `default_permission`；对账 dry-run 零写、apply、重放幂等、只改归属字段、审计。
- 隔离 MySQL（项目成员 runner 子测试 `DOC-05 5b-1 portfolio documents`，统一模式）：三种直接关系与 `inherited` 的列表；`inherited` 的标题与数量不泄露；过期成员、停用项目成员、同名项目的负责人与成员、无关用户均 403；项目移出与成员移除即时撤权；负责人失效的访问侧与成员写侧正反例；依赖不可用；项目列表只读区；对账来源口径。
- Host 合同测试 `enterprise/test/aims-portfolio-documents.test.mjs`。

## 9 项目集文档写入与策略维护（DOC-05 5b-2）

### 9.1 范围决定

只做登记已有文档、文件夹、移除引用、策略维护。项目集下新建正文与上传附件不做：项目路径是先以 `doc_type='project'` + 项目编码在 Codocs 建文档或写文件柜，项目集没有对应的 Codocs 归属表示，把项目集编码当项目编码写入会在 Codocs 的项目文档列表、issue 关联与存储路径上重现同名串权。Codocs 侧的项目集归属并入 DOC-06c/6d 那批另行设计。页面（5c）给出“先在个人或部门空间创建，再挂入项目集”的引导。

### 9.2 权限矩阵

| 动作 | 人员权限 | 关系 | 其它条件 |
| --- | --- | --- | --- |
| 登记 Codocs 文档 | `portfolios:edit` | `manager` / `contributor` | actor 是该文档的 Codocs 所有者；文档未删除、未回收、未只读锁定；同一项目集内未登记过 |
| 登记仓库文件 | `portfolios:edit` | `manager` / `contributor` | 项目集已登记文档仓库；提交版本由 Host 冻结 |
| 新建文件夹 | `portfolios:edit` | `manager` / `contributor` | 父级为本项目集自有文件夹 |
| 移除引用 | `portfolios:edit` | `manager`；或 `contributor` 且为登记人、非文件夹 | 文件夹须为空 |
| 维护策略 | `portfolios:edit` | `manager` | 文档无策略行，或策略行已显式归属本项目集 |

- 挂入项目集等同于分享，所以门槛与 Codocs 的分享管理一致（仅所有者），高于“可编辑”。
- 策略行属于别处时不接管：登记可以，读取按 L2/不继承，维护返回 409。这样一份文档不会因为被挂入项目集而从原项目的策略里被摘走。
- 关系在写事务内对锁定行复核；负责人失效按 5b-1 规则；统一库持 Registry 代次栅栏。

### 9.3 一致性

- 登记与移除只写 Aims 一个库，单事务。
- 策略维护跨两个库：Aims 事务锁定项目集行、成员行与文档行后，进程内调用 Codocs 写策略（权威），再更新 Aims 镜像并提交。Codocs 已写而 Aims 提交失败时，镜像暂时落后（仅影响展示），重发同一状态即可修复——Codocs 对“已是目标状态”的保存是 no-op。

### 9.4 验证

- 隔离 MySQL `node data-runtime/scripts/test-portfolio-documents-mysql.mjs`（Codocs）：所有者方可登记，编辑分享与无关用户 403，已删除/回收 404，只读锁定 403；策略创建、重放 no-op、过期 etag 409、归档置只读、属于其它项目集或同名项目的策略行不被接管且行内容不变、审计；直接关系可见策略状态而继承关系不可见。
- 隔离 MySQL（项目成员 runner 子测试 `DOC-05 5b-2 portfolio document writes`，统一模式）：`viewer`/继承关系/无关用户写入 403；请求体含任何归属或身份字段 400；父级跨项目集或属于项目 400；分享能力拒绝优先且零写入；登记、重放同一行、同 uuid 异内容与他人重放 409、重复登记 409、`policyOwnedElsewhere` 标记；文件夹嵌套；仓库文件须先登记仓库并触发目录定向对账；撤权后重放拒绝；负责人失效与 Directory 不可用；Registry 代次不符零写入；项目入口仍拒绝项目集文档；策略仅管理者、输入校验、文件夹/仓库文件不支持、跨归属文档 404、Codocs 拒绝时镜像不变；移除的角色限制、非空文件夹、整树移除、重放 404、不触碰其它归属的行。
- Host 合同测试 `enterprise/test/aims-portfolio-documents.test.mjs`。

## 10 页面与内容打开（DOC-05 5c）

- 5c-1：项目集详情页 `/aims/portfolios/:id`（成员、文档仓库、项目集文档），已合入。合同见 MODULE_CONTRACTS“项目集详情页”。
- 5c-2：项目集文档正文只读查看。合同见 MODULE_CONTRACTS“项目集文档内容打开”。要点：同一判定函数；继承关系下“不允许”与“不存在”不可区分；宿主放出正文前二次复核且关系与权限不降级；响应不含存储定位。
- 用户决定（2026-10-04）：项目集下不直接新建文档，只挂入已有文档；Codocs 项目集归属设计不提前。
- 未做：仓库文件在线查看、下载入口、从“我的文档”选择器挂入、产品线归属。
