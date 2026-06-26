package server

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	altocapp "github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	assetsapp "github.com/huizhi-yun/data-runtime/internal/apps/assets"
	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	"github.com/huizhi-yun/data-runtime/internal/apps/finance"
	peopleapp "github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/apps/webdev"
	"github.com/huizhi-yun/data-runtime/internal/apps/workflow"
	"github.com/huizhi-yun/data-runtime/internal/audit"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/updater"
	"github.com/huizhi-yun/data-runtime/internal/version"
)

type Server struct {
	cfg      config.Config
	auth     *auth.Authenticator
	finance  *finance.Adapter
	workflow *workflow.Adapter
	webdev   *webdev.Adapter
	assets   *assetsapp.Adapter
	people   *peopleapp.Adapter
	altoc    *altocapp.Adapter
	aims     *aimsapp.Adapter
	codocs   *codocsapp.Adapter

	updateMu       sync.Mutex
	updateInFlight bool
	updateStatus   map[string]any
}

var timeNow = time.Now

type routeResult struct {
	Operation string
	Auth      *auth.Context
	Body      any
	Status    int
}

type errorBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

type runtimeHandler interface {
	HandleRuntime(context.Context, string, string, url.Values, map[string]any) (any, string, error)
}

type pinger interface {
	Ping(context.Context) error
}

func New(cfg config.Config) (*Server, error) {
	var financeAdapter *finance.Adapter
	if cfg.Apps.Finance.Enabled {
		adapter, err := finance.New(cfg.Apps.Finance)
		if err != nil {
			return nil, err
		}
		financeAdapter = adapter
	}

	var workflowAdapter *workflow.Adapter
	if cfg.Apps.Workflow.Enabled {
		adapter, err := workflow.New(cfg.Apps.Workflow)
		if err != nil {
			return nil, err
		}
		workflowAdapter = adapter
	}

	var webdevAdapter *webdev.Adapter
	if cfg.Apps.WebDev.Enabled {
		adapter, err := webdev.New(cfg.Apps.WebDev)
		if err != nil {
			return nil, err
		}
		webdevAdapter = adapter
	}

	var assetsAdapter *assetsapp.Adapter
	if cfg.Apps.Assets.Enabled {
		adapter, err := assetsapp.New(cfg.Apps.Assets)
		if err != nil {
			return nil, err
		}
		assetsAdapter = adapter
	}

	var peopleAdapter *peopleapp.Adapter
	if cfg.Apps.People.Enabled {
		adapter, err := peopleapp.New(cfg.Apps.People)
		if err != nil {
			return nil, err
		}
		peopleAdapter = adapter
	}

	var altocAdapter *altocapp.Adapter
	if cfg.Apps.Altoc.Enabled {
		adapter, err := altocapp.New(cfg.Apps.Altoc)
		if err != nil {
			return nil, err
		}
		if financeAdapter != nil {
			adapter.SetFinanceBridge(financeAdapter)
		}
		altocAdapter = adapter
	}

	var aimsAdapter *aimsapp.Adapter
	if cfg.Apps.Aims.Enabled {
		adapter, err := aimsapp.New(cfg.Apps.Aims)
		if err != nil {
			return nil, err
		}
		aimsAdapter = adapter
	}

	var codocsAdapter *codocsapp.Adapter
	if cfg.Apps.Codocs.Enabled {
		adapter, err := codocsapp.New(cfg.Apps.Codocs)
		if err != nil {
			return nil, err
		}
		codocsAdapter = adapter
	}

	return &Server{
		cfg:      cfg,
		auth:     auth.New(cfg),
		finance:  financeAdapter,
		workflow: workflowAdapter,
		webdev:   webdevAdapter,
		assets:   assetsAdapter,
		people:   peopleAdapter,
		altoc:    altocAdapter,
		aims:     aimsAdapter,
		codocs:   codocsAdapter,
	}, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	requestID := requestID(r)
	operation := "unknown"
	status := http.StatusOK
	var authCtx *auth.Context
	errorCode := ""

	result, err := s.route(r)
	if err != nil {
		status, errorCode = writeError(w, requestID, err)
		operation = "error"
	} else {
		if result.Status != 0 {
			status = result.Status
		}
		operation = result.Operation
		authCtx = result.Auth
		writeJSON(w, requestID, status, result.Body)
	}

	audit.Log(s.cfg, authCtx, requestID, operation, r.URL.Path, status, time.Since(started), errorCode)
}

