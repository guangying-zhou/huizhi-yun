# PA-01 第 3 批：59 个 Host 写入口最终收口（2026-09-28）

口径：逐入口清单来自 `.git/codex-pa01-b3-entry-inventory.md`。这里的“已覆盖”只指 **项目数据范围写入复核**有 Host/Runtime 实现及隔离测试，不等同浏览器业务正例。company L0/L1 例外只适用于读；写入逐对象复核当前关系与签名范围。项目导出能力仍不存在，未新增。

| # | Host 路由（相对 `enterprise/server/routes/aims/api/v1/`） | 范围复核状态与证据 |
|---:|---|---|
| 01 | `deliverables/[id].delete.ts` | 已覆盖 3D `fc735535`；PA-04 无写回执 |
| 02 | `deliverables/[id].put.ts` | 已覆盖 3D `fc735535`；PA-04 无写回执 |
| 03 | `deliverables/batch.post.ts` | 已覆盖 3D `fc735535`；全对象同事务预检，PA-04 无写回执 |
| 04 | `milestones/[id].delete.ts` | 已覆盖 3E1 `5d2db35c` |
| 05 | `milestones/[id].put.ts` | 已覆盖 3E1 `5d2db35c`；空日期校验 `c3fffc2c` |
| 06 | `projects/[id]/documents/[documentId]/access-check.post.ts` | F4a `d3b0a760`：项目范围 + Codocs ACL；只读业务判定，保留既有访问审计行，不改文档或策略 |
| 07 | `projects/[id]/documents/[documentId]/access-policy.put.ts` | F4a `d3b0a760`：`projects:edit` 范围 + Codocs edit ACL；浏览器正例延后 |
| 08 | `projects/[id]/markdown-documents.post.ts` | F4a `d3b0a760`：`projects:edit` 范围 + Codocs 创建权限；浏览器正例延后 |
| 09 | `projects/[id]/members/index.delete.ts` | 已覆盖 3B/PA-03；当前关系与范围在事务内复核 |
| 10 | `projects/[id]/members/index.post.ts` | 已覆盖 3B/PA-03；当前关系与范围在事务内复核 |
| 11 | `projects/[id]/members/index.put.ts` | 已覆盖 3B/PA-03；当前关系与范围在事务内复核 |
| 12 | `projects/[id]/milestones/[milestoneId]/rollover.post.ts` | 已覆盖 3E2 `de6c1425`；浏览器正例缺周期模板样本 |
| 13 | `projects/[id]/milestones/index.post.ts` | 已覆盖 3E1 `5d2db35c` |
| 14 | `projects/[id]/other-documents.post.ts` | F4a `d3b0a760`：`projects:edit` 范围 + Codocs 创建权限；浏览器正例延后 |
| 15 | `projects/[id]/products.post.ts` | 已覆盖 3E4 `debd0592`；浏览器新关联正例缺可清理样本 |
| 16 | `projects/[id]/repos.delete.ts` | F5 `a2cc947e`：`projects:edit` 范围 + 原经理门槛，锁内重验 |
| 17 | `projects/[id]/repos.post.ts` | F5 `a2cc947e`：同 #16 |
| 18 | `projects/[id]/requirement-targets.post.ts` | 已覆盖 3E2 `de6c1425` |
| 19 | `projects/[id]/sync-gitlab.post.ts` | F5 `a2cc947e`：项目范围、权威 repo ID/code、全局提交归属、整批事务；稳定键 + UPSERT；手动入站拉取无外发事件，outbox 不适用 |
| 20 | `projects/[id]/time-entries/[entryId].delete.ts` | 已覆盖 3E3 `fd603148`；PA-04 无写回执 |
| 21 | `projects/[id]/time-entries/[entryId].patch.ts` | 已覆盖 3E3 `fd603148`；PA-04 无写回执 |
| 22 | `projects/[id]/time-entries.post.ts` | 已覆盖 3E3 `fd603148`；PA-04 无写回执 |
| 23 | `projects/[id]/time-entry-reviews.post.ts` | 明确关闭：Host 固定 403（`bb44a7a3`）；启用前须另审 owning project/审核授权 |
| 24 | `projects/[id]/weekly-reports/[periodKey]/draft.put.ts` | 已覆盖 3E5 `123ad580` + 签名 submit 桥 `2d772517`；浏览器正例缺责任清单 |
| 25 | `projects/[id]/weekly-reports/[periodKey].post.ts` | 已覆盖 3E5 `123ad580` + `2d772517`；浏览器正例缺责任清单 |
| 26 | `projects/[id]/work-items/index.post.ts` | 已覆盖 3B `210621e2` |
| 27 | `projects/[id].delete.ts` | F1 `76b4bdbb`：补范围复核且保留原生命周期/删除门槛，未开放新能力 |
| 28 | `projects/[id].put.ts` | 已覆盖 3B `210621e2` + PA-03；经理关系与范围复核 |
| 29 | `projects/index.post.ts` | F1 `76b4bdbb`：拟建 code/部门求值，创建前全部关系事实 false，部门范围不允许空部门降级 |
| 30 | `work-items/[id]/append-tasks.post.ts` | F2a `bb06dc1b`：owning project 与全子项预检，原动作门槛保留 |
| 31 | `work-items/[id]/association.put.ts` | 已覆盖 3B `210621e2` |
| 32 | `work-items/[id]/breakdown.put.ts` | F2a `bb06dc1b`：owning project 与全子项预检 |
| 33 | `work-items/[id]/clone-from-template.post.ts` | F2b `50d42f3c`：owning project 与模板来源分别核对 |
| 34 | `work-items/[id]/comments.post.ts` | F5 `a2cc947e`：`work_items:edit` 范围、事项归属与原成员门槛 |
| 35 | `work-items/[id]/commits/[commitId].delete.ts` | F5 `a2cc947e`：当前项目/事项归属；允许清理仓库关系已失效的旧关联 |
| 36 | `work-items/[id]/commits.post.ts` | F5 `a2cc947e`：提交归属项目且仓库仍关联，原成员门槛保留 |
| 37 | `work-items/[id]/completion-replay.post.ts` | 已覆盖 3C `9e7aa0f1`；回放前复核撤权 |
| 38 | `work-items/[id]/completion.post.ts` | 已覆盖 3C `9e7aa0f1` |
| 39 | `work-items/[id]/confirm-append.post.ts` | F2a `bb06dc1b`：确认动作独立门槛 + owning project 范围 |
| 40 | `work-items/[id]/confirm-distribute.post.ts` | F2a `bb06dc1b`：同 #39 |
| 41 | `work-items/[id]/decompose-submit.post.ts` | F2b `50d42f3c`：owning project 与分解子项事务复核 |
| 42 | `work-items/[id]/deliverables/[deliverableId].patch.ts` | 已覆盖 3D `fc735535`；PA-04 无写回执 |
| 43 | `work-items/[id]/deliverables.post.ts` | 已覆盖 3D 批量命令 `fc735535`；PA-04 无写回执 |
| 44 | `work-items/[id]/documents/[documentId].delete.ts` | F4b `81695cf8`：owning project + 当前关联；允许失去 Codocs view 后解绑，不动文档 |
| 45 | `work-items/[id]/documents.delete.ts` | F4b `81695cf8`：集合 DELETE 固定 400、Host 隐藏入口；未新增全量解绑语义 |
| 46 | `work-items/[id]/documents.post.ts` | F4b `81695cf8`：owning project + 来源索引存在 + Runtime 原生 Codocs view ACL |
| 47 | `work-items/[id]/matter-completion.post.ts` | 已覆盖 3C `9e7aa0f1` |
| 48 | `work-items/[id]/plan-ready.post.ts` | 已覆盖 3C `9e7aa0f1` |
| 49 | `work-items/[id]/reject-append.post.ts` | F2a `bb06dc1b`：确认/驳回独立门槛 + owning project 范围 |
| 50 | `work-items/[id]/reopen.post.ts` | 已覆盖 3C `9e7aa0f1` |
| 51 | `work-items/[id]/reset.post.ts` | 已覆盖 3C `9e7aa0f1` |
| 52 | `work-items/[id]/revoke-distribute.post.ts` | F2a `bb06dc1b`：owning project 范围 + 原业务门槛 |
| 53 | `work-items/[id]/start.post.ts` | 已覆盖 3C `9e7aa0f1` |
| 54 | `work-items/[id]/time-entries/[entryId].delete.ts` | F3 `6db68f2d`：自身 `timesheet:edit` 范围 + 事项/工时锁内归属复核；PA-04 |
| 55 | `work-items/[id]/time-entries/[entryId].patch.ts` | F3 `6db68f2d`：同 #54 |
| 56 | `work-items/[id]/time-entries.post.ts` | F3 `6db68f2d`：同 #54 |
| 57 | `work-items/[id].delete.ts` | F1 `76b4bdbb`：事项 owning project 范围 + 原 delete 门槛 |
| 58 | `work-items/[id].put.ts` | 已覆盖 3B `210621e2` |
| 59 | `work-items/batch.patch.ts` | F1 `76b4bdbb`：全对象加锁预检，一项越权整批回滚 |

