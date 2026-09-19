# ADR-018 P0–P2 证据审计

核对日期：2026-09-15。分支：`feat/adr018-enterprise-integration`。

本表以当前源码、合同和脱敏回执为准。`完成` 表示该任务的交付物与验证边界已经具备；`部分` 表示已有实现，但仍缺任务原文要求的环境或完整链路证据。它不把隔离测试、页面 200 或表复制等同于阶段完成。

| 任务 | 状态 | 当前证据 | 完成前仍需补齐 |
| --- | --- | --- | --- |
| INT-001 | 部分 | [Host 合同](./Unified-Enterprise-Host-Contract.md)包含部署、调用、任务及保留边界 | 汇总同一时点的实际 Worker、身份、cron、outbox、会话和环境清单 |
| INT-002 | 完成 | [Host 合同](./Unified-Enterprise-Host-Contract.md)冻结包名、URL、tag、资源、兼容和冲突责任 | — |
| INT-003 | 完成 | [产品试点数据清单](./Unified-Enterprise-Pilot-Data-Inventory.md)统一 150 表基线，覆盖点名对象、逐表 schema/计数证据、实例位置类别以及写入方/消费者映射；旧 147 表记录已明确标为历史 | — |
| INT-004 | 完成 | [数据合同](./Unified-Enterprise-Data-Contract.md)及产品目录/接入合同冻结权威事实、快照、水位、标识和可见性 | — |
| INT-005 | 完成 | [权益合同](./Unified-Enterprise-Entitlement-Contract.md)分类订阅、License、manifest、bundle、client/grant 和部署身份 | — |
| INT-006 | 部分 | [构建基线](./Unified-Enterprise-Build-Baseline.md)与[性能基线](./Unified-Enterprise-Performance-Baseline.md)已记录历史包/启动、当前配置/任务数，并冻结两租户四主体、采样法、阈值、负责人和排期；Layer 修复后单次 dry-run 成功 | 处理 RSS 超门禁和 BigInt 警告后采干净固定构件三轮；完成旧新各组30次 P50/P95、实际 CPU/并发内存/startup、Runtime SQL/慢查询 |
| INT-101 | 完成 | `data-runtime/internal/server/enterprise_context.go` 及上下文/HTTP 测试 | — |
| INT-102 | 完成 | Runtime registry、transaction、config/factory 和 generation guard 测试 | — |
| INT-103 | 部分 | 产品目录及规划领域服务和多批 HTTP/MySQL 测试 | 以完整试点 API 清单证明新旧入口均复用同一服务 |
| INT-104 | 部分 | 授权目录查询覆盖分页、分组、计数和隐藏关联 | 明确试点导出范围，并验证字段、总数和导出不泄漏 |
| INT-105 | 完成 | 共享事务与产品规划/调度 MySQL 测试覆盖 audit、receipt、outbox 和晚失败回滚 | — |
| INT-106 | 部分 | 多命令已覆盖幂等重放和异 payload 冲突 | 目标环境验证旧在途 operation、提交后响应丢失及外部 ACK 恢复 |
| INT-107 | 部分 | 精确 JWT、actor、live grant 与 Enterprise OAuth/OIDC 证据 | 以当前完整业务路由、统一库和固定制品形成同一环境闭环 |
| INT-108 | 部分 | Runtime API、Foundation 操作目录和专项合同已有多批隔离验证 | 生成当前 operation→route→capability→test 的完整矩阵 |
| INT-201 | 部分 | 迁移工具具备 dry-run、review hash、新库保护、ledger/checkpoint 和稳定标识 | 证明中断后可恢复的分批执行边界；增量迁移仍非通用能力 |
| INT-202 | 部分 | [150 表演练回执](../deploy/test-env/artifacts/C000001.enterprise-rehearsal-150-copy-20260914b.json)记录 150 表、478 行、38 triggers、55 views、generation=0；[产品主档冲突隔离回执](../deploy/test-env/artifacts/INT-202.product-master-conflict-isolated-mysql.json)证明首条跨域逻辑引用与归一键冲突会生成脱敏 blocking report；[规划 JSON/revision 隔离回执](../deploy/test-env/artifacts/INT-202.planning-json-revision-isolated-mysql.json)覆盖核心规划 operation 的非法 JSON、未知 schema/version、来源与 JSON 引用缺失，以及活动 revision 回退；apply 均在建目标前拒绝 | 仍须补齐其他 operation/schema、其余逻辑引用、历史快照/audit/receipt/outbox 与消费水位的业务语义校验，并扩展重复主档范围。逐表复制哈希只能证明字节保留，不能替代这些语义检查 |
| INT-203 | 部分 | 隔离目标已完成复制及结构/计数/hash 核验 | 用同一权限主体比较旧新业务查询结果 |
| INT-204 | 部分 | 当前名称、列表、空间、候选、接入与 Assets 主档已接新读取 | 完成实际页面全过程和相同权限主体旧新对比 |
| INT-205 | 部分 | 接入、组件、功能、版本生命周期、验收发布、规划和项目承接已有服务/测试 | 完整真实页面单写链及外部依赖验收 |
| INT-206 | 部分 | [切换协议](./Unified-Enterprise-Cutover-Protocol.md)及 fence、最终复制、owner/route adapter | 闭合实际最小权限、drain、唯一 owner、切换窗口与新增写入后的恢复演练 |
| INT-207 | 部分 | 多批真实隔离 MySQL 覆盖并发、回滚和重放 | 使用当前 150 表闭包和固定制品做一次迁移→业务→恢复贯穿验收 |
| INT-208 | 部分 | [退役清单](./Unified-Enterprise-Pilot-Retirement-Inventory.md)已有消费者和替代条件 | 将代表项扩成逐接口、任务、配置及 grant 的穷尽清单 |

## 下一执行批次

INT-202 第三批新增[delivery integrity 隔离回执](../deploy/test-env/artifacts/INT-202.delivery-integrity-isolated-mysql.json)：历史确认快照/消费 revision、完整 receipt 身份异 hash/目标摘要、outbox 父链/attempt/fence/dead-letter 边界均会形成脱敏 BlockingConflicts。仍未覆盖全部 150 表历史快照/audit、receipt 目标领域逐对象存在性、完整 attempt 状态序列和不透明目录 watermark 的版本化规则，保持未完成。

1. 继续维护 `operation → Runtime route → Host BFF → capability/grant → 页面 → 测试` 覆盖矩阵；150 表计划和实际制品摘要已由 INT-003 清单统一。
2. 在隔离目标中用同一主体完成旧新查询对比，覆盖隐藏关联、分页、计数、字段和明确的导出边界；同条件采集性能基线。
3. 执行最小权限、drain/owner、响应丢失及完整迁移→业务写入→恢复演练，证据与固定 Runtime/Host/schema/权限目录版本绑定。

以上三批完成前，P2 不能由“统一测试库已激活”直接判定完成。
