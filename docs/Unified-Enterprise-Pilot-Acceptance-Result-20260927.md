# Enterprise 本机试点验收结果（2026-09-27）

## 1. 口径与结论

- 执行：Codex-sol；整合负责人：Claude。日期均为 UTC；本机时区 ADT。仅 C000001 / hzy0、zhouguangying 与 test。
- 候选：`aa3fda74b90daca8ff6228b7f1dbccb926a5b47a`，Runtime `0.3.249-test.console-committee.1`。G01 已由 Claude 签字；Host 为 dev/HMR，不能作为不可变制品恢复证据。
- 依据：[试点脚本](./Unified-Enterprise-Pilot-Acceptance-Script.md)。受控详细回执为 `.git/codex-report-round3.md`；证据文件只保存摘要、ID、状态及脱敏截图，不含凭据。
- **结论：本机部分验收完成，未达到整轮试点/发布准入。** 员工正文 ACL、部分依赖恢复、多标签退出、项目更新幂等重放及旧版本保护通过；PA-01/03 阻断真实岗位授权正链。完整产品→版本→承接→项目链、读撤权、后台重复消费、两租户及不可变制品恢复仍需补验。
- 本轮无生产、云端、Platform 权限、grant、schema 或运行代码写入。Collab 关闭，外部通知阻断。历史 FE-2 / 隔离测试作为补充合同索引，不拼接为当前候选完整浏览器验收。

## 2. 门禁与岗位结果

| 项目 | 结果 | 实测与限制 |
| --- | --- | --- |
| G01 | 本机候选通过 | HEAD/Runtime/hash/进程起点已冻结；历史待审 LOCAL_RUNTIME 纯文档不影响运行候选 |
| G02 | 本机探测通过 | 四组真实服务签发 200，audience/scope/tenant/deployment/issuer 精确；匿名拒绝 |
| G03 | 本机一致性通过 | Aims/Assets 同一 active fence hash；Aims 5 条终态、processing lease 0，未发现双 owner |
| G04 | 备份准备通过，恢复缺口 | 三库加密备份及后续成员/F04新备份可解密；未在隔离副本完成整库恢复演练 |
| G05 | 口径已签，完整观察缺口 | 服务撤权≤5分钟、菜单≤10分钟；每岗位写观察≥30分钟并覆盖策略周期与相关 drain。本轮岗位链未满足完整窗口 |
| G06 | 关系传播局部通过 | manager 关系授≤23秒、撤≤14秒；写能力始终403，菜单写入口始终不可见，不计写授撤成功 |
| P01 | 部分 | Assets ID52 → 唯一 Aims 空间 HZ-TY-S-002，读取200、1440/390；完整回返/刷新及岗位交叉负例未齐 |
| P02 | 部分 | owner 两份标记正文200；test共享只读正文200、受限正文403。缺产品view+资料view但无正文ACL的临时产品岗位交叉验证 |
| P03～P05 | 未完成 | 本轮未执行标记需求采纳、simple版本确认、两种承接写分支完整链 |
| M01 | 部分 | owner既有经理读取与test无权拒绝；临时manager写正例受PA-03阻断 |
| M02 | 样本缺口 | 可用需求为draft，缺baselined需求+关联工作项，未伪造关联 |
| P06 | 样本缺口 | 缺第二个有权活动研发测试项目；两项目过滤合同不替代浏览器 |
| E01 | 通过（Claude接受） | test通知/待办200，共享列表200，文档289正文只读200；290正文403，产品/项目/需求直达403/404且无对象数据 |
| R01 | 缺口 | 无合适private/project_team测试样本；未授全局角色或改业务项目可见性 |
| A01 | 部分 | 基线与本轮关系清理核对完成；没有完整带范围岗位授撤/多标签撤权链 |
| P临时关系 | 缺正式入口 | Host未提供产品空间成员/owner管理页，未替代API或SQL授予 |

## 3. 故障与恢复结果