func (s *Server) route(r *http.Request) (routeResult, error) {
	path := cleanPath(r.URL.Path)

	if r.Method == http.MethodGet && (path == "/runtime/health" || path == "/runtime/healthz") {
		return routeResult{
			Operation: "runtime.health",
			Body:      s.runtimeHealth(r.Context()),
		}, nil
	}

	if r.Method == http.MethodPost && path == "/runtime/update" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "console", Scope: "runtime.update"})
		if err != nil {
			return routeResult{}, err
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		result, err := s.triggerUpdate(body)
		return routeResult{
			Operation: "runtime.update",
			Auth:      &authCtx,
			Status:    http.StatusAccepted,
			Body:      result,
		}, err
	}

	if r.Method == http.MethodGet && path == "/runtime/update/status" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "console", Scope: "runtime.update"})
		if err != nil {
			return routeResult{}, err
		}
		return routeResult{
			Operation: "runtime.update.status",
			Auth:      &authCtx,
			Body:      s.runtimeUpdateStatus(),
		}, nil
	}

	if r.Method == http.MethodGet && path == "/runtime/enrollment" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "runtime", Scope: "runtime.enrollment.read"})
		if err != nil {
			return routeResult{}, err
		}
		return routeResult{
			Operation: "runtime.enrollment",
			Auth:      &authCtx,
			Body: map[string]any{
				"tenant":     s.cfg.Tenant,
				"deployment": s.cfg.Deployment,
				"authMode":   s.cfg.Auth.Mode,
				"apps": map[string]any{
					"finance":  map[string]any{"enabled": s.finance != nil},
					"workflow": map[string]any{"enabled": s.workflow != nil},
					"webdev":   map[string]any{"enabled": s.webdev != nil},
					"assets":   map[string]any{"enabled": s.assets != nil},
					"people":   map[string]any{"enabled": s.people != nil},
					"altoc":    map[string]any{"enabled": s.altoc != nil},
					"aims":     map[string]any{"enabled": s.aims != nil},
					"codocs":   map[string]any{"enabled": s.codocs != nil},
				},
			},
		}, nil
	}

	if r.Method == http.MethodGet && path == "/runtime/schema/status" {
		app := r.URL.Query().Get("app")
		if app == "" {
			app = "finance"
		}
		if app != "finance" && app != "workflow" && app != "webdev" && app != "assets" && app != "people" && app != "altoc" && app != "aims" && app != "codocs" {
			return routeResult{}, httperror.New(http.StatusNotFound, "app_not_supported", "Unsupported schema status app")
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: app, Scope: app + ".schema.read"})
		if err != nil {
			return routeResult{}, err
		}
		body, err := s.schemaStatus(r.Context(), app)
		return routeResult{Operation: "runtime.schema.status", Auth: &authCtx, Body: body}, err
	}

	if r.Method == http.MethodPost && path == "/v1/workflow/action-defs/sync" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "workflow", Scope: "workflow.write"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireWorkflow()
		if err != nil {
			return routeResult{}, err
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		result, err := adapter.SyncActionDefs(r.Context(), body)
		return routeResult{Operation: "workflow.action_defs.sync", Auth: &authCtx, Body: result}, err
	}

	if r.Method == http.MethodPost && path == "/v1/workflow/instances/prepare" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "workflow", Scope: "workflow.write"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireWorkflow()
		if err != nil {
			return routeResult{}, err
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		result, err := adapter.PrepareInstance(r.Context(), body)
		return routeResult{Operation: "workflow.instances.prepare", Auth: &authCtx, Body: result}, err
	}

	if r.Method == http.MethodPost && path == "/v1/workflow/instances" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "workflow", Scope: "workflow.write"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireWorkflow()
		if err != nil {
			return routeResult{}, err
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		result, err := adapter.CreateInstance(r.Context(), body)
		return routeResult{Operation: "workflow.instances.create", Auth: &authCtx, Body: result}, err
	}

	if isWorkflowRuntimePath(path) {
		scope := "workflow.read"
		if r.Method != http.MethodGet {
			scope = "workflow.write"
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "workflow", Scope: scope})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireWorkflow()
		if err != nil {
			return routeResult{}, err
		}
		body := map[string]any{}
		if r.Method != http.MethodGet {
			body, err = readJSONBody(r)
			if err != nil {
				return routeResult{}, err
			}
		}
		result, operation, err := adapter.HandleRuntime(r.Context(), r.Method, path, r.URL.Query(), body)
		if operation == "" {
			operation = "workflow.runtime"
		}
		return routeResult{Operation: operation, Auth: &authCtx, Body: result}, err
	}

	if isWebDevRuntimePath(path) {
		scope := "webdev.read"
		if r.Method != http.MethodGet {
			scope = "webdev.write"
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "webdev", Scope: scope})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireWebDev()
		if err != nil {
			return routeResult{}, err
		}
		body := map[string]any{}
		if r.Method != http.MethodGet {
			body, err = readJSONBody(r)
			if err != nil {
				return routeResult{}, err
			}
		}
		result, operation, err := adapter.HandleRuntime(r.Context(), r.Method, path, r.URL.Query(), body)
		if operation == "" {
			operation = "webdev.runtime"
		}
		return routeResult{Operation: operation, Auth: &authCtx, Body: result}, err
	}

	if isAssetsRuntimePath(path) {
		adapter, err := s.requireAssets()
		if err != nil {
			return routeResult{}, err
		}
		return s.routeAppRuntime(r, "assets", adapter)
	}

	if isPeopleRuntimePath(path) {
		adapter, err := s.requirePeople()
		if err != nil {
			return routeResult{}, err
		}
		return s.routeAppRuntime(r, "people", adapter)
	}

	if isAltocRuntimePath(path) {
		adapter, err := s.requireAltoc()
		if err != nil {
			return routeResult{}, err
		}
		return s.routeAppRuntime(r, "altoc", adapter)
	}

	if isAimsRuntimePath(path) {
		adapter, err := s.requireAims()
		if err != nil {
			return routeResult{}, err
		}
		return s.routeAppRuntime(r, "aims", adapter)
	}

	if isCodocsRuntimePath(path) {
		adapter, err := s.requireCodocs()
		if err != nil {
			return routeResult{}, err
		}
		return s.routeAppRuntime(r, "codocs", adapter)
	}

	if isFinanceMutation(r.Method, path) {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "finance", Scope: "finance.write"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireFinance()
		if err != nil {
			return routeResult{}, err
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		result, operation, err := adapter.HandleMutation(r.Context(), r.Method, path, body)
		if operation == "" {
			operation = "finance.mutation"
		}
		return routeResult{Operation: operation, Auth: &authCtx, Body: result}, err
	}

	if r.Method == http.MethodGet && path == "/v1/finance/dashboard/summary" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "finance", Scope: "finance.dashboard.read"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireFinance()
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.DashboardSummary(r.Context(), r.URL.Query())
		return routeResult{Operation: "finance.dashboard.summary", Auth: &authCtx, Body: body}, err
	}

	if r.Method == http.MethodGet && path == "/v1/finance/contracts/summaries" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "finance", Scope: "finance.contracts.read"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireFinance()
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.ContractSummaries(r.Context(), r.URL.Query())
		return routeResult{Operation: "finance.contracts.summaries", Auth: &authCtx, Body: body}, err
	}

	if r.Method == http.MethodGet && path == "/v1/finance/bank-accounts" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "finance", Scope: "finance.bank_accounts.read"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireFinance()
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.BankAccounts(r.Context(), r.URL.Query())
		return routeResult{Operation: "finance.bank_accounts.list", Auth: &authCtx, Body: body}, err
	}

	if r.Method == http.MethodGet && path == "/v1/finance/bank-accounts/balances" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "finance", Scope: "finance.bank_accounts.read"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireFinance()
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.BankAccountBalances(r.Context(), r.URL.Query())
		return routeResult{Operation: "finance.bank_accounts.balances", Auth: &authCtx, Body: body}, err
	}

	if r.Method == http.MethodGet && path == "/v1/finance/bank-accounts/balance-changes" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "finance", Scope: "finance.bank_accounts.read"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireFinance()
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.BankAccountBalanceChanges(r.Context(), r.URL.Query())
		return routeResult{Operation: "finance.bank_accounts.balance_changes", Auth: &authCtx, Body: body}, err
	}

	if r.Method == http.MethodGet && strings.HasPrefix(path, "/v1/finance/bank-accounts/") && strings.HasSuffix(path, "/balance-snapshots") {
		code := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/finance/bank-accounts/"), "/balance-snapshots")
		if code == "" || strings.Contains(code, "/") {
			return routeResult{}, httperror.New(http.StatusNotFound, "not_found", "Route not found")
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "finance", Scope: "finance.bank_accounts.read"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireFinance()
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.BankAccountBalanceSnapshots(r.Context(), code, r.URL.Query())
		return routeResult{Operation: "finance.bank_accounts.balance_snapshots", Auth: &authCtx, Body: body}, err
	}

	if r.Method == http.MethodGet && strings.HasPrefix(path, "/v1/finance/contracts/") && strings.HasSuffix(path, "/summary") {
		contractCode := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/finance/contracts/"), "/summary")
		if contractCode == "" || strings.Contains(contractCode, "/") {
			return routeResult{}, httperror.New(http.StatusNotFound, "not_found", "Route not found")
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "finance", Scope: "finance.contracts.read"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireFinance()
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.ContractSummaryWithQuery(r.Context(), contractCode, r.URL.Query())
		return routeResult{Operation: "finance.contracts.summary", Auth: &authCtx, Body: body}, err
	}

	if r.Method == http.MethodGet && strings.HasPrefix(path, "/v1/finance/service/customers/") && strings.HasSuffix(path, "/maintenance-financial-summary") {
		customerCode := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/finance/service/customers/"), "/maintenance-financial-summary")
		if customerCode == "" || strings.Contains(customerCode, "/") {
			return routeResult{}, httperror.New(http.StatusNotFound, "not_found", "Route not found")
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "finance", Scope: "finance.contracts.read"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireFinance()
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.MaintenanceFinancialSummary(r.Context(), customerCode, r.URL.Query())
		return routeResult{Operation: "finance.service.customers.maintenance_financial_summary", Auth: &authCtx, Body: body}, err
	}

	if r.Method == http.MethodGet && path == "/v1/finance/service/people-cost-parameters" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "finance", Scope: "finance.settings.read"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireFinance()
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.PeopleCostParameters(r.Context(), r.URL.Query())
		return routeResult{Operation: "finance.service.people_cost_parameters", Auth: &authCtx, Body: body}, err
	}

	if r.Method == http.MethodGet && path == "/v1/finance/service/performance-amounts" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "finance", Scope: "finance.performance.read"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireFinance()
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.PerformanceAmounts(r.Context(), r.URL.Query())
		return routeResult{Operation: "finance.service.performance_amounts", Auth: &authCtx, Body: body}, err
	}

	if r.Method == http.MethodGet && path == "/v1/finance/reports" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "finance", Scope: "finance.reports.read"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireFinance()
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.MonthlyFinanceReport(r.Context(), r.URL.Query())
		return routeResult{Operation: "finance.reports.monthly", Auth: &authCtx, Body: body}, err
	}

	if r.Method == http.MethodGet && path == "/v1/finance/project-accounting/resolve" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "finance", Scope: "finance.project_accounting.read"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireFinance()
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.ProjectFinanceResolve(r.Context(), r.URL.Query())
		return routeResult{Operation: "finance.project_accounting.resolve", Auth: &authCtx, Body: body}, err
	}

	if r.Method == http.MethodGet && strings.HasPrefix(path, "/v1/finance/project-accounting/") {
		projectCode := strings.TrimPrefix(path, "/v1/finance/project-accounting/")
		if projectCode == "" || strings.Contains(projectCode, "/") {
			return routeResult{}, httperror.New(http.StatusNotFound, "not_found", "Route not found")
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "finance", Scope: "finance.project_accounting.read"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireFinance()
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.ProjectFinanceDetail(r.Context(), projectCode, r.URL.Query())
		return routeResult{Operation: "finance.project_accounting.detail", Auth: &authCtx, Body: body}, err
	}

	if r.Method == http.MethodGet && path == "/v1/finance/migrations/wizbizdb/status" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "finance", Scope: "finance.migrations.read"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireFinance()
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.MigrationStatus(r.Context())
		return routeResult{Operation: "finance.migrations.wizbizdb.status", Auth: &authCtx, Body: body}, err
	}

	if r.Method == http.MethodGet {
		if spec, ok := finance.ListResourceSpecForPath(path); ok {
			authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "finance", Scope: spec.Scope})
			if err != nil {
				return routeResult{}, err
			}
			adapter, err := s.requireFinance()
			if err != nil {
				return routeResult{}, err
			}
			body, err := adapter.ListResource(r.Context(), spec, r.URL.Query())
			return routeResult{Operation: spec.Operation, Auth: &authCtx, Body: body}, err
		}

		if spec, code, ok := finance.MatchDetailResource(path); ok {
			authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "finance", Scope: spec.Scope})
			if err != nil {
				return routeResult{}, err
			}
			adapter, err := s.requireFinance()
			if err != nil {
				return routeResult{}, err
			}
			body, err := adapter.GetRecordByCode(r.Context(), spec, code, r.URL.Query())
			return routeResult{Operation: spec.Operation, Auth: &authCtx, Body: body}, err
		}
	}

	return routeResult{}, httperror.New(http.StatusNotFound, "not_found", "Route not found")
}

