# AGENTS 与 Skills 指令审阅

日期：2026-09-05。目标：让 GPT-6 Astra 在明确目标、权限和验收边界内自主交付，减少重复确认、提前停止和非必要流程。本次优化是指令设计调整，不是模型性能基准测试。

## 范围与结论

审阅了全局 `~/.codex/AGENTS.md`、本仓库根与模块 AGENTS/CLAUDE 指令（按项目规则排除 legacy Account）、两项项目 Skills，以及四项 `~/.agents/skills` 自定义 Skills。第三方部分重点审阅 gstack 的共享生成规则和评审/调试/QA 工作流，以及 Product Design、Creative Production、Sites、OpenAI Developers 和系统 OpenAI Docs 的相关入口与参考规则；未逐条穷尽每个插件的全部参考资料，也未审阅未安装插件。

全局 AGENTS 原为空文件。最严重的问题集中在第三方工作流的强制提问、全局硬停止、不可收敛的完成标准和宿主误路由；项目本身主要是定义缺失、重复维护及几处直接冲突。

优化采用三层：全局 AGENTS 管协作默认值和明确的第三方 Skill 用户定制；项目 CLAUDE 管领域边界与项目验收；自定义 Skills 只补充所需的专项知识和工具路由。第三方版本化缓存和 gstack 生成产物保留原版，通过全局指令覆盖工作流默认值，避免维护大量副本。

## 发现与处理

下面的原文和行号来自审阅时版本；已修改文件以当前内容为准。

