# Insights Agent Guidance

项目执行约定、代码与提交规范继承 [根 CLAUDE.md](../CLAUDE.md)。本模块的架构、迁移边界、运行命令和验证入口统一见 [模块 CLAUDE.md](./CLAUDE.md)。涉及跨模块调用变更时再查 [模块合同](../docs/MODULE_CONTRACTS.md)。

按任务读取相关内容并复用已加载上下文；不要把旧的独立 SaaS、多租户或 Drizzle 约定带入本模块。