func (s *Server) routeAppRuntime(r *http.Request, appCode string, adapter runtimeHandler) (routeResult, error) {
	scope := appCode + ".read"
	if r.Method != http.MethodGet {
		scope = appCode + ".write"
	}
	authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: appCode, Scope: scope})
	if err != nil {
		return routeResult{}, err
	}
	actorUID, deptCodes := runtimeActorContext(r, authCtx)
	query := runtimeQueryWithAuth(r.URL.Query(), authCtx, actorUID, deptCodes)
	body := map[string]any{}
	if r.Method != http.MethodGet {
		body, err = readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		if err := injectRuntimeIdempotencyBody(r, body); err != nil {
			return routeResult{}, err
		}
		injectRuntimeAuthBody(body, authCtx, actorUID, deptCodes)
	}
	result, operation, err := adapter.HandleRuntime(r.Context(), r.Method, cleanPath(r.URL.Path), query, body)
	if operation == "" {
		operation = appCode + ".runtime"
	}
	return routeResult{Operation: operation, Auth: &authCtx, Body: result}, err
}

func runtimeQueryWithAuth(source url.Values, authCtx auth.Context, actorUID string, deptCodes []string) url.Values {
	query := make(url.Values, len(source)+1)
	for key, values := range source {
		if runtimeAuthContextKey(key) {
			continue
		}
		query[key] = append([]string(nil), values...)
	}
	actorUID = strings.TrimSpace(actorUID)
	if actorUID != "" {
		query.Set("current_user", actorUID)
		query.Set("operator_uid", actorUID)
	}
	scopes := runtimeAuthScopes(authCtx)
	if len(scopes) > 0 {
		query.Set("current_user_scopes", strings.Join(scopes, " "))
	}
	setRuntimeDeptQuery(query, deptCodes)
	return query
}

