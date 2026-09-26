package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// 委托型企业端点共用的外壳。
//
// 每个企业读写端点都要做同样四件事：验签服务身份并要求精确 capability、把
// permit 绑定到已验签的 actor、只放行白名单 query 键、再用 actor 覆盖
// current_user 后交给既有 Aims handler。
//
// 后两件是有分量的：legacy 适配器的数据范围完全按 query 判定——
// requireProjectReadAccess 读 current_user，currentUserIsProjectAdmin 命中即
// 直接放行。宿主本应按已验证会话算出这些值，但那样一来宿主每条路由的转发都
// 是一道独立的信任边界。运行时保留白名单与 actor 覆盖，宿主某条路由漏过滤
// 就不会直接变成越权。
//
// 所以这里抽掉的是样板，不是边界：路径与允许的 query 键仍按资源逐条声明，
// capability 仍按资源和动作区分。单一通用透传会一次放开 HandleRuntime 的全部
// 193 条路径（含 integration-operations 投递领取），并把上述两道检查一起去掉。

var enterpriseDelegatedID = regexp.MustCompile(`^[1-9][0-9]*$`)

// 范围键与 enterprise_projects.go 保持同一集合：这些由宿主按已验证会话算出，
// 运行时只校验形状，真正的可见性判定仍在 Aims 内部完成。
var enterpriseDelegatedScopeKey = regexp.MustCompile(`^current_user_(?:dept_codes|management_dept_codes|is_project_admin|project_admin_(?:dept_codes|project_codes|member_scope|owner_scope|member_project_codes|owner_project_codes))$`)

type enterpriseDelegatedPermit struct {
	ActorUID   string `json:"actorUid"`
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	Resource   string `json:"resource"`
	Action     string `json:"action"`
	ExpiresAt  int64  `json:"expiresAt"`
}

type enterpriseDelegatedInput struct {
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	ProjectID  string `json:"projectId"`
	ObjectID   string `json:"objectId"`
	SubID      string `json:"subId"`
	// 非数字路径段（用户 uid、周期键、项目编码等）。每个 action 自带正则，
	// 不设通用兜底：放宽一次就等于给所有端点放宽。
	Code          string                    `json:"code"`
	Query         map[string]string         `json:"query"`
	Payload       map[string]any            `json:"payload"`
	Authorization enterpriseDelegatedPermit `json:"authorization"`
}

// Target 只能由 spec 构造，调用方提供的永远是被正则校验过的 ID 片段，不是路径。
type enterpriseDelegatedAction struct {
	Method       string
	PermitAction string
	NeedsProject bool
	NeedsObject  bool
	NeedsSub     bool
	// CodePattern 非空即表示该 action 需要 Code，并按此正则严格校验
	CodePattern  *regexp.Regexp
	AllowScope   bool
	AllowPayload bool
	QueryKeys    []string
	Target       func(in enterpriseDelegatedInput) string
}

type enterpriseDelegatedSpec struct {
	Domain    string // 逻辑域，同时是 capability 的第一段
	Resource  string // capability 第二段，同时是 permit.Resource
	ErrorCode string // 错误码前缀
	Actions   map[string]enterpriseDelegatedAction
}

type enterpriseDelegatedRoute struct {
	Spec   enterpriseDelegatedSpec
	Action string
}

func buildEnterpriseDelegatedRoutes(specs ...enterpriseDelegatedSpec) map[string]enterpriseDelegatedRoute {
	routes := map[string]enterpriseDelegatedRoute{}
	for _, spec := range specs {
		for name := range spec.Actions {
			path := "/v1/enterprise/" + spec.Domain + "/" + spec.Resource + ":" + name
			if _, clash := routes[path]; clash {
				// 重复注册会让两个资源共用一条路径，授权语义随之不确定。
				panic("duplicate enterprise delegated route: " + path)
			}
			routes[path] = enterpriseDelegatedRoute{Spec: spec, Action: name}
		}
	}
	return routes
}