| 用例 | 结果 | 证据边界 |
| --- | --- | --- |
| F01 | 读取部分通过 | 分别停启本机Runtime/Console：新鲜读取503、无对象，原配置/二进制恢复后200；业务提交半写未测。外部存储provider本机不适用，保留P5 |
| F02 | 取消分支通过 | 暂停263 GET后正常切261；旧请求取消，新页无263数据。迟到响应真正到达、筛选/hash与撤权分支未齐 |
| F03 | 双标签退出通过，撤权缺口 | 正式退出后两个标签均清旧对象，新请求401；未通过清storage伪造退出。真实角色撤权链受PA-01/03阻断 |
| F04 | 项目更新命令通过，需求/承接分支缺口 | 已提交200响应丢失→同UI键同载荷200/同receipt/idempotent=true；异载荷同键409，无重复。不能替代脚本指定需求/承接独立副本 |
| F05 | 旧revision通过，事务中断缺口 | 双标签同旧版本，一方成功后另一方409且保留草稿，权威数据不被覆盖；无受控服务端事务中断入口，客户端丢响应不冒充事务中断 |
| F06 | 未完成 | 无本轮适用待处理任务；5条终态/空队列不计重复投递或lease交接通过 |
| F07 | 本机不适用 / P5补验 | 单租户范围，不动C000002；双租户同ID与缓存/receipt隔离仍必验 |
| F08 | 本机不适用 / P5补验 | dev/HMR无不可变制品切换、隔离恢复与完整链观察证据 |

### F04/F05 时间线与清理

- 新备份01:43:57，解密一致，SHA256 `20c5c770498b971c13885a5b7bcf8a6a7bb1676471bcb6fac1d38ef33789a73f`。
- 正式UI仅将项目263说明追加 `PILOT-W2-20260927-0008-F04`。01:46:32.544提交完成，receipt `060a7c52-5d43-448c-a87f-1c07d02551a3`；SQL确认成功后才丢弃响应（ConnectionClosed）。
- 新GET200确认标记已存。01:47:48.793原UI保存按钮重试：200、同键同载荷、同receipt、`idempotent=true`。键只存摘要：`77974545e64c6a0fba5b2bfd0f53c53e288ff2d0d3a97b9accbcf86048adbc16`。
- 01:48:28.884同键异载荷409 `idempotency_payload_mismatch`；01:48:29.431第二标签旧expectedVersion保存409，草稿保留。两项标记未落库；仅description变化、成功receipt1条、edit audit从1增至2。
- 重放后测试代理暂停的后续GET已释放；这段等待是验收工具拦截残留，不是产品刷新失败。全部网络拦截已清除，临时标签关闭。
- 01:53:41正式UI恢复原说明；receipt `8f1f0f99-395f-494e-84bc-f14a8fb0a4f9`，200/succeeded。01:54:11权威回读：核对的16项字段与原值完全相同，edit audit3、成功receipt2（首次+恢复），test成员0。
- 01:54:21新GET200，editVersion恢复 `9a635bd481496dbcdf21f526c0c5dcf2b6f35b2a9a5bcd2cbe8338140350cfd7`，页面显示原说明。没有通过还原updated_at掩盖操作；合法audit/receipt保留。

## 4. 缺陷与体验缺口

| 编号 | 级别 / 处置 | 内容 |
| --- | --- | --- |
| PA-01 | 高，验收后实现 | projects:view范围未进入Runtime对象过滤；Platform dashboard范围编辑仅支持Console。不得标记Aims范围授权生效；本轮没有Platform权限写入 |
| PA-02 | 后续迁移 | Host项目编辑缺访问控制入口，字段白名单与版本摘要不覆盖ACL；随settings迁移，不在冻结期扩合同 |
| PA-03 | 高，授权整改 | Host项目写BFF先要求Console静态projects:edit，阻断真实动态manager关系。后续由Runtime统一关系/静态判定，Host复用Foundation helper，补回归矩阵 |
| UX-01 | 体验缺口 | test受限文档出现禁用的“未命名文档”空壳，缺明确拒绝提示；正文仍403，无泄露 |
| UX-02 | 体验缺口 | 丢响应保存显示原始英文fetch错误/技术路径，未明确提示可能已提交与同键续行；草稿和键保留，重放安全 |
| UX-03 | 体验缺口 | 旧版本保存409仅通用“操作失败”，缺版本已变化/刷新比较引导；本地草稿保留，未丢更新 |

