# 项目成果页 Host 合同（R2a）

## 页面与通道

`/aims/projects/:id/output` 恢复立项书/需求规格书卡片、交付文档表格、全量统计与仓库区块。只展示 document 成果；通用成果 list 仍保留 code/artifact/task 类型。交付状态与质量状态分别呈现，已有文档的 pending 行沿用旧页面展示为 submitted 的规则，这只是展示投影，不写领域状态。

| Host GET | 固定 U operation | Runtime POST | permit |
| --- | --- | --- | --- |
| /aims/api/v1/projects/:id/output | aims.project-output-overview | /v1/enterprise/aims/project-output:view | projects:view + 绑定父项目的 projectReadAuthorization |
| /aims/api/v1/projects/:id/repo-candidates | aims.project-repo-candidates | /v1/enterprise/aims/project-repos:candidates | project-repos:edit + projects:edit 的短期 CommandScope |

两者只使用 `aims:enterprise-host:execute`，用户与租户/部署取已验证会话；owning 公共入口为 `aims/layer/server/index.ts`。不经 Aims Service HTTP，不申请 aims.read/write，不增服务 grant。Host read 只接受 page/pageSize，禁止调用者提供状态、类型、actor、部门或范围事实。U 签名 body 内的范围由现有 Foundation helper 生成，Runtime 校验 actor/tenant/deployment、≤15s 和策略版本，再复核 owning 项目。

## 输出读取

`overview` 返回 `{code:0,data:{items,total,page,pageSize,stats,documents,repos}}`。`stats` 包含 total/approved/submitted/pending/rejected；与列表使用相同 SQL 条件，document 过滤先于 COUNT/LIMIT。page 默认1、pageSize默认20，上限100。

COUNT、状态汇总、当前页、分类文档与仓库行处于同一个 read-only REPEATABLE READ 事务。分类卡片按真实 docCategory=project_proposal/requirement_spec 查找，遍历项目索引目录树，不依赖成果页第一页，不把文件夹当作卡片；同类别多份时采用索引既有 sort_order/created_at 顺序中的第一份。项目集独占文档保持排除。卡片和成果链接只提供元数据；点击后的 Codocs/GitLab/附件权限仍由 P1 typed 核心执行，不因索引可见就获得正文 ACL。

## 仓库区块

列表及关联/解除沿用已有 project-repo-list/link/unlink 与稳定命令意图键。解除只删项目关联，不删除仓库/提交。多选关联逐仓库命令执行，明确不是新增的全事务批量命令；成功项从待提交列表移除，失败项保留同键重试。

候选从 Runtime 权威 `aims_projects.portfolio_id → project_portfolios.git_group` 得到组；Serializable 事务内复核签名 projects:edit 范围与当前经理/负责人规则，company 公开读不用于此动作；不接受浏览器提供组路径。随后 owning typed 核心调用现有 Foundation GitLab group-projects 固定操作，只投影项目路径/名称，不返回凭据。所有返回路径须为该组的子路径，否则503，不返回部分列表。无登记组返回空候选并显示原因；不回退 Account 全目录。不改变现有关联命令的选仓范围合同。

GitLab namespace/project 路径按 P1 规则：单个斜杠分段、无`..`、无空段/首尾斜杠、总长≤255。目标存量 repo_commit_id 不因页面读取更新。R2a 不写质量结果；R2b 质量动作合同见下文。

## 验证

`TestProjectOutputPermitAndInputMatrix`、`TestProjectRepoCandidatesRequireScopedEdit`；项目成员隔离 MySQL 套件内新增 `R2a output projection`，覆盖混合类型、多页/空页、统计、分类卡片、仓库目录、撤权和范围外 company 不可编辑；Enterprise `aims-project-output-r2a.test.mjs` 覆盖 owning 真实调用、候选越界失败关闭、单一 reader 注入与两个 SFC 编译。浏览器/真实 GitLab 环境验收另行安排，不由实现测试宣称通过。


## R2b 质量动作

新增固定 U 操作（仍为 `aims:enterprise-host:execute`，不新增 capability/grant）：

