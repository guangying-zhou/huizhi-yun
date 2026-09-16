# Altoc Directory System User 404

## Symptom

访问 `https://wiztek.huizhi.yun/altoc/contracts` 时，浏览器控制台报：

```text
GET /altoc/api/directory/users/system 404
Failed to fetch directory user system
```

## Root Cause

Altoc 合同列表的负责人字段会渲染 `UserName`，该组件通过 Foundation Directory store 请求 `/api/directory/users/:uid`。部分业务数据中的 `owner_user_id` 为内置服务操作者 `system`，但 Console Directory 只保存真实目录用户，没有 `system` 这条用户记录。Foundation 目录代理此前无条件把 `system` 转发到 Console，所以上游返回 404，并由 store 打出 `console.error`。

## Fix

Foundation 增加 `builtinDirectoryUsers` helper，在 `/api/directory/users/:uid` 和 `/api/directory/users/batch` 代理 Console 前先解析 `system`。真实用户仍继续走 Console Directory，不恢复 Account fallback。

## Evidence

- `pnpm --dir foundation test` 通过，含新增内置目录身份测试。
- `pnpm --dir foundation typecheck` 通过。
- `pnpm --dir altoc test` 通过。
- `pnpm --dir altoc typecheck` 通过。
- 本地启动 Altoc 后，请求 `http://127.0.0.1:3013/altoc/api/directory/users/system` 返回 `200` 和 `{ uid: "system", realName: "系统" }`。
- 本地请求 `POST /altoc/api/directory/users/batch`，body `{ "uids": ["system"] }` 返回 `200` 和内置用户数组。

## Status

DONE
