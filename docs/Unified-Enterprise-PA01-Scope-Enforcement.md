# PA-01 项目范围执行与逐入口收口

更新：2026-09-27。本页保存原 `.git/codex-pa01-design.md`、`codex-pa01-b3-entry-inventory.md`、`codex-pa01-b3-closure.md` 的决定与缺口；实施状态以源码、已审提交和环境回读分别为准。

## 范围规则

同一授权单元内，permission、defaultScopes、assignmentScopes 与 scopes 保持关联；单元间 OR、范围维度间 AND、同维度值 OR。有效期、模拟隔离与动作蕴含由 Foundation 解释。非公开项目的读取以及全部写入按同一动作的结构化 scope 或该动作明确允许的当前动态关系判断。`company/L0/L1` 公开项目持有效 `projects:view` 可读是已批准的读取例外，不能外推到写、导出或敏感审批。Runtime 从当前项目、部门、负责人和 active 成员行复核关系；浏览器不能提供这些事实。失败分类：依赖/无法无损编译 503、缺权 403、对象越界隐藏 404。

Foundation 编译的短期项目 permit 绑定 actor、tenant、Host deployment、resource/action、policy bundle version/hash/revision、project 与有效期；Runtime 先验签和注册代次，再在只读快照的 WHERE 中做可见性，COUNT/page/summary 同口径。写入在锁定当前行后重验；回执重放前也重验撤权。项目资源权限与工作项、工时、周报、文档自身的业务权限相与，`projects:view` 不能替代它们。

## 已审批次与入口边界

| 批次 | 主要内容 | 证据索引 |
| --- | --- | --- |
| 读取与嵌套读取 | 项目总览、详情及嵌套集合使用结构化 permit；内部旧 `project-view` 调用更新，不保留旧许可回退 | PA-01 3C/3D、3E1～3E5；Runtime 0.3.262～0.3.265，本机视图与健康回执在部署台账 |
| 工作项与项目写入 | 项目 edit/member、工作项状态/完成/分解等逐 owning project 重验，业务动作门槛保留 | `210621e2`、`9e7aa0f1`、`fc735535`、`50d42f3c`；F1 `76b4bdbb` 与解码修复 `f2088a90`，F2b Runtime 0.3.269 |
| 工时、成果、周报 | 已分小批补项目范围与动态事实；周报 submit 桥接已审并在本机 Runtime 0.3.266 验证启动 | `123ad580`，Runtime 0.3.265/0.3.266；真实周报写入仍受应报清单缺失阻断 |

第 3 批曾盘点 59 条 Host 写入口，须逐条以实际 handler/Runtime 测试复核；其临时闭包表不能视为 59 条均完成。项目创建没有既有对象，需按拟建 code/部门执行 create scope，不能以空对象放行；批量、多项目关联和文档 ACL 必须每对象预检、整事务回滚。项目级 export 缺独立 `projects:export` 业务入口，不以下载代替。PA-04 仍有成果/工时等命令缺统一写回执与重放闭包，保持单列缺口。

## 本机证据与未决决定

本机公开/部门/项目团队等真实样本与隔离 MySQL 反例不能互相替代；两租户、完整撤权/迟到响应、全部 59 写入口与 30 分钟岗位窗口未闭合。PA-02 项目访问控制编辑尚无获批最终合同：当前 263 保持 `company/L1` 且 `access_whitelist=NULL`，未改原值。不得为了验收直接改库或临时放宽可见性。手工周期里程碑未保存稳定 `template_key`，而 rollover 必须以该键确定系列；需决定允许手工周期并生成独立稳定系列键，或限制为模板周期并在 UI 明示。周报周期与应报清单本机均为空，`zhouguangying` 保存草稿返回 409 `weekly_report_obligation_required`；生成范围、责任角色和撤销路径需另定。

验收与放行以[试点脚本](./Unified-Enterprise-Pilot-Acceptance-Script.md)及[实施计划](./Unified-Enterprise-Implementation-Plan.md)为准，不因上述代码提交勾选 INT-501～507。
