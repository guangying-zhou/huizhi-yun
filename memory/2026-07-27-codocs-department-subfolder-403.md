# Codocs 存量部门目录下创建子目录 403 修复记录

日期：2026-07-27  
租户：C000001 / wiztek.huizhi.yun  
状态：DEPLOYED_PENDING_CAOQIAN_ACCEPTANCE

## 现象

曹倩重新登录后，在「部门文档 / 协同文档」的“AI应用月报”目录下创建子目录，
`POST /codocs/api/folders` 仍返回 403。

## 生产证据

生产 Data Runtime 日志在原操作时间记录：

- `2026-07-27T03:15:30.219264606Z`
  - requestId：`73141802aaf550f17404a4f15124f581`
  - resource：`/v1/codocs/folders`
  - status：403
  - errorCode：`folder_parent_scope_mismatch`
- `2026-07-27T03:15:44.261887933Z`
  - requestId：`feffcc5bb087901f97bc1952c740cb3e`
  - resource：`/v1/codocs/folders`
  - status：403
  - errorCode：`folder_parent_scope_mismatch`

生产 `hzy_codocs.folders` 中目标存量目录为：

- id：35
- name：AI应用月报
- folder_type：department
- owner_uid：caoqian
- dept_code：RD
- parent_id：31

同一时段存在 `codocs.folders.create` HTTP 200，证明登录、应用创建权限、部门经理
校验和 runtime 调用链均正常。

## 根因

新的 scoped create 合同创建部门目录时不再写入个人 `owner_uid`，而是只绑定
`dept_code`。但父目录校验仍用一套通用比较，同时要求类型、owner、部门和项目全部
相等。

因此：

- 新子目录规范范围：`department + RD + owner 空`
- 存量父目录范围：`department + RD + owner caoqian`

两者实际属于同一部门命名空间，却因存量审计/创建人字段不同被错误拒绝。

## 修复

- 私人目录父子范围继续由 `folder_type + owner_uid` 精确判断。
- 部门目录父子范围改由 `folder_type + dept_code` 精确判断。
- 存量部门目录的 `owner_uid` 仅视为历史创建人信息，不再参与部门命名空间判断。
- 不同部门的父目录仍返回 `folder_parent_scope_mismatch`。
- 私人目录跨 owner 挂载仍返回 `folder_parent_scope_mismatch`。
- Codocs API、Tenant Runtime 合同和根级 AI 规则同步说明规范命名空间与 legacy 字段
  兼容要求。

## 回归验证

- 新测试使用生产同构事实：父目录 id 35、`owner_uid=caoqian`、`dept_code=RD`；
  修复前稳定返回 `folder_parent_scope_mismatch`，修复后允许创建。
- 增加跨部门父目录与私人目录跨 owner 的负向测试。
- `go test ./...`：通过。
- `go vet ./...`：通过。
- 相关目录范围测试：通过。
- 根仓与 Codocs `git diff --check`：通过。

## 发布

- Data Runtime version：`0.3.152`
- commit marker：`9d11202-dirty`
- builtAt：`2026-07-27T03:19:24Z`
- R2 immutable release 与 `latest`：已签名发布并完成公网校验
- 生产 Agent：已从 `0.3.151` 更新到 `0.3.152`
- systemd：active
- `/runtime/healthz`：`status=ok`
- Codocs DB：`ok`
- auto-update：tracking，execution lock free

## 待完成验收

请曹倩在同一个“AI应用月报”目录下再次创建子目录。验收标准：

1. `POST /codocs/api/folders` 返回 200；
2. Data Runtime 日志记录 `operation=codocs.folders.create`、`status=200`；
3. 不再出现 `folder_parent_scope_mismatch`。
