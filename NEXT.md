# NEXT — 下一步做什么

> 最后更新：2026-09-25。保持 20 行以内。当前制品、环境开关和已验收范围以[当前运行组合](docs/Current-Running-Combination-20260925.md)为准；此前 2026-09-22 的 INT-606c/G1/FE-2 顺序是历史计划。

**当前主线**：review `5a019bbd` 第一、二批已提交（`6a1c6f62`、`a8093f5c`）；Collab 保持关闭，不部署。第三批当前状态文档送审。

1. 第三批文档审查后，按本机 CPU 任务书在本分支测测试 Console 基线、做 A1–A4 与复测；P1 先设计。生产/main 不动。
2. CPU 批次后，依次写 matter 完成设计与 D4-2 第 3 阶段设计，分别送审；环境写入继续走独立关口。
3. Workflow A2 本机 completion→审批→callback 已验；actionable 通知关闭顺序仍是后续设计项。
4. Codocs snapshot v2 在 hzy0 已开并通过双标签 409 快检；实时 Collab 关闭。将来启用需同步部署 Runtime `expiresAt` 响应与 Collab 租约修复并单独验收。

历史与证据：[统一企业应用实施台账](docs/Unified-Enterprise-Implementation-Plan.md)、[G1 收口跟踪](docs/Huizhi-Yun-Local-Enterprise-Test-Plan-v1.0-20260920/docs/G1-Closeout-Tracker.md)、[写入协调](docs/Codocs-Document-Write-Coordination.md)、[本机运行记录](deploy/test-env/LOCAL_RUNTIME.md)。计划文字不自动授权提交、部署或环境写入。