| 问题 | 证据 | 影响 | 处理 |
| --- | --- | --- | --- |
| 缺少统一的自主、澄清、授权和完成定义 | `~/.codex/AGENTS.md` 为 0 字节；根 CLAUDE 原 Execution Style 仅写“只问阻塞问题” | 模型要在多个 Skills 的默认值之间猜测，易把普通偏好当成阻塞 | 新增全局约定；项目补足必要依赖、失败处理和状态报告 |
| 提问工具缺失即整项阻塞 | [gstack generate-ask-user-format.ts:25](/Users/gavin/.codex/skills/gstack/scripts/resolvers/preamble/generate-ask-user-format.ts:25) `headless → BLOCKED` | 无需用户判断的事也无法继续 | 先判断是否需要回答，再选可用询问渠道；只有依赖部分等待 |
| 格式性重确认 | [同文件:38](/Users/gavin/.codex/skills/gstack/scripts/resolvers/preamble/generate-ask-user-format.ts:38) 拒绝无字母的 `ok/sure`；`:83–90` 逐项选择后再整体确认 | 已明确授权仍多轮停顿 | 按上下文承接明确授权；保留真实歧义、工具硬门禁和用户指定审批点 |
| 评审第一步必须重新问目标 | [plan-eng-review 模板:42](/Users/gavin/.codex/skills/gstack/plan-eng-review/SKILL.md.tmpl:42)、[plan-design-review 模板:40](/Users/gavin/.codex/skills/gstack/plan-design-review/SKILL.md.tmpl:40) `VERY FIRST tool call MUST be AskUserQuestion` | 禁止先利用已有计划或查明事实 | 明确目标直接使用，只有实质歧义才问 |
| 自己引入的失败交还用户 | [generate-test-failure-triage.ts:26](/Users/gavin/.codex/skills/gstack/scripts/resolvers/preamble/generate-test-failure-triage.ts:26) `The developer must fix their own broken tests` | 修复/ship 任务提前停止 | 已授权修复继续完成；失败代码仍不得发布。只读审阅仍只报告 |
| 脏工作区成为 QA 硬阻塞 | [qa 模板:75](/Users/gavin/.codex/skills/gstack/qa/SKILL.md.tmpl:75) 要求提交全部、stash 或退出 | 恰好需要验证的未提交修改无法被测试 | 记录基线、保护既有修改，按实际冲突处理，不自动 stash/全量提交 |
| “完整”被扩大为几乎所有相关工作 | [generate-completeness-section.ts:7](/Users/gavin/.codex/skills/gstack/scripts/resolvers/preamble/generate-completeness-section.ts:7) `only ... genuinely unrelated work` | 过度工程、测试和范围膨胀 | 完成边界为请求结果、必要依赖及相称验证；不要求所有边界和虚构满分 |
| 调试受文件数和固定轮次控制 | [investigate 模板:177](/Users/gavin/.codex/skills/gstack/investigate/SKILL.md.tmpl:177)、`:206–208` | 五个以上文件要批、三次假设就停、每次全套测试 | 文件数仅作自检；按证据进展和风险判断，持续修复但避免无效循环 |
| 没有调用 API 也卡在凭证确认 | [openai-platform-api-key:33](/Users/gavin/.codex/plugins/cache/openai-curated-remote/openai-developers/1.2.3/skills/openai-platform-api-key/SKILL.md:33)、`:52–67` 禁止设计、编码和 smoke tests | 凭证决策阻塞与凭证无关的工作 | 离线实现/验证可继续；已有明确授权不重问，新增凭证/付费/账户决策在相应动作前解决 |
| 明确委托判断也强制选三张图 | [Product Design index:74–82](/Users/gavin/.codex/plugins/cache/openai-curated-remote/product-design/0.1.53/skills/index/SKILL.md:74) `go for it ... do not waive` | 实现请求被变为探索并等待 | 方案数量跟随请求；授权自主设计可自行选择，用户要求访谈/比较时保留交互 |
| 收集或修饰要求不可穷尽 | [url-to-code:138](/Users/gavin/.codex/plugins/cache/openai-curated-remote/product-design/0.1.53/skills/url-to-code/SKILL.md:138) every interaction/state；[image-to-code:125](/Users/gavin/.codex/plugins/cache/openai-curated-remote/product-design/0.1.53/skills/image-to-code/SKILL.md:125) 全部 P2 修完才可交付 | 无限取证/打磨，无法交付已有产物 | 以请求页面、核心状态、实质性保真与可用性问题为验收；区分实现完成与验证受限 |
| 设计与 Sites 的互斥流程 | [PD critical-overrides:9](/Users/gavin/.codex/plugins/cache/openai-curated-remote/product-design/0.1.53/references/critical-overrides.md:9) 与 [Sites building:49](/Users/gavin/.codex/plugins/cache/openai-bundled/sites/0.1.57/skills/sites-building/SKILL.md:49)、`:222–227` | 选图、验证、发布默认行为相反 | 明确一个主流程；文件存在不等于用户授权新外部动作，必要验证按实际任务选择 |
| 反复加载与工具选择审批 | [PD critical-overrides:38](/Users/gavin/.codex/plugins/cache/openai-curated-remote/product-design/0.1.53/references/critical-overrides.md:38) 每第二条消息重读；`:53` Playwright 要批准 | 上下文浪费、常规验证停顿 | 复用未变上下文；允许同权限边界内的适用工具，真实访问变化仍须处理 |
| 默认产物和流程过量 | [Creative produce:13–43](/Users/gavin/.codex/plugins/cache/openai-curated-remote/creative-production/0.1.25/skills/produce/SKILL.md:13) Board/多方向/固定协作方式 | 明确单产物请求被扩项，工具缺失便受阻 | 产物数量跟随目标；协作与比较板只在有收益和支持时使用 |
| 本地审计被强制联网前置 | [openai-docs:12](/Users/gavin/.codex/skills/.system/openai-docs/SKILL.md:12) 要在读本地文件前搜索 | 把外部产品文档顺序扩大到本地配置事实检查 | 当前会话按更高层工具要求先核对本地事实；需要外部动态事实时再用官方来源。系统 Skill 保留原版，不能声称改写了运行时规则 |
| gstack 的宿主/模型假设陈旧 | [hosts/codex.ts:39](/Users/gavin/.codex/skills/gstack/hosts/codex.ts:39)、`:62`；[investigate:73](/Users/gavin/.codex/skills/gstack/investigate/SKILL.md:73)、`:152` | 当前目录中的 Skill 指向另一份 `~/.claude` 安装，含 Claude overlay；静态限制 Codex 协作 | 全局要求使用当前工具文档和真实安装路径，不按旧模型标签降级。未重新生成或升级上游安装 |
| Orca 入口误抓普通 Codex 工作 | 原 `orchestration:26–33`、`orca-cli` 与 `computer-use` 描述 | 原生子代理、交接、浏览器操作被转到 Orca；CLI 不可用则退出 | 直接修改三个自定义入口，限制到显式选择或状态归属 Orca；缺 CLI 只阻塞依赖它的动作 |
| 寻找 Skill 取代执行任务 | 原 `find-skills:14–16,44,138`：普通“can you”触发、先排行榜、找不到又问是否继续 | 绕去市场检索和重复确认 | 直接收窄为能力发现请求/真实能力缺口；取消排行榜硬步骤，已授权任务可做就继续 |
| 项目 Skill 相互替代与无条件提交 | 原 hzy Skill `When Not To Use` / `Commit once` | Nuxt UI 工作丢失项目约定，或每次任务都提交 | 改成按需叠加；只有提交属于任务流程时才按根规范提交 |
| 组件规则直接冲突 | 原 Nuxt UI `gray` vs 根 CLAUDE `neutral`；参考示例自建 ConfirmModal vs `useConfirm()` | API 使用错误、重复封装 | 直接修正组件语义色、说明底层 palette 区别，为通用示例增加项目适用说明 |
| 项目共享层与完成要求边界不清 | 根 CLAUDE “缺能力先补 Foundation”“目标环境授权核验” | 单模块逻辑被强抽象、本地实现升级为生产操作 | 仅共享职责/安全边界上提；代码交付与目标环境启用验收分开，保留发布核验 |
| Insights 有两套相互冲突的模块说明 | 旧 AGENTS 写 Drizzle、独立 Worker、多品牌构建、可选提交前缀；实际 package.json 无这些脚本，db.ts 使用 mysql2，模块 CLAUDE 记录单实例 | 无法执行命令、误改架构或提交被拒 | AGENTS 改导航；有效命令和测试信息迁到模块 CLAUDE，继承根提交规范 |

