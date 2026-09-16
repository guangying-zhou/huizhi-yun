# 部门调动、目录同步与页面反馈问题排障记录

- 日期：2026-08-27
- 状态：DONE_WITH_CONCERNS（代码修复与本地验证完成；生产 Connector Runtime 恢复、发布和存量姓名修复尚未执行）
- 范围：Codocs、Console、Data Runtime Directory、LDAP Connector、Connector Runtime 生产状态

## 现象

试用人员反馈了一组连续问题：

- 人员调动部门后，在文档平台看不到新部门共享文档；在 Console 用户列表手动修改部门后仍未恢复；
- 从目录同步页面触发钉钉同步失败；
- 随后执行 LDAP 数据同步，用户中文姓名被批量更新成拼音；
- 从页面反馈入口提交问题时提示登录过期。

## 根因

### 1. Codocs 部门权限使用了不会主动失效的前端缓存

Codocs 用 `localStorage` / Nuxt state 保存 `user-departments-cache`。部门首页、文件柜、周报、资产浏览器和快速新建文档等入口只要缓存中已有部门，就提前返回，不再请求 `/api/account/user-departments`。

因此 Console 中的主部门已经改变后，当前浏览器仍长期使用旧部门编码，文档平台不会重新取得新部门共享范围。

### 2. LDAP 同步错误地覆盖了其他来源维护的中文姓名

LDAP Connector 虽然请求了 `displayName`，但 OpenLDAP 映射只采用 `cn`；当前生产 LDAP 的 `cn` 是拼音标识。Directory 同步在命中已有用户时又无条件覆盖 `display_name`、`real_name` 和 `source_provider`，使 LDAP 拼音值覆盖了人工或钉钉维护的中文姓名，并把记录归属改成 LDAP。

### 3. 钉钉同步失败是 Connector Runtime 失联

2026-08-27 只读检查生产 Console 的 Connector Runtime 页面发现：

- 状态为“心跳过期”；
- 实例为 `connector-runtime.C000001-console`，版本 `0.4.25`；
- Runtime URL 为 `https://tpapi.wiztek.cn`；
- 最后注册与心跳时间均为 `2026/8/16 05:11:07`。

因此本次钉钉同步在目录任务登记前即失败。该项是生产服务状态问题，不能仅靠仓库代码修复。

### 4. 页面反馈接口没有接入 Console 本地会话桥

生产只读请求 `GET /api/webdev-report/issues?pageSize=1` 在 Console 页面已登录的情况下返回 401“请先登录”。Console 的本地会话桥只识别部分 Workflow、通知等路由，没有识别 `/api/webdev-report/**`；而 Console 自身请求又不会使用自请求兜底，所以反馈 GET/POST 都无法取得当前登录用户。

## 已实施修复

- Codocs 的部门缓存改为只做首屏乐观展示；相关入口每次仍会重新请求 Directory，并用最新主部门和部门列表覆盖缓存。
- OpenLDAP 用户映射优先采用非空 `displayName`，保留 `cn` 作为回退。
- Directory 合并用户时读取现有姓名和来源：LDAP 只更新 LDAP/空来源记录，或填补空姓名；不会再覆盖其他来源维护的人名、外部标识、哈希、状态和来源归属。
- Console 会话桥增加 `/api/webdev-report` 及其子路径，覆盖 GET 和 POST。
- 为上述行为增加先失败、修复后通过的回归测试。

## 证据与验证

- 生产目录同步页显示 2026-08-27 08:37–08:43 UTC 的多次 LDAP 全量同步均成功，每次 70 个用户、0 错误；说明拼音覆盖是成功同步中的字段合并问题，而非任务异常回滚问题。
- 生产用户列表可见多名用户姓名已变成拼音；未对生产数据做写操作。
- Console 全量测试 411/411、lint、typecheck、生产构建通过。
- Codocs 全量测试 154/154、lint、typecheck、生产构建通过。
- Data Runtime Directory 与 LDAP Connector Go 测试通过。
- `git diff --check` 通过。

## 生产恢复步骤

1. 发布 Console、Codocs、Data Runtime 和 LDAP Connector 对应代码。
2. 恢复或更新 `connector-runtime.C000001-console`，确认 Console 显示当前时间的持续心跳。
3. 重新执行钉钉人员/目录资料同步，以唯一邮箱匹配现有用户并恢复中文 `display_name` / `real_name`；先抽样确认再做全量核对。
4. 使用一名已调动人员验证 Directory 主部门、`/api/account/user-departments` 返回值，以及 Codocs 新部门共享文档可见性。
5. 在正常登录会话中验证页面反馈列表读取和反馈提交，不再出现 401/“登录过期”。

## 关注项

- 本次没有远程重启、部署、目录同步或生产数据修复，因为这些是生产写操作，需要维护者在发布窗口执行。
- 若 LDAP 中没有可用的中文 `displayName`，仅再次执行 LDAP 同步不能恢复已覆盖姓名，应以钉钉或可信人员主数据作为修复源；不要根据拼音自动猜测中文名。
- 代码修复防止后续跨来源覆盖，但已经被标记为 LDAP 来源的存量行仍应在钉钉同步后专项核对。
