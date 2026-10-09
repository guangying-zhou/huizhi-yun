package server

import (
	"context"
	"net/http"

	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// 项目集与项目删除：项目列表页的剩余依赖。
//
// current_user_can_manage_portfolios 是一个权限派生标志，不是数据范围键，
// 所以不走 AllowScope 而是显式登记。运行时无法评估 portfolios:admin
// （那是 Console 策略，属宿主侧），因此这里沿用与范围键相同的信任边界：
// 只接受已验签的 enterprise 服务身份传入，且宿主必须在 requirePermission
// 通过后才注入、并先丢弃调用方自带的同名参数（与 Aims 中间件一致）。

var enterpriseProjectPortfolioSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "project-portfolios", ErrorCode: "enterprise_project_portfolios",
	Actions: map[string]enterpriseDelegatedAction{
		"list": {
			Method: http.MethodGet, PermitAction: "view", AllowScope: true,
			QueryKeys: []string{"page", "pageSize", "search", "status", "defaultCategory"},
			Target:    func(enterpriseDelegatedInput) string { return "/v1/aims/portfolios" },
		},
		"create": {
			Method: http.MethodPost, PermitAction: "edit", AllowScope: true, AllowPayload: true,
			QueryKeys: []string{"current_user_can_manage_portfolios"},
			Target:    func(enterpriseDelegatedInput) string { return "/v1/aims/portfolios" },
		},
		"update": {
			Method: http.MethodPut, PermitAction: "edit", NeedsObject: true, AllowScope: true, AllowPayload: true,
			QueryKeys: []string{"current_user_can_manage_portfolios"},
			Target:    func(in enterpriseDelegatedInput) string { return "/v1/aims/portfolios/" + in.ObjectID },
		},
		"delete": {
			Method: http.MethodDelete, PermitAction: "edit", NeedsObject: true, AllowScope: true,
			QueryKeys: []string{"current_user_can_manage_portfolios"},
			Target:    func(in enterpriseDelegatedInput) string { return "/v1/aims/portfolios/" + in.ObjectID },
		},
		// 项目集成员与文档仓库登记（DOC-05a）。成员关系在 Runtime 事务内对锁定行复核；
		// current_user_can_manage_portfolios 仍只由宿主在 portfolios:admin 通过后注入，
		// 列表可不带该标志（只影响返回的 canManage），写入缺少它即 403。
		"members-list": {
			Method: http.MethodGet, PermitAction: "view", NeedsObject: true, AllowScope: true,
			QueryKeys: []string{"current_user_can_manage_portfolios"},
			Target:    func(in enterpriseDelegatedInput) string { return "/v1/aims/portfolios/" + in.ObjectID + "/members" },
		},
		"members-save": {
			Method: http.MethodPut, PermitAction: "edit", NeedsObject: true, AllowScope: true, AllowPayload: true,
			QueryKeys: []string{"current_user_can_manage_portfolios"},
			Target:    func(in enterpriseDelegatedInput) string { return "/v1/aims/portfolios/" + in.ObjectID + "/members" },
		},
		// 项目集文档只读列表（DOC-05，5b-1）。宿主先过 portfolios:view；与项目集的当前关系
		// （负责人、有效成员或组内项目成员）由 Runtime 用已验签 actor 自行计算，两者必须同时成立。
		// 单份文档能否查看由 Codocs 策略经进程内 typed 调用判定，不签服务令牌。
		"documents-list": {
			Method: http.MethodGet, PermitAction: "view", NeedsObject: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string { return "/v1/aims/portfolios/" + in.ObjectID + "/documents" },
		},
		// 项目集文档写入（DOC-05，5b-2）：登记已有文档或仓库文件、文件夹、移除引用、维护访问策略。
		// 宿主先过 portfolios:edit；管理者/参与者关系在 Runtime 写事务内对锁定行复核。
		// 归属只取路径中的项目集，payload 不能指定任何归属。三者都要求 Idempotency-Key。
		// 项目集文档正文读取（DOC-05，5c-2）。返回正文定位（不含正文），只供宿主服务端取正文；
		// 判权与列表同一规则，“不允许”与“不存在”对继承关系是同一个 404。
		"documents-content": {
			Method: http.MethodGet, PermitAction: "view", NeedsObject: true, NeedsSub: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/portfolios/" + in.ObjectID + "/documents/" + in.SubID + "/content"
			},
		},
		"documents-create": {
			Method: http.MethodPost, PermitAction: "edit", NeedsObject: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string { return "/v1/aims/portfolios/" + in.ObjectID + "/documents" },
		},
		"documents-delete": {
			Method: http.MethodDelete, PermitAction: "edit", NeedsObject: true, NeedsSub: true, AllowScope: true,
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/portfolios/" + in.ObjectID + "/documents/" + in.SubID
			},
		},
		"documents-policy": {
			Method: http.MethodPut, PermitAction: "edit", NeedsObject: true, NeedsSub: true, AllowScope: true, AllowPayload: true,
			Target: func(in enterpriseDelegatedInput) string {
				return "/v1/aims/portfolios/" + in.ObjectID + "/documents/" + in.SubID + "/policy"
			},
		},
		"doc-repo-save": {
			Method: http.MethodPut, PermitAction: "edit", NeedsObject: true, AllowScope: true, AllowPayload: true,
			QueryKeys: []string{"current_user_can_manage_portfolios"},
			Target:    func(in enterpriseDelegatedInput) string { return "/v1/aims/portfolios/" + in.ObjectID + "/doc-repo" },
		},
	},
}