func injectRuntimeAuthBody(body map[string]any, authCtx auth.Context, actorUID string, deptCodes []string) {
	if body == nil {
		return
	}
	for key := range body {
		if runtimeBodyAuthContextKey(key) {
			delete(body, key)
		}
	}
	actorUID = strings.TrimSpace(actorUID)
	if actorUID != "" {
		body["current_user"] = actorUID
		body["operator_uid"] = actorUID
	}
	if scopes := runtimeAuthScopes(authCtx); len(scopes) > 0 {
		body["current_user_scopes"] = scopes
	}
	setRuntimeDeptBody(body, deptCodes)
}

func injectRuntimeIdempotencyBody(r *http.Request, body map[string]any) error {
	if body == nil {
		return nil
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" {
		return nil
	}
	if existing := runtimeBodyText(body, "idempotency_key", "idempotencyKey"); existing != "" && existing != key {
		return httperror.New(http.StatusConflict, "idempotency_key_conflict", "Idempotency-Key header conflicts with request body")
	}
	body["idempotency_key"] = key
	return nil
}

func runtimeBodyText(body map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text != "" && text != "<nil>" {
			return text
		}
	}
	return ""
}

func runtimeActorContext(r *http.Request, authCtx auth.Context) (string, []string) {
	if actorUID, deptCodes, ok := runtimeSignedActorContext(r); ok {
		return actorUID, deptCodes
	}
	return strings.TrimSpace(authCtx.Subject), nil
}

