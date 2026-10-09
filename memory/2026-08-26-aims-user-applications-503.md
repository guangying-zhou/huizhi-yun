# AIMS 用户应用清单 503

## DEBUG REPORT

```text
Symptom:         访问 AIMS 项目文档页时，GET /aims/api/user/applications 返回 503。
Root cause:      Foundation 的用户应用清单代理仍用 fetchExternal 回调 Console 公网域名，
                 没有复用已部署的 HZY_CONSOLE_SERVICE。公网子请求受边缘/WAF 和超时影响，
                 失败后被该路由统一映射成 Authorization Unavailable 503。
Fix:             用户应用清单改用 fetchConsoleServiceJson(event, ...)，托管云通过
                 Console Service Binding 直连；HTTP 兼容路径携带内部 Worker User-Agent。
Evidence:        修复前新增回归断言失败；修复后 Foundation 309 项测试、lint、typecheck、
                 AIMS 261 项部署预检和 typecheck 全部通过。生产部署版本
                 177469df-5989-4352-b8ea-041145b9acb3 上刷新项目 257 文档页，
                 /aims/api/user/applications 连续两次返回 200，DevTools 控制台为 0 条消息。
Regression test: foundation/test/userApplicationSelection.test.ts
Related:         Console Runtime 与权限快照此前已迁移到 Service Binding；该旧清单代理是遗漏路径。
Status:          DONE
```

## 设计结论

- 托管云业务 Worker 对 Console 的服务端请求必须统一经过 `HZY_CONSOLE_SERVICE`。
- 用户令牌、Cookie、租户网关和 Data Runtime 上下文仍由原代理透传；Service Binding 只替换传输边界，不改变授权语义。
- 自托管或本地环境没有绑定时仍保留 HTTP 回退，并使用现有 WAF 内部 Worker 标识。
