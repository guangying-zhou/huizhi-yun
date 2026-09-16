# 委员会管理

委员会是 Console Directory Runtime 中的目录组织类型，使用
`directory_departments.org_type = 'committee'` 表示；成员及观察员关系使用
`directory_user_departments`。委员会和成员事实不复制到 People。

## 管理页面

- 页面：`/directory/committees`
- 查看权限：`directory_departments:view`
- 新建、编辑、删除及成员维护权限：`directory_departments:edit`
- 删除委员会前必须先移除全部有效成员。

委员会角色：

| 角色 | 存储语义 | 是否进入委员会 subject membership |
| --- | --- | --- |
| 主任 `leader` | `leader_uid` + active `member` relation | 是 |
| 秘书 `manager` | `manager_uid` + active `member` relation | 是 |
| 委员 `member` | active `member` relation | 是 |
| 观察员 `observer` | active `observer` relation | 否 |

每个委员会最多一名主任和一名秘书。调整主任或秘书时，原负责人保留为普通委员，
除非管理员显式调整角色或移除。

## 管理 API

所有接口均位于 `/api/v1/console/directory`，使用当前 Console 用户会话和统一权限校验。

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/committees` | 分页查询委员会；支持 `page`、`pageSize`、`search`、`status` |
| `POST` | `/committees` | 新建委员会 |
| `PATCH` | `/committees/{committeeCode}` | 更新委员会基础信息 |
| `DELETE` | `/committees/{committeeCode}` | 逻辑删除无有效成员的委员会 |
| `GET` | `/committees/{committeeCode}/members` | 分页查询成员；支持 `search`、`role` |
| `POST` | `/committees/{committeeCode}/members` | 批量添加成员，body 为 `{ members: [{ uid, role }] }` |
| `PATCH` | `/committees/{committeeCode}/members/{uid}` | 调整单个成员角色，body 为 `{ role }` |
| `DELETE` | `/committees/{committeeCode}/members/{uid}` | 移除成员并清理其主任/秘书身份 |

成员写操作锁定委员会行，并在同一事务内更新目录关系及
`leader_uid` / `manager_uid`，避免角色与委员会负责人字段不一致。
