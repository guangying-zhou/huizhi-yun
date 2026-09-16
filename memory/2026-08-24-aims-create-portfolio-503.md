# AIMS 创建项目集 503 排障记录

## 现象

- 生产环境创建项目集时，`POST /aims/api/v1/portfolios` 返回 503。
- 前端的创建处理只有 `try/finally`，没有 `catch`，因此同时产生未捕获的 `FetchError` Promise。

## 定位证据

1. 生产 AIMS 权限、项目集列表和 tenant-runtime 读请求正常。
2. 使用唯一编码 `C-DIAG0824` 创建成功，排除通用权限或运行时不可用。
3. 立即使用相同编码再创建可稳定复现失败。
4. `project_portfolios.code` 由 `uk_portfolio_code` 唯一键约束；Data Runtime `createPortfolio` 直接返回 MySQL 1062，未转换为业务冲突。
5. AIMS tenant-runtime 客户端仅保留 4xx；未分类的上游 500 会统一转换为 503，所以数据冲突被误报为运行时不可用。

## 根因

Data Runtime 的项目集写入端点未将 MySQL 1062 唯一键冲突映射为 HTTP 409；AIMS BFF 将未分类的 5xx 正确地降级为通用 503，但这遮蔽了真实的业务错误。页面又没有捕获创建失败，导致用户只能在控制台看到异常。

## 修复

- Data Runtime 在项目集创建和更新时，将 MySQL 1062 映射为 `409 portfolio_code_conflict`，返回“项目集编码已存在，请修改后重试”。
- AIMS 创建项目集页面捕获请求错误，保留表单并显示上游业务提示。
- 增加 MySQL 1062 -> 409 回归测试和前端错误处理约束测试。

## 验证

- `go test ./...` 通过。
- AIMS `pnpm test` 通过（236 项）。
- AIMS `pnpm typecheck` 通过。
- 相关 Vue/Test 文件 ESLint 通过。
- Data Runtime `0.3.172` 已签名发布并切换 `latest`，公开 manifest 的 commit 为 `9b0070d1`。
- Console 显示租户 Runtime 原版本为 `0.3.170`，未在等待的自动更新窗口内跟随 `latest`；从“数据运行时”页面触发更新后，健康检查确认已运行 `0.3.172`。
- AIMS Worker 已发布，Cloudflare Version ID 为 `9db92bd3-ba24-44db-aa28-8531c70cf143`。
- 生产重复提交 `C-DIAG0824` 时，AIMS 日志确认上游为 `409 portfolio_code_conflict`，页面提示“项目集编码已存在，请修改后重试”。
- 诊断期间创建的项目集 `C-DIAG0824`（ID 12）已通过页面删除，列表确认无残留。