不得以修复体验缺口扩权限。322条其它应用grant缺绑定另列P5授权数据补验，不在本轮写入。

## 5. 证据索引

所有 `.git/` 文件位于本机受控证据目录，不能作为仓库公开附件。以下索引对应当前候选；历史隔离合同仅作补充。

| 范围 | 索引 |
| --- | --- |
| 总时间线/裁定 | `.git/codex-report-round3.md`：G01～G06、PA处置、M授撤、F第一轮、F04/F05与最终汇总节 |
| 候选/签发/owner/备份 | `.git/codex-pilot-g01.json`、`g02-issuance.json`、`g02-anonymous.json`、`g03.json`、`g04-samples.json`（均带codex-pilot前缀） |
| P01/P02 | `.git/codex-pilot-p01.json`、`p01-direct-reads.json`、`p02-visible.json`、`p02-restricted-owner.json` |
| E01 | `.git/codex-pilot-e01-api-checks.json`、`e01-personal-statuses.json`、`e01-shared-list.json`、`e01-shared-body.json`、`e01-shared-layout.json` |
| M关系授撤/清理 | `.git/codex-pilot-members-backup.json`、`codex-pilot-m-receipts.json`、`codex-pilot-m-final.json`；receipt efd7ef9b… / 8f671088… |
| F01～03恢复 | `.git/codex-pilot-f-recovery.json`、`codex-pilot-f-process-recovery.json`；两标签退出截图 |
| F04/F05 | `.git/codex-pilot-f04-backup.json`、`f04-db-before.json`、`f04-committed-before-loss.json`、`f04-f05-browser-evidence.json`、`f04-after-negatives.json`、`f04-final.json`、`f04-final-browser.json`（均带codex-pilot前缀） |
| 浏览器截图 | `.git/pilot-w2-shots/`：P/E/M截图，`f03-first-logged-out.png`、`f03-second-login.png`，`f04-loss-1440.png`/`-390.png`、`f05-stale-1440.png`/`-390.png` |

## 6. 清理与 INT-501～507 建议

- test不在263，未新增全局角色/grant；原Console viewer与Workflow审批基线保留。263可见性company/L1/NULL、说明与其它核对字段均恢复。
- 本轮成员加/移除、标记编辑/恢复各有正式回执；没有新业务对象残留。既有文档/共享、Workflow任务4/5未审批、未重放、未删除。
- Runtime/Console故障已恢复原版原配置，owner/fence/水位不漂移；浏览器拦截清除、临时标签关闭。主窗口zhouguangying，无痕窗口保持原状。
- 加密备份、截图、幂等receipt/audit保留用于复核；没有删除权威历史记录。整合负责人另行签各类验收结论。

以下是**建议状态**，未修改项目总台账复选框：

| INT | 建议 | 未满足的完整证据 |
| --- | --- | --- |
| 501 | ☐ 部分完成 | 全岗位/全故障/同制品证据尚未齐 |
| 502 | ☐ 部分完成 | G06完整岗位授权与写授撤阻断，PA-01/03未闭环 |
| 503 | ☐ 部分完成 | P03～06、M02、R01、A01完整正常链及交叉岗位缺口 |
| 504 | ☐ 部分完成 | 服务端事务中断、真实撤权迟到、后台重复/lease、双租户、制品恢复缺口 |
| 505 | ☐ 未完成 | 不可变制品、隔离备份恢复及完整≥30分钟岗位窗口缺口 |
| 506 | ☐ 未完成 | 未执行正式逐租户切换与完整业务/相关后台周期观察 |
| 507 | ☐ 未完成 | 无同角色/数据/版本30次旧新配对；云指标本机不适用，不报伪分位 |

优先修PA-01/03并补关系授权矩阵；准备合法范围/基线/第二项目样本与正式产品关系入口后重跑岗位链。P5环境补验保留F05事务中断、F06重复/lease、F07两租户、F08不可变制品与恢复、云性能/调度；本机不适用不是豁免。当前没有具备完整证据的INT复选项，不建议勾选任一项。