func (s *Server) routeEnterpriseDelegated(r *http.Request, route enterpriseDelegatedRoute) (routeResult, error) {
	spec := route.Spec
	act, known := spec.Actions[route.Action]
	if !known {
		return routeResult{}, httperror.New(http.StatusNotFound, spec.ErrorCode+"_operation_unknown", "Operation is not registered")
	}
	if !s.cfg.Enterprise.Enabled || s.aims == nil || spec.Domain != "aims" {
		return routeResult{}, httperror.New(http.StatusServiceUnavailable, spec.ErrorCode+"_unavailable", "Unified reads are not enabled")
	}
	ctxRoute := enterpriseRouteContext{
		Binding:        enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment},
		HostDeployment: s.cfg.DeploymentBindings["enterprise"],
		LogicalSource:  spec.Domain, LogicalTarget: spec.Domain,

		Capability: spec.Domain + ":" + spec.Resource + ":" + act.PermitAction,
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, ctxRoute, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise." + spec.Domain + "." + spec.Resource + "." + route.Action, Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(http.StatusBadRequest, spec.ErrorCode+"_input_invalid", "Query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	input, err := decodeEnterpriseDelegatedInput(body, spec)
	if err != nil {
		return result, err
	}
	if err = validateEnterpriseDelegatedPermit(input, verified, spec, act, time.Now()); err != nil {
		return result, err
	}
	query, err := enterpriseDelegatedQuery(input, spec, act, verified.ActorUID)
	if err != nil {
		return result, err
	}
	payload := map[string]any{}
	if act.AllowPayload && input.Payload != nil {
		payload = input.Payload
	}
	out, operation, err := s.aims.HandleRuntime(r.Context(), act.Method, act.Target(input), query, payload)
	if operation != "" {
		result.Operation = "enterprise." + operation
	}
	result.Body = out
	return result, err
}

func decodeEnterpriseDelegatedInput(body map[string]any, spec enterpriseDelegatedSpec) (enterpriseDelegatedInput, error) {
	var input enterpriseDelegatedInput
	raw, err := json.Marshal(body)
	if err != nil {
		return input, httperror.New(http.StatusBadRequest, spec.ErrorCode+"_input_invalid", "Invalid input")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&input); err != nil {
		return input, httperror.New(http.StatusBadRequest, spec.ErrorCode+"_input_invalid", "Invalid input")
	}
	return input, nil
}

func validateEnterpriseDelegatedPermit(input enterpriseDelegatedInput, verified enterpriseRequestContext, spec enterpriseDelegatedSpec, act enterpriseDelegatedAction, now time.Time) error {
	permit := input.Authorization
	if input.Tenant != verified.Route.Binding.Tenant || input.Deployment != verified.Route.HostDeployment ||
		permit.Tenant != input.Tenant || permit.Deployment != input.Deployment ||
		permit.ActorUID != verified.ActorUID || permit.Resource != spec.Resource || permit.Action != act.PermitAction ||
		permit.ExpiresAt <= now.UnixMilli() || permit.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(http.StatusForbidden, spec.ErrorCode+"_permit_invalid", "Authorization is invalid")
	}
	return nil
}

func enterpriseDelegatedQuery(input enterpriseDelegatedInput, spec enterpriseDelegatedSpec, act enterpriseDelegatedAction, actorUID string) (url.Values, error) {
	invalid := httperror.New(http.StatusBadRequest, spec.ErrorCode+"_input_invalid", "Input is invalid")
	if err := requireEnterpriseDelegatedID(input.ProjectID, act.NeedsProject); err != nil {
		return nil, invalid
	}
	if err := requireEnterpriseDelegatedID(input.ObjectID, act.NeedsObject); err != nil {
		return nil, invalid
	}
	if err := requireEnterpriseDelegatedID(input.SubID, act.NeedsSub); err != nil {
		return nil, invalid
	}
	if act.CodePattern != nil {
		if len(input.Code) > 64 || !act.CodePattern.MatchString(input.Code) {
			return nil, invalid
		}
	} else if strings.TrimSpace(input.Code) != "" {
		return nil, invalid
	}
	if !act.AllowPayload && len(input.Payload) > 0 {
		return nil, invalid
	}
	allowed := map[string]struct{}{}
	for _, key := range act.QueryKeys {
		allowed[key] = struct{}{}
	}
	query := url.Values{}
	for key, value := range input.Query {
		if value == "" || len(value) > 1000 {
			return nil, invalid
		}
		if act.AllowScope && enterpriseDelegatedScopeKey.MatchString(key) {
			query.Set(key, value)
			continue
		}
		if _, ok := allowed[key]; !ok {
			return nil, invalid
		}
		query.Set(key, value)
	}
	// 覆盖而不是合并：调用方填入的 current_user 一律作废，范围只认已验签 actor。
	query.Set("current_user", actorUID)
	query.Set("operator_uid", actorUID)
	return query, nil
}

func requireEnterpriseDelegatedID(value string, required bool) error {
	if !required {
		if strings.TrimSpace(value) != "" {
			return httperror.New(http.StatusBadRequest, "enterprise_delegated_input_invalid", "Unexpected identifier")
		}
		return nil
	}
	if !enterpriseDelegatedID.MatchString(value) {
		return httperror.New(http.StatusBadRequest, "enterprise_delegated_input_invalid", "Identifier is invalid")
	}
	// 正则已排除前导符号、零与空值；这一步只排除超出 int64 的数字串。
	if _, err := strconv.ParseInt(value, 10, 64); err != nil {
		return httperror.New(http.StatusBadRequest, "enterprise_delegated_input_invalid", "Identifier is invalid")
	}
	return nil
}