// 彻底删除项目：Aims 侧要求 current_user_is_project_admin=1（范围键，服务端算出），
// 独立应用还额外要求 admin:admin。宿主必须做同样的管理员判定后才可调用，
// 因此这里单独成一个 capability，不与项目读写混用。
var enterpriseProjectDeleteSpec = enterpriseDelegatedSpec{
	Domain: "aims", Resource: "project-deletion", ErrorCode: "enterprise_project_deletion",
	Actions: map[string]enterpriseDelegatedAction{
		"execute": {
			Method: http.MethodDelete, PermitAction: "execute", NeedsProject: true, AllowScope: true, ScopeResource: "admin", ScopeAction: "admin",
			Target: func(in enterpriseDelegatedInput) string { return "/v1/aims/projects/" + in.ProjectID },
		},
	},
}

// enterprisePortfolioRelationAction lists the portfolio operations whose
// outcome depends on who currently counts as the portfolio's owner.
func enterprisePortfolioRelationAction(action string) bool {
	switch action {
	case "members-list", "members-save", "doc-repo-save", "documents-list", "documents-content", "documents-create", "documents-delete", "documents-policy":
		return true
	}
	return false
}

// enterprisePortfolioContext injects the two in-process typed dependencies of
// the portfolio relation operations (ADR-018a D11: same process, same tenant,
// no service token): the Directory check that decides whether the recorded
// owner still counts, and for document lists the Codocs policy check.
// A missing dependency fails these operations closed; other portfolio
// operations are not affected.
func (s *Server) enterprisePortfolioContext(ctx context.Context, _ string, documents bool) (context.Context, error) {
	if documents {
		return s.enterprisePortfolioActionContext(ctx, "documents-list")
	}
	return s.enterprisePortfolioActionContext(ctx, "members-list")
}

// enterprisePortfolioDocumentAction lists the operations that need Codocs.
func enterprisePortfolioDocumentAction(action string) bool {
	return action == "documents-list" || action == "documents-content" || action == "documents-create" || action == "documents-policy"
}

func (s *Server) enterprisePortfolioActionContext(ctx context.Context, action string) (context.Context, error) {
	documents := enterprisePortfolioDocumentAction(action)
	if s.directory == nil || (documents && s.codocs == nil) {
		return ctx, httperror.New(http.StatusServiceUnavailable, "enterprise_project_portfolios_dependency_unavailable", "Portfolio relation dependencies are unavailable")
	}
	ctx = aimsapp.WithPortfolioOwnerStatus(ctx, s.directory.EnterpriseActiveEmployee)
	switch action {
	case "documents-list":
		ctx = aimsapp.WithEnterprisePortfolioDocumentACL(ctx, s.enterprisePortfolioDocumentACL())
	case "documents-content":
		ctx = aimsapp.WithPortfolioDocumentReader(ctx, func(ctx context.Context, uuid string, f aimsapp.EnterprisePortfolioDocumentAccessFacts) (map[string]any, error) {
			return s.codocs.ReadEnterprisePortfolioDocument(ctx, uuid, codocsapp.EnterprisePortfolioDocumentFacts{ActorUID: f.ActorUID, PortfolioCode: f.PortfolioCode, Relation: f.Relation})
		})
	case "documents-create":
		// Linking is sharing: only the Codocs owner of the document may do it.
		ctx = aimsapp.WithPortfolioDocumentSharer(ctx, func(ctx context.Context, uuid, actor, portfolioCode string) (bool, error) {
			facts, err := s.codocs.ConfirmEnterprisePortfolioDocumentSharer(ctx, uuid, actor, portfolioCode)
			return facts.PolicyOwnedElsewhere, err
		})
	case "documents-policy":
		ctx = aimsapp.WithPortfolioDocumentPolicySaver(ctx, func(ctx context.Context, p aimsapp.PortfolioDocumentPolicy) (map[string]any, error) {
			return s.codocs.SaveEnterprisePortfolioDocumentPolicy(ctx, codocsapp.PortfolioDocumentPolicyInput{
				ActorUID: p.ActorUID, PortfolioCode: p.PortfolioCode, DocumentUUID: p.DocumentUUID,
				LifecycleStage: p.LifecycleStage, Confidentiality: p.Confidentiality, DefaultPermission: p.DefaultPermission,
				InheritToMemberProjects: p.InheritToMemberProjects, ExpectedEtag: p.ExpectedEtag,
			})
		})
	}
	return ctx, nil
}

// The facts are derived by Aims from its own rows and the signed actor; this
// bridge only forwards them to the owning Codocs policy check.
func (s *Server) enterprisePortfolioDocumentACL() aimsapp.EnterprisePortfolioDocumentACL {
	return func(ctx context.Context, uuid, ref string, f aimsapp.EnterprisePortfolioDocumentAccessFacts) (map[string]any, error) {
		return s.codocs.CheckEnterprisePortfolioDocument(ctx, uuid, ref, codocsapp.EnterprisePortfolioDocumentFacts{ActorUID: f.ActorUID, PortfolioCode: f.PortfolioCode, Relation: f.Relation})
	}
}
