# DEBUG REPORT — AIMS 质量检查队列 403 与成果提交 409

- 日期：2026-08-25
- 现象：已授权 `aims:qa` 的唯一有效用户进入质量检查页时，`GET /aims/api/v1/quality-reviews/queue` 返回 403；成果 206 提交 QA 时返回 409。
- 状态：DONE（修复、部署及生产链路复验完成）

## Root cause

Platform 的用户主体事实正确：QA 角色唯一有效持有人为 `subjectCode=zhouguangying`；该主体的 `externalRef` 是目录同步使用的不透明哈希。

Console 的公司级唯一角色持有人投影错误地使用 `subject.externalRef || subjectCode` 作为 `holders[].uid`。因此 Console 向 AIMS 返回哈希 UID，而 AIMS 登录会话的稳定用户 UID 是 `zhouguangying`。AIMS 比较当前用户和 QA 持有人时将同一人误判为不同主体，导致队列 403，发布清单时报 `current_qa_required`。

成果提交的 409 是后续结果：租户尚无可用的已发布 QA 清单，因为当前 QA 同样被上述 UID 错配阻止发布。

## Fix

- Console 角色持有人投影固定使用 Platform 用户主体的 `subjectCode` 作为 `holders[].uid`。
- `externalRef` 只保留为上游目录记录标识，不再作为业务应用用户 UID。
- 增加带不透明 `externalRef` 的回归用例，断言持有人 UID 仍为 `subjectCode`。
- Console API 契约和跨模块契约明确 UID 语义，防止后续再次混用两类标识。

## Validation

- 修复前回归测试稳定复现：实际返回 `directory-sync-hash...`，期望 `director-uid`。
- 修复后 Console lint、typecheck 和全部 410 项测试通过。
- 提交 `3454fba9` 已推送。
- Console Cloudflare 生产版本 `acc04f2e-ea1b-45c0-9c15-3cc9a0598e8f` 部署成功。
- 生产质量检查页正常加载为“待处理 0”，不再返回 403；QA 可成功创建并发布“项目文档标准检查清单”。
- 汇智云项目成果 206（`QA文档关联回显证据`）已成功提交：状态由“未送检”变为“质量待审”，页面提示受检仓库快照已锁定，原 409 不再出现。
- 因当前 QA 本人是提交人，该成果按冲突隔离规则进入 `QA 自提交 → 项目经理完整性确认 → 项目总监质量审核`，不会显示在同一 QA 的普通队列中。

## Remaining business action

测试成果已完成项目经理完整性确认并转交项目总监；项目总监登录后可在质量检查队列给出最终质量结论。这是预期职责隔离，不是故障。