func runtimeSignedActorContext(r *http.Request) (string, []string, bool) {
	actorUID := strings.TrimSpace(r.Header.Get("X-HZY-Actor-Uid"))
	signedAt := strings.TrimSpace(r.Header.Get("X-HZY-Actor-Signed-At"))
	signature := strings.TrimSpace(r.Header.Get("X-HZY-Actor-Signature"))
	token := runtimeBearerToken(r)
	if actorUID == "" || signedAt == "" || signature == "" || token == "" {
		return "", nil, false
	}
	if !runtimeActorSignedAtValid(signedAt) {
		return "", nil, false
	}
	deptCodes := runtimeHeaderDeptCodes(r)
	payload := strings.Join([]string{
		r.Method,
		r.URL.RequestURI(),
		actorUID,
		strings.Join(deptCodes, ","),
		signedAt,
	}, "\n")
	mac := hmac.New(sha256.New, []byte(token))
	_, _ = mac.Write([]byte(payload))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(signature), []byte(expected)) {
		return "", nil, false
	}
	return actorUID, deptCodes, true
}

func runtimeBearerToken(r *http.Request) string {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(header) < 8 || !strings.EqualFold(header[:7], "Bearer ") {
		return ""
	}
	return strings.TrimSpace(header[7:])
}

func runtimeActorSignedAtValid(value string) bool {
	signedAt, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return false
	}
	now := timeNow().UnixNano() / int64(time.Millisecond)
	if signedAt > now {
		return signedAt-now <= int64(5*time.Minute/time.Millisecond)
	}
	return now-signedAt <= int64(5*time.Minute/time.Millisecond)
}

func runtimeHeaderDeptCodes(r *http.Request) []string {
	values := make([]string, 0)
	values = append(values, splitRuntimeCodes(r.Header.Values("X-HZY-Actor-Dept-Codes"))...)
	values = append(values, splitRuntimeCodes(r.Header.Values("X-HZY-Actor-Dept-Code"))...)
	return uniqueRuntimeStrings(values)
}

func splitRuntimeCodes(values []string) []string {
	result := make([]string, 0)
	for _, value := range values {
		for _, part := range strings.FieldsFunc(value, func(r rune) bool {
			return r == ',' || r == ';' || r == ' ' || r == '\t' || r == '\n' || r == '\r'
		}) {
			if part = strings.TrimSpace(part); part != "" {
				result = append(result, part)
			}
		}
	}
	return result
}

func uniqueRuntimeStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func setRuntimeDeptQuery(query url.Values, deptCodes []string) {
	deptCodes = uniqueRuntimeStrings(deptCodes)
	if len(deptCodes) == 0 {
		return
	}
	joined := strings.Join(deptCodes, ",")
	query.Set("current_user_dept_code", deptCodes[0])
	query.Set("current_user_dept_codes", joined)
	query.Set("current_user_department_code", deptCodes[0])
	query.Set("current_user_department_codes", joined)
}

func setRuntimeDeptBody(body map[string]any, deptCodes []string) {
	deptCodes = uniqueRuntimeStrings(deptCodes)
	if len(deptCodes) == 0 {
		return
	}
	joined := strings.Join(deptCodes, ",")
	body["current_user_dept_code"] = deptCodes[0]
	body["current_user_dept_codes"] = joined
	body["current_user_department_code"] = deptCodes[0]
	body["current_user_department_codes"] = joined
}

func runtimeAuthContextKey(key string) bool {
	switch key {
	case "current_user",
		"currentUser",
		"operator_uid",
		"operatorUid",
		"current_user_scopes",
		"currentUserScopes",
		"current_user_dept_code",
		"currentUserDeptCode",
		"current_user_dept_codes",
		"currentUserDeptCodes",
		"current_user_department_code",
		"currentUserDepartmentCode",
		"current_user_department_codes",
		"currentUserDepartmentCodes":
		return true
	default:
		return false
	}
}

func runtimeBodyAuthContextKey(key string) bool {
	if runtimeAuthContextKey(key) {
		return true
	}
	switch key {
	case "current_user_data_access",
		"currentUserDataAccess",
		"current_user_data_dept_code",
		"currentUserDataDeptCode",
		"current_user_data_dept_codes",
		"currentUserDataDeptCodes",
		"current_user_altoc_access",
		"currentUserAltocAccess",
		"current_user_altoc_dept_code",
		"currentUserAltocDeptCode",
		"current_user_altoc_dept_codes",
		"currentUserAltocDeptCodes":
		return true
	default:
		return false
	}
}