| 操作 | Runtime 路由 | 人员/范围与关系 |
| --- | --- | --- |
| aims.quality-submission-resume | POST /v1/enterprise/aims/deliverable-quality:submission-resume | projects:view 的精确项目投影 + 当前成员/负责人/范围项目管理员；只读原意图回执的受检快照，无业务/回执写入 |
| aims.quality-submission-create | POST /v1/enterprise/aims/deliverable-quality:submission-create | projects:view + 当前成员/负责人/范围项目管理员；服务端解析版本/hash，当前 QA 唯一持有人决定自提交分流 |
| aims.quality-submission-activate | POST /v1/enterprise/aims/deliverable-quality:submission-activate | projects:view + 当前成员/负责人/范围项目管理员 + 提交者；Codocs 受检版本 grant 或确定仓库快照 |
| aims.quality-completeness | POST /v1/enterprise/aims/deliverable-quality:completeness | projects:view + 当前责任项目经理/有效代理（不等同所有 manager 成员） |
| aims.quality-waiver | POST /v1/enterprise/aims/deliverable-quality:waiver | quality_reviews:waive 的项目投影 + 当前唯一项目总监及 revision |

送检与完整性不新加 projects:edit 门槛（推荐 QA 角色不持该权限），沿用独立端的项目关系门槛，并叠加 PA-01 精确范围。写入不应用 company 公开读取例外。Runtime 验证 actor/tenant/deployment/project/object、政策版本/hash/revision、allowed 与≤15 秒 TTL 后，Registry 事务内按项目→对象复核归属与关系，之后才读旧 receipt。完整性确认锁住本项目代理行并重验当前责任人；QA/总监事实由 Host 即时 Console helper 解析并随完整 HMAC 委托签名，浏览器不能传入。

Host 路由：

- POST /aims/api/v1/projects/:id/deliverables/:deliverableId/submissions：body `{}`，服务端确定快照，不接受浏览器 documentVersionId/hash/角色事实。
- POST /aims/api/v1/projects/:id/deliverable-submissions/:submissionId/confirm-completeness：仅 `{action:pass|return, comment?}`，退回须非空说明。
- POST /aims/api/v1/projects/:id/deliverables/:deliverableId/waivers：仅 `{reason}`，非空且≤1000 UTF-8 字节；完整性 comment≤4000 字节。

三路必须有合规 Idempotency-Key、无 URL query；响应 private,no-store。送检的 create/activate 子键分别为原键 `:create`/`:activate`；每次重试先查询同意图回执并重验当前成员/范围。已建提交后来源的 latest 发生变化，仍用首次受检版本重施 Codocs ACL、验证同 hash，继续同 grant 和激活；不能把新版本写入原意图。仓库始终固定绑定 commit。外部 resolve/grant 完成后重新取短期 permit；grant 失败保留 preparing_review，原键可恢复，不以伪造 grantId 跳过。

Codocs 复用 P1 已登记双来源版本解析与受检授权合同：`codocs:project-document:version:resolve` / `codocs:project-document:review-grant:create`，当前来源 enterprise.runtime；独立 Aims 保留原来源。grant 严格核对 uuid/version/submissionNo/受检角色。GitLab 复用既有固定提交文件读取。环境 grant/源目录可用性本批未探测。

Registry Tx 复用现有 service_command_receipt，无 DDL；质量记录、成果状态与 receipt 同事务，故障整笔回滚；回放前仍复核范围、当前成员/经理/总监。回执保存绑定项目/对象/action/结果 ID，提交不可变快照可用于恢复下一阶段。旧独立 handlers 使用自己的原事务；共享领域核心仅在服务端已安装 Tx 时借用外层事务，不允许其内部 Commit 提前提交外层。

QA 提交走“PM 完整性→总监质量”而非自检；非 QA 提交走 QA 质量。完整性 pass **不把质量置为 passed**，仍需后续质量评审；return 记录缺失项并退回。豁免只记录理由/总监责任版本并置 waived，不等同质量通过。最终 QA/总监质量审核仍保留既有独立质量页面，不在 R2b 新建浏览器 approve/reject 接口。

新增隔离 MySQL 子测试 `R2b quality writes` 在 t.Cleanup 中清理自己的项目、成员、检查清单、提交、评审、豁免和 receipt/故障 trigger；保留 R2a 的原 cleanup，不污染 P6a 等后续 COUNT。
