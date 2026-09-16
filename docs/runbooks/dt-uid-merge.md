# dt-* 主体归并 Runbook

> 执行记录：2026-09-03 已用手工脚本把 `dt-5a2d907222203e6cae58d183c35c6770`
> 归并到 `liukai`。归并前 aims / assets / codocs / finance / altoc / workflow
> 六个业务库的引用核查均为空，People 侧仅 3 行需迁移。
> 过程中修正的两处：`directory_user_departments.status` 只接受
> active/inactive/deleted（不是 'left'）；`people_employees.employee_uid`
> 被 4 张子表外键引用，改父行前必须临时关闭外键检查。

## 背景

钉钉 HR 同步在无法命中既有 Directory identity 或唯一邮箱时，曾为员工生成
确定性的 `dt-<sha256>` UID 并立即写入 `people_employees`，使员工业务主键、
登录身份和授权主体三者分叉。该合成能力已移除（见 `people_onboarding_cases`
与入职候选流程），本 runbook 用于修复上线前已经产生的遗留主体。

## 前置判断

归并改写的是 `employee_uid`——一个跨模块稳定标识。**产品内不提供跨应用扫描
能力**（评审时确认 `dt-*` 出现时间短、业务应用尚未引用），因此改由运维在
归并前手工核查。

漏掉一处引用的表现是静默的数据损坏：没有报错，没有异常，只有一个错误的零。
不要跳过这一步。

## 执行方式：仅限审计运维

当前 People、Console 和 data-runtime 的在线写入口均固定返回 410。跨库归并
无法提供单事务保证，产品接口也没有覆盖全部应用的引用重扫与补偿编排，因此
不得从浏览器或服务接口执行。只有个别遗留主体、且跨应用引用已确认为零时，
由运维按变更单执行 `dt-uid-merge-manual.sql`。

该脚本已在 MySQL 9.5 上实测：外键约束、排序规则对齐、工号修复与孤儿校验
都验证过。批量归并或将来再次出现遗留主体时再走下面的接口流程。

## 步骤（审计运维流程）

1. **核查跨应用引用**。对 aims、assets、codocs、finance、altoc、workflow
   每个库分别整段执行 `dt-uid-merge-precheck.sql`，把 `dt-REPLACE_ME` 替换为
   待归并的 UID。

   脚本会先报告覆盖检查：`columns_found` 与 `statements_generated` 必须相等。
   不相等说明生成的语句被截断，结果不可信——脚本会以重复主键错误中断，
   不要绕过它继续执行。

   **覆盖检查的 PASS 不是核查结果**，它只说明脚本没被截断。答案在最后一步：
   它只返回命中的列，空结果集才表示该库干净。只看 PASS 就放行是最容易犯的
   误读——脚本已对未替换占位符的情况做了确定性中断，但判读仍需看第四步。

   **命中要分两类判断**：

   - **活引用**（必须阻断）：业务对象对该员工的引用，例如 aims 项目成员、
     assets 使用人、codocs 文档归属、finance 负责人、workflow 审批人。
     出现任何一处都停止自动归并，需另立跨应用迁移方案。
   - **历史审计与操作元数据**（记录，不阻断）：`integration_operation` 及其
     attempt 表的 `created_by` / `updated_by` / `locked_by` /
     `original_actor_uid` / `last_replay_actor_uid`，以及各表的
     `created_by` / `updated_by`。这些记录的是「当时是谁做的」，
     改写它们等于篡改审计事实。归并工具刻意不迁移这类列。

   判断不确定时按活引用处理，停下来问，不要放行。

2. **预览**。以具备 `employees:admin` 权限的账号登录 People，
   调用：

   ```
   GET /api/admin/subject-merge/preview?legacyUid=<dt-...>&canonicalUid=<真实 UID>
   ```

   同时返回 People 与 Console 两侧将被改写的内容：引用行数、工号是否被 UID
   污染、canonical 主体是否已存在员工行、旧主体的外部身份与部门归属。

3. **确认在途操作已结算**。归并会拒绝仍有 pending/processing/retry_wait
   操作的旧主体——回执会写回一个已被停用的主体。

4. **紧邻执行前重扫**。再次对六个业务库执行预检并与第 1 步逐列结果比对；
   任一活引用新增或口径变化都中止，不得使用第 1 步的旧结论继续。

5. **按变更单执行手工脚本**。替换脚本中的 legacy UID、canonical UID 与真实
   工号，每一段单独执行、核对影响行数并保存输出。顺序固定且不可颠倒：

   - Console 侧：停用旧主体 → 撤销旧会话与刷新令牌 → 合并部门归属 → 重绑外部身份
   - People 侧：改写 `people_employees` 主行与工号 → 迁移全部引用列

   先停用旧主体是为了切断归并期间可能产生的新引用；先撤销会话是为了让持有
   旧主体登录态的浏览器立刻失效。

   Console 与 People 是两个数据库，不能宣称跨库原子。若 Console 段成功而
   People 段失败，停止同步与相关人员写操作，保留全部输出，按变更单从 People
   段恢复；不得重新执行未核对的整套脚本。

6. **验证幂等**。用同一份钉钉快照重跑同步，确认不产生新的 `dt-*`，且员工
   事实与授权都指向 canonical UID。

## 脚本已验证的失败路径

本脚本在临时 MySQL 9.5 实例（服务器排序规则 `utf8mb4_0900_ai_ci`，
表列混用 `utf8mb4_unicode_ci` / `utf8mb4_general_ci` / `utf8mb4_0900_ai_ci`）
上验证过以下情形：

- 混合排序规则的库能正常比较并给出正确命中，不再报 1267。
- 占位符未替换时以重复主键中断，不会给出假的空结果。
- 生成语句被截断时报告 `columns_found` 与 `statements_generated` 不等并中断。
- 干净的库返回空结果集。

## 不得做的事

- 不得只修改 username。那不改变 `employee_uid`，分叉依然存在。
- 不得无报告地直接删除 `dt-*` 行。
- 不得按邮箱自动跨主体归并。
- 不得改写历史审计列。`created_by` / `original_actor_uid` 记录的是当时的
  操作主体，归并后仍应指向旧 UID。
- 不得在 canonical 已有员工行时自动归并——同一个人两份独立的任职与成本事实，
  合并口径需要人工判定。
