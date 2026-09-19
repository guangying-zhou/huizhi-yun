package server

import (
	"strings"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func delegatedVerified() enterpriseRequestContext {
	return enterpriseRequestContext{
		ActorUID: "person-a",
		Route: enterpriseRouteContext{
			Binding:        enterprise.BindingKey{Tenant: "tenant-a", Environment: "test", RuntimeDeployment: "rt"},
			HostDeployment: "enterprise-test",
		},
	}
}

func delegatedInput() enterpriseDelegatedInput {
	now := time.Now()
	return enterpriseDelegatedInput{
		Tenant: "tenant-a", Deployment: "enterprise-test", ObjectID: "12",
		Authorization: enterpriseDelegatedPermit{
			ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test",
			Resource: "work-item-comments", Action: "view",
			ExpiresAt: now.Add(10 * time.Second).UnixMilli(),
		},
	}
}

// 范围由已验签 actor 决定：调用方连 current_user 都不能提供（不在白名单内，
// 直接拒绝），运行时再自行写入。legacy 适配器的 requireProjectReadAccess 只认
// query 里的这个值，所以它必须只有一个来源。
func TestEnterpriseDelegatedQueryBindsActorAndRejectsCallerSuppliedActor(t *testing.T) {
	spec := enterpriseWorkItemCommentSpec
	act := spec.Actions["view"]

	for _, key := range []string{"current_user", "operator_uid"} {
		in := delegatedInput()
		in.Query = map[string]string{key: "person-b"}
		if _, err := enterpriseDelegatedQuery(in, spec, act, "person-a"); err == nil {
			t.Fatalf("调用方提供的 %s 被接受", key)
		}
	}

	in := delegatedInput()
	in.Query = map[string]string{"current_user_dept_codes": "D1"}
	query, err := enterpriseDelegatedQuery(in, spec, act, "person-a")
	if err != nil {
		t.Fatalf("合法输入被拒: %v", err)
	}
	if query.Get("current_user") != "person-a" || query.Get("operator_uid") != "person-a" {
		t.Fatalf("actor 未绑定: current_user=%q operator_uid=%q", query.Get("current_user"), query.Get("operator_uid"))
	}
	if query.Get("current_user_dept_codes") != "D1" {
		t.Fatal("范围键被丢弃")
	}
}

func TestEnterpriseDelegatedQueryRejectsUnlistedKeysAndPayload(t *testing.T) {
	spec := enterpriseWorkItemCommentSpec
	view := spec.Actions["view"]
	for name, in := range map[string]enterpriseDelegatedInput{
		"任意 query 键":     {Tenant: "tenant-a", Deployment: "enterprise-test", ObjectID: "12", Query: map[string]string{"projectId": "9"}},
		"空值":             {Tenant: "tenant-a", Deployment: "enterprise-test", ObjectID: "12", Query: map[string]string{"current_user_dept_codes": ""}},
		"超长值":            {Tenant: "tenant-a", Deployment: "enterprise-test", ObjectID: "12", Query: map[string]string{"current_user_dept_codes": strings.Repeat("x", 1001)}},
		"读动作不得带 payload": {Tenant: "tenant-a", Deployment: "enterprise-test", ObjectID: "12", Payload: map[string]any{"body": "x"}},
	} {
		if _, err := enterpriseDelegatedQuery(in, spec, view, "person-a"); err == nil {
			t.Fatalf("%s 被接受", name)
		}
	}
}

// 伪装成范围键的名字不能蒙混过关：只有精确匹配白名单正则的才放行。
func TestEnterpriseDelegatedScopeKeyIsExact(t *testing.T) {
	for _, key := range []string{"current_user_is_project_adminx", "xcurrent_user_dept_codes", "current_user_", "current_userdept_codes"} {
		if enterpriseDelegatedScopeKey.MatchString(key) {
			t.Fatalf("scope key %q 不应匹配", key)
		}
	}
	for _, key := range []string{"current_user_dept_codes", "current_user_is_project_admin", "current_user_project_admin_owner_scope"} {
		if !enterpriseDelegatedScopeKey.MatchString(key) {
			t.Fatalf("scope key %q 应匹配", key)
		}
	}
}

func TestEnterpriseDelegatedIDValidation(t *testing.T) {
	spec := enterpriseWorkItemTimeEntrySpec
	update := spec.Actions["update"]
	base := enterpriseDelegatedInput{Tenant: "tenant-a", Deployment: "enterprise-test"}
	for name, in := range map[string]enterpriseDelegatedInput{
		"缺 objectID": {Tenant: base.Tenant, Deployment: base.Deployment, SubID: "3"},
		"缺 subID":    {Tenant: base.Tenant, Deployment: base.Deployment, ObjectID: "12"},
		"零值":         {Tenant: base.Tenant, Deployment: base.Deployment, ObjectID: "0", SubID: "3"},
		"负号":         {Tenant: base.Tenant, Deployment: base.Deployment, ObjectID: "-1", SubID: "3"},
		"非数字":        {Tenant: base.Tenant, Deployment: base.Deployment, ObjectID: "12a", SubID: "3"},
		"路径穿越":       {Tenant: base.Tenant, Deployment: base.Deployment, ObjectID: "12/../13", SubID: "3"},
		"超出 int64":   {Tenant: base.Tenant, Deployment: base.Deployment, ObjectID: "99999999999999999999", SubID: "3"},
	} {
		if _, err := enterpriseDelegatedQuery(in, spec, update, "person-a"); err == nil {
			t.Fatalf("%s 被接受", name)
		}
	}
	ok := enterpriseDelegatedInput{Tenant: base.Tenant, Deployment: base.Deployment, ObjectID: "12", SubID: "3"}
	if _, err := enterpriseDelegatedQuery(ok, spec, update, "person-a"); err != nil {
		t.Fatalf("合法 ID 被拒: %v", err)
	}
	// 动作不需要的 ID 不得出现，避免调用方借未使用字段试探。
	extra := ok
	extra.ProjectID = "7"
	if _, err := enterpriseDelegatedQuery(extra, spec, update, "person-a"); err == nil {
		t.Fatal("多余的 projectId 被接受")
	}
}

func TestEnterpriseDelegatedPermitRejectsEveryMismatch(t *testing.T) {
	now := time.Now()
	spec := enterpriseWorkItemCommentSpec
	act := spec.Actions["view"]
	verified := delegatedVerified()
	if err := validateEnterpriseDelegatedPermit(delegatedInput(), verified, spec, act, now); err != nil {
		t.Fatalf("合法 permit 被拒: %v", err)
	}
	mutations := map[string]func(*enterpriseDelegatedInput){
		"租户不符":           func(in *enterpriseDelegatedInput) { in.Tenant = "tenant-b"; in.Authorization.Tenant = "tenant-b" },
		"部署不符":           func(in *enterpriseDelegatedInput) { in.Deployment = "other"; in.Authorization.Deployment = "other" },
		"permit 租户与信封不符": func(in *enterpriseDelegatedInput) { in.Authorization.Tenant = "tenant-b" },
		"actor 与验签不符":    func(in *enterpriseDelegatedInput) { in.Authorization.ActorUID = "person-b" },
		"资源不符":           func(in *enterpriseDelegatedInput) { in.Authorization.Resource = "work-items" },
		"动作不符":           func(in *enterpriseDelegatedInput) { in.Authorization.Action = "edit" },
		"已过期":            func(in *enterpriseDelegatedInput) { in.Authorization.ExpiresAt = now.Add(-time.Second).UnixMilli() },
		"有效期过长":          func(in *enterpriseDelegatedInput) { in.Authorization.ExpiresAt = now.Add(time.Hour).UnixMilli() },
	}
	for name, mutate := range mutations {
		in := delegatedInput()
		mutate(&in)
		if validateEnterpriseDelegatedPermit(in, verified, spec, act, now) == nil {
			t.Fatalf("%s 被接受", name)
		}
	}
}

// 注册表自身的不变量：capability 必须满足 authenticateEnterpriseRequest 的形状要求，
// 否则该端点在运行时只会返回 503，而不是在这里被发现。
func TestEnterpriseDelegatedRoutesAreWellFormed(t *testing.T) {
	if len(enterpriseDelegatedRoutes) == 0 {
		t.Fatal("注册表为空")
	}
	for path, route := range enterpriseDelegatedRoutes {
		act := route.Spec.Actions[route.Action]
		if !strings.HasPrefix(path, "/v1/enterprise/"+route.Spec.Domain+"/") || !strings.Contains(path, ":") {
			t.Fatalf("路径形状不合法: %s", path)
		}
		capability := route.Spec.Domain + ":" + route.Spec.Resource + ":" + act.PermitAction
		parts := strings.Split(capability, ":")
		if len(parts) != 3 || parts[0] != route.Spec.Domain || parts[1] == "" || parts[2] == "" || strings.Contains(capability, "*") {
			t.Fatalf("%s 的 capability 不合法: %s", path, capability)
		}
		if act.Method == "" || act.Target == nil || route.Spec.ErrorCode == "" {
			t.Fatalf("%s 的 action 定义不完整", path)
		}
		// 目标必须落在本域的 legacy 命名空间内，且不得由调用方拼接出越界路径。
		target := act.Target(enterpriseDelegatedInput{ProjectID: "1", ObjectID: "2", SubID: "3"})
		if !strings.HasPrefix(target, "/v1/"+route.Spec.Domain+"/") || strings.Contains(target, "..") {
			t.Fatalf("%s 的目标路径不合法: %s", path, target)
		}
	}
}

func TestEnterpriseDelegatedCapabilitiesAreDeduplicated(t *testing.T) {
	list := enterpriseDelegatedCapabilities()
	seen := map[string]struct{}{}
	for _, capability := range list {
		if _, dup := seen[capability]; dup {
			t.Fatalf("capability 重复: %s", capability)
		}
		seen[capability] = struct{}{}
	}
	for _, want := range []string{"aims:work-item-comments:view", "aims:work-item-time-entries:edit", "aims:work-item-execution:view"} {
		if _, ok := seen[want]; !ok {
			t.Fatalf("缺少 capability %s", want)
		}
	}
}

// 企业项目列表的筛选键必须翻译成 Aims 实际读取的名字。
// lifecycleStatus 原样透传会被静默忽略：Aims 只读 lifecycle_status，
// 结果是筛选无效且默认的“排除 archived”始终生效，归档项目永远取不到。
func TestEnterpriseProjectQueryTranslatesFilterKeys(t *testing.T) {
	input := enterpriseProjectReadInput{Query: map[string]string{
		"lifecycleStatus":   "archived",
		"includeArchived":   "true",
		"portfolioId":       "3",
		"participatingOnly": "true",
		"search":            "bdc",
	}}
	_, query, err := enterpriseProjectReadTarget("list", input, "person-a")
	if err != nil {
		t.Fatalf("合法筛选被拒: %v", err)
	}
	if query.Get("lifecycle_status") != "archived" {
		t.Fatalf("lifecycleStatus 未翻译为 lifecycle_status: %v", query)
	}
	if query.Has("lifecycleStatus") {
		t.Fatal("驼峰键不应继续下传")
	}
	// portfolioId / participatingOnly 同样翻译成 Aims 实际读取的蛇形名字
	for key, want := range map[string]string{"includeArchived": "true", "portfolio_id": "3", "participating_only": "true", "search": "bdc"} {
		if query.Get(key) != want {
			t.Fatalf("%s 丢失或被改写: %q", key, query.Get(key))
		}
	}
	for _, camel := range []string{"portfolioId", "participatingOnly"} {
		if query.Has(camel) {
			t.Fatalf("驼峰键 %s 不应继续下传", camel)
		}
	}
	if query.Get("current_user") != "person-a" {
		t.Fatal("actor 未绑定")
	}
	// 蛇形是真实线上格式，必须接受；未登记的键仍然必须拒绝，翻译不等于放宽。
	if _, _, err := enterpriseProjectReadTarget("list", enterpriseProjectReadInput{Query: map[string]string{"lifecycle_status": "archived"}}, "person-a"); err != nil {
		t.Fatalf("蛇形 lifecycle_status 被拒: %v", err)
	}
	for _, key := range []string{"current_user", "operator_uid", "projectId", "任意键"} {
		if _, _, err := enterpriseProjectReadTarget("list", enterpriseProjectReadInput{Query: map[string]string{key: "x"}}, "person-a"); err == nil {
			t.Fatalf("未登记的键 %s 被接受", key)
		}
	}
}

// 项目 store 发送的是蛇形键（fetchProjectPage 里 params.set('participating_only','1')），
// 只登记驼峰会让整张列表 400。两种形式都必须落到 Aims 实际读取的名字上。
func TestEnterpriseProjectQueryAcceptsStoreWireFormat(t *testing.T) {
	input := enterpriseProjectReadInput{Query: map[string]string{
		"participating_only": "1", "lifecycle_status": "active", "portfolio_id": "3",
		"domain_code": "D1", "dept_code": "GMO", "leader_uid": "person-a", "pageSize": "100",
	}}
	_, query, err := enterpriseProjectReadTarget("list", input, "person-a")
	if err != nil {
		t.Fatalf("store 的线上格式被拒: %v", err)
	}
	for key, want := range map[string]string{
		"participating_only": "1", "lifecycle_status": "active", "portfolio_id": "3",
		"domain_code": "D1", "dept_code": "GMO", "leader_uid": "person-a", "pageSize": "100",
	} {
		if query.Get(key) != want {
			t.Fatalf("%s 丢失: %q", key, query.Get(key))
		}
	}
	// 驼峰兼容入口仍然翻译到同一个名字
	_, camel, err := enterpriseProjectReadTarget("list", enterpriseProjectReadInput{Query: map[string]string{
		"participatingOnly": "1", "portfolioId": "3",
	}}, "person-a")
	if err != nil || camel.Get("participating_only") != "1" || camel.Get("portfolio_id") != "3" {
		t.Fatalf("驼峰未翻译: %v %v", camel, err)
	}
}

// Code 段（用户 uid、周期键）必须按各 action 自带的正则校验，
// 且不需要 Code 的 action 不得接受它——否则就是给所有端点开了一个自由字段。
func TestEnterpriseDelegatedCodeSegmentIsStrict(t *testing.T) {
	uidAction := enterpriseUserTimeEntrySpec.Actions["list"]
	base := enterpriseDelegatedInput{Tenant: "tenant-a", Deployment: "enterprise-test"}
	for _, bad := range []string{"", "a/b", "../etc", "person a", strings.Repeat("x", 65), "人"} {
		in := base
		in.Code = bad
		if _, err := enterpriseDelegatedQuery(in, enterpriseUserTimeEntrySpec, uidAction, "person-a"); err == nil {
			t.Fatalf("非法 uid %q 被接受", bad)
		}
	}
	ok := base
	ok.Code = "person-a"
	if _, err := enterpriseDelegatedQuery(ok, enterpriseUserTimeEntrySpec, uidAction, "person-a"); err != nil {
		t.Fatalf("合法 uid 被拒: %v", err)
	}
	if got := uidAction.Target(ok); got != "/v1/aims/users/person-a/time-entries" {
		t.Fatalf("目标路径不对: %s", got)
	}

	weekAction := enterpriseTimesheetWeekSpec.Actions["submit"]
	for _, bad := range []string{"", "2026-W1", "2026W30", "2026-W30/x", "abcd-Wxy"} {
		in := base
		in.Code = bad
		if _, err := enterpriseDelegatedQuery(in, enterpriseTimesheetWeekSpec, weekAction, "person-a"); err == nil {
			t.Fatalf("非法周期键 %q 被接受", bad)
		}
	}
	week := base
	week.Code = "2026-W30"
	if _, err := enterpriseDelegatedQuery(week, enterpriseTimesheetWeekSpec, weekAction, "person-a"); err != nil {
		t.Fatalf("合法周期键被拒: %v", err)
	}

	// 不声明 CodePattern 的 action 一律拒绝 Code
	noCode := enterpriseMyWorkItemSpec.Actions["list"]
	withCode := base
	withCode.Code = "anything"
	if _, err := enterpriseDelegatedQuery(withCode, enterpriseMyWorkItemSpec, noCode, "person-a"); err == nil {
		t.Fatal("未声明 CodePattern 的 action 接受了 Code")
	}
}