func runtimeAuthScopes(authCtx auth.Context) []string {
	scopes := append([]string(nil), authCtx.Scopes...)
	if authCtx.Mode == string(config.AuthDisabled) || authCtx.Mode == string(config.AuthStaticToken) {
		adminScope := strings.TrimSpace(authCtx.AppCode) + ".admin"
		if strings.TrimSpace(authCtx.AppCode) != "" && !stringInSlice(scopes, adminScope) {
			scopes = append(scopes, adminScope)
		}
	}
	return scopes
}

func stringInSlice(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func (s *Server) requireFinance() (*finance.Adapter, error) {
	if s.finance == nil {
		return nil, httperror.New(http.StatusNotFound, "finance_adapter_disabled", "Finance adapter is disabled")
	}
	return s.finance, nil
}

func (s *Server) requireWorkflow() (*workflow.Adapter, error) {
	if s.workflow == nil {
		return nil, httperror.New(http.StatusNotFound, "workflow_adapter_disabled", "Workflow adapter is disabled")
	}
	return s.workflow, nil
}

func (s *Server) requireWebDev() (*webdev.Adapter, error) {
	if s.webdev == nil {
		return nil, httperror.New(http.StatusNotFound, "webdev_adapter_disabled", "WebDev adapter is disabled")
	}
	return s.webdev, nil
}

func (s *Server) requireAssets() (*assetsapp.Adapter, error) {
	if s.assets == nil {
		return nil, httperror.New(http.StatusNotFound, "assets_adapter_disabled", "Assets adapter is disabled")
	}
	return s.assets, nil
}

func (s *Server) requirePeople() (*peopleapp.Adapter, error) {
	if s.people == nil {
		return nil, httperror.New(http.StatusNotFound, "people_adapter_disabled", "People adapter is disabled")
	}
	return s.people, nil
}

func (s *Server) requireAltoc() (*altocapp.Adapter, error) {
	if s.altoc == nil {
		return nil, httperror.New(http.StatusNotFound, "altoc_adapter_disabled", "Altoc adapter is disabled")
	}
	return s.altoc, nil
}

func (s *Server) requireAims() (*aimsapp.Adapter, error) {
	if s.aims == nil {
		return nil, httperror.New(http.StatusNotFound, "aims_adapter_disabled", "Aims adapter is disabled")
	}
	return s.aims, nil
}

func (s *Server) requireCodocs() (*codocsapp.Adapter, error) {
	if s.codocs == nil {
		return nil, httperror.New(http.StatusNotFound, "codocs_adapter_disabled", "Codocs adapter is disabled")
	}
	return s.codocs, nil
}

func (s *Server) schemaStatus(ctx context.Context, app string) (any, error) {
	switch app {
	case "finance":
		adapter, err := s.requireFinance()
		if err != nil {
			return nil, err
		}
		return adapter.SchemaStatus(ctx)
	case "workflow":
		adapter, err := s.requireWorkflow()
		if err != nil {
			return nil, err
		}
		return adapter.SchemaStatus(ctx)
	case "webdev":
		adapter, err := s.requireWebDev()
		if err != nil {
			return nil, err
		}
		return adapter.SchemaStatus(ctx)
	case "assets":
		adapter, err := s.requireAssets()
		if err != nil {
			return nil, err
		}
		return adapter.SchemaStatus(ctx)
	case "people":
		adapter, err := s.requirePeople()
		if err != nil {
			return nil, err
		}
		return adapter.SchemaStatus(ctx)
	case "altoc":
		adapter, err := s.requireAltoc()
		if err != nil {
			return nil, err
		}
		return adapter.SchemaStatus(ctx)
	case "aims":
		adapter, err := s.requireAims()
		if err != nil {
			return nil, err
		}
		return adapter.SchemaStatus(ctx)
	case "codocs":
		adapter, err := s.requireCodocs()
		if err != nil {
			return nil, err
		}
		return adapter.SchemaStatus(ctx)
	default:
		return nil, httperror.New(http.StatusNotFound, "app_not_supported", "Unsupported schema status app")
	}
}

func (s *Server) runtimeHealth(ctx context.Context) map[string]any {
	apps := map[string]any{}
	apps["finance"] = appHealth(ctx, s.finance != nil, s.finance)
	apps["workflow"] = appHealth(ctx, s.workflow != nil, s.workflow)
	apps["webdev"] = appHealth(ctx, s.webdev != nil, s.webdev)
	apps["assets"] = appHealth(ctx, s.assets != nil, s.assets)
	apps["people"] = appHealth(ctx, s.people != nil, s.people)
	apps["altoc"] = appHealth(ctx, s.altoc != nil, s.altoc)
	apps["aims"] = appHealth(ctx, s.aims != nil, s.aims)
	apps["codocs"] = appHealth(ctx, s.codocs != nil, s.codocs)

	return map[string]any{
		"status":     "ok",
		"version":    version.Version,
		"commit":     version.Commit,
		"builtAt":    version.BuiltAt,
		"tenant":     s.cfg.Tenant,
		"deployment": s.cfg.Deployment,
		"apps":       apps,
	}
}

func (s *Server) triggerUpdate(body map[string]any) (map[string]any, error) {
	baseURL := firstNonEmptyText(body["baseUrl"], os.Getenv("HZY_DATA_RUNTIME_DOWNLOAD_BASE_URL"), updater.DefaultBaseURL)
	targetVersion := firstNonEmptyText(body["targetVersion"], body["version"], os.Getenv("HZY_DATA_RUNTIME_UPDATE_VERSION"), os.Getenv("HZY_DATA_RUNTIME_VERSION"), "latest")
	installDir := firstNonEmptyText(body["installDir"], os.Getenv("HZY_DATA_RUNTIME_INSTALL_DIR"), "/opt/hzy-data-runtime")
	serviceName := firstNonEmptyText(body["serviceName"], os.Getenv("HZY_DATA_RUNTIME_SERVICE_NAME"), "hzy-data-runtime")
	force := boolValue(body["force"])
	restartService := !boolValue(body["noRestart"])
	triggeredAt := time.Now().UTC().Format(time.RFC3339)

	if os.Geteuid() != 0 {
		if err := writeSystemdUpdateRequest(baseURL, targetVersion, installDir, serviceName, force, restartService); err != nil {
			return nil, err
		}
		status := map[string]any{
			"status":        "queued",
			"targetVersion": targetVersion,
			"baseUrl":       baseURL,
			"serviceName":   serviceName,
			"restart":       restartService,
			"force":         force,
			"triggeredAt":   triggeredAt,
			"startedAt":     triggeredAt,
			"result": map[string]any{
				"mode": "systemd-request",
				"path": updateRequestPath(),
			},
		}
		s.updateMu.Lock()
		s.updateStatus = status
		s.updateMu.Unlock()
		return copyMap(status), nil
	}

	s.updateMu.Lock()
	if s.updateInFlight {
		s.updateMu.Unlock()
		return nil, httperror.New(http.StatusConflict, "runtime_update_in_progress", "Runtime update is already in progress")
	}
	s.updateInFlight = true
	s.updateStatus = map[string]any{
		"status":        "running",
		"targetVersion": targetVersion,
		"baseUrl":       baseURL,
		"serviceName":   serviceName,
		"restart":       restartService,
		"force":         force,
		"triggeredAt":   triggeredAt,
		"startedAt":     triggeredAt,
	}
	accepted := copyMap(s.updateStatus)
	s.updateMu.Unlock()

	go func() {
		defer func() {
			s.updateMu.Lock()
			s.updateInFlight = false
			s.updateMu.Unlock()
		}()

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()

		result, err := updater.Run(ctx, updater.Options{
			BaseURL:        baseURL,
			TargetVersion:  targetVersion,
			InstallDir:     installDir,
			ServiceName:    serviceName,
			Force:          force,
			RestartService: restartService,
		})
		if err != nil {
			log.Printf("[runtime.update] failed target=%s baseUrl=%s: %v", targetVersion, baseURL, err)
			s.finishRuntimeUpdate("failed", map[string]any{
				"error": err.Error(),
			})
			return
		}
		resultBody := map[string]any{
			"currentVersion":   result.CurrentVersion,
			"availableVersion": result.AvailableVersion,
			"archiveUrl":       result.ArchiveURL,
			"updated":          result.Updated,
			"restarted":        result.Restarted,
		}
		if result.Updated {
			log.Printf("[runtime.update] updated current=%s available=%s restarted=%t archive=%s", result.CurrentVersion, result.AvailableVersion, result.Restarted, result.ArchiveURL)
			s.finishRuntimeUpdate("succeeded", map[string]any{
				"result": resultBody,
			})
			return
		}
		log.Printf("[runtime.update] already up to date current=%s available=%s", result.CurrentVersion, result.AvailableVersion)
		s.finishRuntimeUpdate("succeeded", map[string]any{
			"result": resultBody,
		})
	}()

	return accepted, nil
}

func writeSystemdUpdateRequest(baseURL string, targetVersion string, installDir string, serviceName string, force bool, restartService bool) error {
	path := updateRequestPath()
	if err := os.MkdirAll(filepath.Dir(path), 0750); err != nil {
		return httperror.New(http.StatusInternalServerError, "runtime_update_request_failed", "Failed to prepare update request directory: "+err.Error())
	}

	lines := []string{
		"HZY_DATA_RUNTIME_DOWNLOAD_BASE_URL=" + strconv.Quote(baseURL),
		"HZY_DATA_RUNTIME_UPDATE_VERSION=" + strconv.Quote(targetVersion),
		"HZY_DATA_RUNTIME_INSTALL_DIR=" + strconv.Quote(installDir),
		"HZY_DATA_RUNTIME_SERVICE_NAME=" + strconv.Quote(serviceName),
	}
	if force {
		lines = append(lines, "HZY_DATA_RUNTIME_FORCE=1")
	}
	if !restartService {
		lines = append(lines, "HZY_DATA_RUNTIME_NO_RESTART=1")
	}
	content := strings.Join(lines, "\n") + "\n"
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		return httperror.New(http.StatusInternalServerError, "runtime_update_request_failed", "Failed to write update request: "+err.Error())
	}
	return nil
}