## 结论与验收边界

- 59 个已暴露入口中，项目范围写复核已逐入口实施或明确失败关闭：#23 审核写固定 403，#45 集合 DELETE 固定 400；其余按表中批次执行自身动作授权、签名项目范围和 Runtime 权威归属复核。F1/F2/F3/F4/F5 的隔离 MySQL 与 Host 合同包含跨项目 ID、范围外 company 公开项目可读不可写、批量一项越权整笔回滚、撤权后旧回执拒绝等反例。F4b/F5 在本机 Runtime `0.3.271-test.pa01-f45.1` 配套上线，随后已审分页补修随 `0.3.272-test.p6-pagination.1` 上线；两次均通过 156/156 视图、启动探测、本机/公网三轮 200 与匿名写 401，Host ingress 在 F4b/F5 切换后 7/7。回滚备份见 `.git/pa01-f45-runtime-271-receipt.json` 与 `.git/pa01-p6-272-runtime-272-receipt.json`。测试只证明所列合同，不扩大独立 Aims 或 Console 目录项目范围。
- F4a 的项目 Markdown/附件创建、访问策略修改浏览器正例延后：hzy0 缺可信 Codocs 服务绑定，不能冒用 personal 身份或伪造绑定。隔离合同已证明 Codocs 调用前项目 scoped edit 拒绝无副作用。F4b link 需要来源索引中存在且操作者持有 Codocs view 的样本；当前不为抽验制造悬空关联。仓库/同步 Host 页面未迁入、无可安全清理的 GitLab 仓库样本，F5 浏览器正例按实际可达性记录；不能把合同测试称为登录态正例。
- 周报签名桥已部署；263 草稿保存因本机没有正式周报周期/应报清单而返回 `409 weekly_report_obligation_required`，无业务行。2026-W40 单项目试点参数已获确认，执行前加密备份与差集预演通过，但 Host/Aims 缺正式的周报设置和试点项目配置页/命令；按停止条件未写配置、周期、义务或报告。周报写链本次以隔离 MySQL 合同证据收口，浏览器正例记缺口。后续先实现正式配置入口，再按原方案核对影响范围、撤销路径、历史/通知副作用并执行。
- PA-04：成果、项目/事项工时、仓库/评论/提交关联缺 service-command 写回执；F5 同 payload 稳定键与 UPSERT 只保证同步数据不重复，不承诺响应丢失后的精确一次回执。项目级 export 能力/Host 命令不存在，本轮没有新增。周报审核/修正、独立 Aims 写路径与 Console 目录项目管理不在这 59 个 Host 入口完成声明内。
- 浏览器已覆盖的正例、测试对象清理与剩余 UI 缺口以 `.git/codex-report-round3.md` 及 `docs/Unified-Enterprise-UI-Gap-Register.md` 的逐项回执为准。本表作为 PA-01 第 3 批**代码与合同收口**；浏览器数据准备缺口保留。用户已取消 PA-01 第 4 批 Platform 项目范围管理：不新增范围页、assignment-scopes API 或控制面写入；项目访问改由 PA-02 可见范围与权威成员关系管理，第 1–3 批 Runtime 范围执行仍保留。R 复验改用新标记 project_team 项目，按“非成员不可见→viewer 成员可见→移除后不可见”计时；263 既有可见性不改。并行分页功能的附带抽验：zhouguangying 任务中心 26 项（执行中 24、确认中 2），执行中第 1 页 20 项、第 2 页 4 项且记录不同；私人目录根节点 5 文件夹、3 文档，页面可读但无多页样本，跨页正确性仍以隔离测试为证。
