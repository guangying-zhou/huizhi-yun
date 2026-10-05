# 008 节点阈值与部门成员审批人约定

日期：2026-05-12

本迁移不新增数据库列，扩展 `flow_schemas.nodes` JSON 约定；旧 `approve_mode=any|all` 行为保持不变。

## approve_mode 扩展

节点支持：

- `any`：任一待办通过后节点通过，并取消同节点其他 pending 任务。
- `all`：全部待办完成后节点通过。
- `count`：达到 `approve_threshold.count` 人通过后节点通过。
- `ratio`：按解析后的任务总人数乘以 `approve_threshold.ratio` 计算通过人数。

半数以上示例：

```json
{
  "name": "委员会表决",
  "type": "countersign",
  "approve_mode": "ratio",
  "approve_threshold": {
    "ratio": 0.5,
    "round": "floor_plus_one"
  }
}
```

三分之二以上示例：

```json
{
  "approve_mode": "ratio",
  "approve_threshold": {
    "ratio": 0.6667,
    "round": "ceil"
  }
}
```

指定 2 人通过示例：

```json
{
  "approve_mode": "count",
  "approve_threshold": {
    "count": 2
  }
}
```

`approve_threshold.round` 可选值为 `ceil`、`floor_plus_one`、`floor`，默认 `ceil`；`min` 默认 1，`max` 可选。

## dept_members 审批人

新增审批人类型 `dept_members`，用于从 Console Directory Runtime 动态解析部门成员，解析结果会写入 `flow_instances.flow_snapshot.nodes[].resolved_assignees`，后续流转不再重新抽样。

```json
{
  "type": "dept_members",
  "scope": "form_field",
  "field_key": "committee_dept_code",
  "exclude_initiator": true,
  "sample": {
    "mode": "random",
    "count_from_field": "committee_pass_count",
    "seed": "biz_id"
  }
}
```

支持的 `scope`：

- `initiator_dept`：发起人部门。
- `resource_dept`：`biz_context.resource_dept_code`。
- `specified`：节点内 `dept_code`。
- `form_field`：优先读取 `form_data[field_key]`，否则读取业务上下文同名路径。

若排除发起人后没有候选人，发起实例时返回明确错误。