func updateRequestPath() string {
	configDir := firstNonEmptyText(os.Getenv("HZY_DATA_RUNTIME_CONFIG_DIR"), "/etc/hzy-data-runtime")
	return filepath.Join(configDir, "update-request.env")
}

func (s *Server) runtimeUpdateStatus() map[string]any {
	s.updateMu.Lock()
	defer s.updateMu.Unlock()
	if s.updateStatus == nil {
		return map[string]any{
			"status":    "idle",
			"running":   false,
			"checkedAt": time.Now().UTC().Format(time.RFC3339),
		}
	}
	status := copyMap(s.updateStatus)
	status["running"] = s.updateInFlight
	status["checkedAt"] = time.Now().UTC().Format(time.RFC3339)
	return status
}

func (s *Server) finishRuntimeUpdate(status string, fields map[string]any) {
	s.updateMu.Lock()
	defer s.updateMu.Unlock()
	if s.updateStatus == nil {
		s.updateStatus = map[string]any{}
	}
	for key, value := range fields {
		s.updateStatus[key] = value
	}
	s.updateStatus["status"] = status
	s.updateStatus["finishedAt"] = time.Now().UTC().Format(time.RFC3339)
}

func copyMap(input map[string]any) map[string]any {
	return map[string]any{
		"status":        input["status"],
		"targetVersion": input["targetVersion"],
		"baseUrl":       input["baseUrl"],
		"serviceName":   input["serviceName"],
		"restart":       input["restart"],
		"force":         input["force"],
		"triggeredAt":   input["triggeredAt"],
		"startedAt":     input["startedAt"],
		"finishedAt":    input["finishedAt"],
		"error":         input["error"],
		"result":        input["result"],
	}
}

