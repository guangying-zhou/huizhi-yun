# 角色模拟全应用控制台巡检

- 日期：2026-07-16
- 生产 bundle：`pv_prod_20260716195219_0084`
- 范围：17 个企业角色、85 次当前可见应用入口点击
- 结果：新增浏览器 error/warn 0；所有角色退出模拟均无需刷新。

## 修复

- Console 模拟态不再调用管理员级 bundle refresh。
- 退出或过期模拟后刷新真实操作者的模拟能力与企业角色目录缓存。
- Foundation 将 Altoc 单用户姓名查询路由到 Console 最小共享投影；生产只授权 `altoc.runtime` 的 `console:directory-users:read`。
- Assets 对 Console 目录遗留的 `/assets/overview` 入口按现有权限选择可访问落地页，项目成员不再进入 no-access。

## 生产版本

- Console：`24d91905-03b4-4d04-b463-9a3c646c1b28`
- Altoc：`865fe548-3999-4362-b55a-48acc3789499`
- Assets：`cc36c2e8-2669-4e5e-9134-1cfad837c1db`

People 工作台的“未授权”仅是成本卡片提示缺少 `standard_costs:view`，不属于页面访问失败。