## 已维护的入口

- [全局协作约定](/Users/gavin/.codex/AGENTS.md)：Astra 自主性、澄清/批准、完成、第三方 Skill 用户定制。
- [项目 AGENTS](../AGENTS.md) 与 [项目 CLAUDE](../CLAUDE.md)：路由、项目实施边界和验收。
- [Insights AGENTS](../insights/AGENTS.md) 与 [模块 CLAUDE](../insights/CLAUDE.md)：移除过时命令和重复规范，保留真实运行信息。
- [hzy-dev-workflow](../.agents/skills/hzy-dev-workflow/SKILL.md)、[nuxt-ui](../.agents/skills/nuxt-ui/SKILL.md) 与两份组件参考：去重、叠加和项目适用范围。
- [Orca CLI](/Users/gavin/.agents/skills/orca-cli/SKILL.md)、[Orca orchestration](/Users/gavin/.agents/skills/orchestration/SKILL.md)、[Computer Use](/Users/gavin/.agents/skills/computer-use/SKILL.md)、[Find Skills](/Users/gavin/.agents/skills/find-skills/SKILL.md)：精确触发和局部阻塞。

## 保留的边界与限制

保留跨模块禁止直连数据库、授权合并/模拟隔离、入站 capability、tenant/deployment 上下文、签名 actor、幂等、失败关闭、生产 grant verify、迁移 dry-run 等真实边界。产品界面的 `useConfirm()`、财务确认、审批职责和管理员回滚批准不是 agent 的流程性重复确认，不因提高自主性而删除。

全局 AGENTS 的覆盖只适用于允许用户定制的工作流指令，不能覆盖系统/开发者指令、工具本身的权限或自动批准审查。未修改沙箱、自动批准策略、模型设置或插件安装状态。当前已加载的 Skill 描述可能保持旧值，下一次新任务应核对实际加载内容；不能仅凭写盘宣称全部运行时行为已改变。

官方文档说明了全局到项目的 AGENTS 加载层级，以及 Skills 按需加载的机制，支持上述分层维护方式：[AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)、[Build skills](https://learn.chatgpt.com/docs/build-skills)。本报告的具体冲突以本机实际文件为证据。

## 验证

六项 Skill 已通过 frontmatter/占位符校验。独立代理读取拟生效文件，对 12 个场景做了只读决策演练，未发现阻止落地的文本冲突；覆盖脏工作区六文件修复、已授权合并、只读审阅、自主设置页、互动访谈、无 Key 离线测试、Worker 代码交付、grant 失败阻止发布、浏览器替代、技能检索无结果、Codex 原生子代理和删除环境不明。

复核保留了两个关键反例：只要求审阅时不实施；删除环境不明时必须先问。根据复核反馈，压缩了根 Execution Style 与全局约定重复的通用流程。最终检查修改前后差异、文件写入一致性和文档引用。

此处是文档/指令改动，无应用代码修改，不运行应用构建或测试套件。场景检查属于离线指令演练，不代表真实部署、真实 API 调用或后续会话行为已端到端验证。