func appHealth(ctx context.Context, enabled bool, adapter pinger) map[string]any {
	if !enabled {
		return map[string]any{"enabled": false}
	}
	if err := adapter.Ping(ctx); err != nil {
		return map[string]any{"enabled": true, "db": "unavailable", "error": err.Error()}
	}
	return map[string]any{"enabled": true, "db": "ok"}
}

func firstNonEmptyText(values ...any) string {
	for _, value := range values {
		text := strings.TrimSpace(stringFromAny(value))
		if text != "" {
			return text
		}
	}
	return ""
}

func stringFromAny(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	default:
		return fmt.Sprint(v)
	}
}

func boolValue(value any) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		normalized := strings.ToLower(strings.TrimSpace(v))
		return normalized == "1" || normalized == "true" || normalized == "yes" || normalized == "on"
	default:
		return false
	}
}

func writeJSON(w http.ResponseWriter, requestID string, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Request-ID", requestID)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, requestID string, err error) (int, string) {
	status := http.StatusInternalServerError
	code := "internal_error"
	message := err.Error()

	var httpErr httperror.Error
	if errors.As(err, &httpErr) {
		status = httpErr.Status
		code = httpErr.Code
		message = httpErr.Message
	}

	body := errorBody{}
	body.Error.Code = code
	body.Error.Message = message
	writeJSON(w, requestID, status, body)
	return status, code
}

func cleanPath(path string) string {
	for len(path) > 1 && path[len(path)-1] == '/' {
		path = path[:len(path)-1]
	}
	if path == "" {
		return "/"
	}
	return path
}

func isFinanceMutation(method string, path string) bool {
	if method != http.MethodPost && method != http.MethodPatch && method != http.MethodDelete {
		return false
	}
	return path == "/v1/finance" || strings.HasPrefix(path, "/v1/finance/")
}

func isWorkflowRuntimePath(path string) bool {
	if path == "/v1/workflow/action-defs/sync" ||
		path == "/v1/workflow/instances/prepare" ||
		path == "/v1/workflow/instances" {
		return false
	}
	return strings.HasPrefix(path, "/v1/workflow/")
}

func isWebDevRuntimePath(path string) bool {
	return strings.HasPrefix(path, "/v1/webdev/")
}

func isAssetsRuntimePath(path string) bool {
	return strings.HasPrefix(path, "/v1/assets/")
}

func isPeopleRuntimePath(path string) bool {
	return strings.HasPrefix(path, "/v1/people/")
}

func isAltocRuntimePath(path string) bool {
	return strings.HasPrefix(path, "/v1/altoc/")
}

func isAimsRuntimePath(path string) bool {
	return strings.HasPrefix(path, "/v1/aims/")
}

func isCodocsRuntimePath(path string) bool {
	return strings.HasPrefix(path, "/v1/codocs/")
}

func readJSONBody(r *http.Request) (map[string]any, error) {
	if r.Body == nil {
		return map[string]any{}, nil
	}
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	if len(strings.TrimSpace(string(body))) == 0 {
		return map[string]any{}, nil
	}
	var data map[string]any
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_json", "Invalid JSON request body")
	}
	return data, nil
}

func requestID(r *http.Request) string {
	if value := r.Header.Get("X-Request-ID"); value != "" {
		return value
	}
	if value := r.Header.Get("X-Correlation-ID"); value != "" {
		return value
	}
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return time.Now().UTC().Format("20060102150405.000000000")
	}
	return hex.EncodeToString(bytes)
}
