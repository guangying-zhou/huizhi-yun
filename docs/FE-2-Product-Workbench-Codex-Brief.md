# 任务书：FE-2 产品工作台任务脚本细化与差距清单（Codex）

派发：Claude，2026-09-24。只写文档，不改代码、不部署、不写环境、不改 grant。

## 背景

FE-2 / INT-503 的**冻结任务脚本**已在 [产品接线清单](./Unified-Enterprise-Product-Page-API-Readiness.md)“FE-2 / INT-503 当前任务输入”一节：普通产品负责人找到产品 → 查看当前定义与正式资料 → 选择有权访问的关联管理空间 → 处理需求并纳入版本、确认计划 → 关联研发项目执行并查看进展 → 返回原产品、空间及版本上下文。该节的差距表只到粗粒度。你在 W1-B 产出的 [产品子页盘点](./Unified-Enterprise-Product-Subpages-Inventory.md) 已列出 48 个未登记源页、7 组 Runtime 提议与模型接口 `product_priorities:admin` 未声明的问题。

## 交付

新建 `docs/FE-2-Product-Workbench-Task-Script.md`：

1. **逐步脚本**：把冻结脚本拆成用户可执行的步骤（预计 15～30 步），每步列：岗位（产品负责人/项目经理/无权样本等）、入口页面（Host 路由，未登记则标源页）、用户动作、调用的 METHOD + Host BFF 路径、Runtime 操作与 capability、人员权限（manifest resource/action）、预期结果、失败/撤权时的预期表现。
2. **状态分级**：每步标 `已实现有证据`（给测试或记录出处）/ `已实现待环境证明` / `缺页面` / `缺 BFF` / `缺 Runtime 操作` / `权限合同未定`。只以当前代码与测试为准，核对 handler，不沿用旧表结论。
3. **差距汇总**：按“阻塞主链 / 不阻塞主链”分组；对缺 Runtime 操作与权限合同的项引用盘点文档中的提议编号，补充它们在本脚本中被哪一步需要；`product_priorities:admin` 问题给出你建议的处理方式（标“待 Claude 决定”）。
4. **环境与数据前置**：试点产品、多个关联管理空间（含无权空间）、版本、候选项目、各岗位账号与授权、撤权样本；写出需要在测试租户准备的对象清单与清理边界，不实际创建。
5. **验收记录模板**：每步的实际结果、证据、重复操作与失败恢复栏位。

## 约束

- 不改代码、页面、Runtime、grant、manifest；不做浏览器操作。
- 不重复 W1-B 盘点正文，引用即可。
- 完成后在本文件末尾“回执”节写：新文档位置、步骤数、各状态计数、阻塞主链的差距条目、待 Claude 决定项、交 MiMo 的文件清单（本任务书 + 新文档），并在 Orca 终端回复“FE-2 脚本完成”。

## 回执

2026-09-24：已新建 [FE-2 产品工作台逐步任务脚本与差距清单](./FE-2-Product-Workbench-Task-Script.md)。共 **24 步**；`已实现有证据` 17、`已实现待环境证明` 3、`缺页面` 2、`缺 BFF` 1、`缺 Runtime 操作` 1、`权限合同未定` 0。按当前 Host handler、Foundation operation/capability 表、Aims 页面与 manifest 复核；未执行浏览器/环境写入，代码证据不代替固定环境验收。

阻塞主链：B1 主档到多个管理空间的关系读取、逐空间授权与选择/返回上下文（步骤 06、07、24）；B2 正式产品资料 Host 页面与精确读取闭包（步骤 05，对应 W1-B 提议 ①）；B3 项目评审、基线、任务创建 Host 闭包（步骤 21）；B4 真实岗位、多空间、无权及撤权环境证据未取得（全链）。待 Claude 决定：B1 关系拥有方与 Runtime/Host/人员权限合同，B2 文档读取与 Codocs 独立授权实施边界，B3 项目侧写闭包批次；另有 W1-B 模型 `product_priorities:admin` 未声明，建议单列精确动作并同步合同后开放（N3）。

交 MiMo 的文件清单：`docs/FE-2-Product-Workbench-Codex-Brief.md`、`docs/FE-2-Product-Workbench-Task-Script.md`。
