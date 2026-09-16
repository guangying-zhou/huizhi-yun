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
	"net"
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
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	directoryapp "github.com/huizhi-yun/data-runtime/internal/apps/directory"
	"github.com/huizhi-yun/data-runtime/internal/apps/finance"
	peopleapp "github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/apps/webdev"
	"github.com/huizhi-yun/data-runtime/internal/apps/workflow"
	"github.com/huizhi-yun/data-runtime/internal/audit"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"github.com/huizhi-yun/data-runtime/internal/updater"
	"github.com/huizhi-yun/data-runtime/internal/version"
)

type Server struct {
	cfg       config.Config
	auth      *auth.Authenticator
	finance   *finance.Adapter
	workflow  *workflow.Adapter
	webdev    *webdev.Adapter
	assets    *assetsapp.Adapter
	people    *peopleapp.Adapter
	altoc     *altocapp.Adapter
	aims      *aimsapp.Adapter
	codocs    *codocsapp.Adapter
	console   *consoleapp.Adapter
	directory *directoryapp.Adapter

	updateMu         sync.Mutex
	updateStatus     map[string]any
	vaultBootstrapMu sync.Mutex
}

var timeNow = time.Now

type routeResult struct {
	Operation string
	Auth      *auth.Context
	Body      any
	Status    int
}

func decodeConsoleDirectoryProjectCode(value string) (string, error) {
	code, err := url.PathUnescape(value)
	if err != nil {
		return "", httperror.New(http.StatusBadRequest, "directory_project_code_invalid", "Project code is invalid")
	}
	code = strings.TrimSpace(code)
	if code == "" || len(code) > 128 || strings.ContainsAny(code, "\r\n\x00") {
		return "", httperror.New(http.StatusBadRequest, "directory_project_code_invalid", "Project code is invalid")
	}
	for _, segment := range strings.Split(code, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return "", httperror.New(http.StatusBadRequest, "directory_project_code_invalid", "Project code is invalid")
		}
	}
	return code, nil
}

type errorBody struct {
	Error struct {
		Code      string         `json:"code"`
		Message   string         `json:"message"`
		Retryable bool           `json:"retryable"`
		RequestID string         `json:"requestId"`
		Details   map[string]any `json:"details"`
	} `json:"error"`
}

func bindOIDCSigningClaimsToRuntime(claims map[string]any, authCtx auth.Context, deploymentBindings map[string]string) error {
	claims["tenant"] = authCtx.Tenant
	requestedDeployment := strings.TrimSpace(fmt.Sprint(claims["deployment"]))
	claims["deployment"] = authCtx.Deployment
	if strings.TrimSpace(fmt.Sprint(claims["token_use"])) != "service" ||
		requestedDeployment == "" ||
		requestedDeployment == authCtx.Deployment {
		return nil
	}

	hzy, ok := claims["hzy"].(map[string]any)
	if !ok {
		return httperror.New(
			http.StatusForbidden,
			"oidc_signing_service_deployment_invalid",
			"service token deployment requires an exact runtime client",
		)
	}
	appCode := strings.TrimSpace(fmt.Sprint(hzy["appCode"]))
	clientCode := strings.TrimSpace(fmt.Sprint(hzy["clientCode"]))
	subjectCode := strings.TrimSpace(fmt.Sprint(hzy["subjectCode"]))
	sourceApp := strings.TrimSpace(fmt.Sprint(claims["source_app"]))
	canonicalDeployment := authCtx.Tenant + "-" + appCode
	// Enrolled runtimes use exact per-app bindings, including non-production
	// deployment names. Never fall back to a production-shaped name when an
	// explicit binding map exists but does not contain the requested app.
	if len(deploymentBindings) > 0 {
		canonicalDeployment = strings.TrimSpace(deploymentBindings[appCode])
	}
	if appCode == "" ||
		canonicalDeployment == "" ||
		clientCode != appCode+".runtime" ||
		subjectCode != clientCode ||
		sourceApp != appCode ||
		requestedDeployment != canonicalDeployment {
		return httperror.New(
			http.StatusForbidden,
			"oidc_signing_service_deployment_invalid",
			"service token deployment requires an exact runtime client",
		)
	}

	claims["deployment"] = canonicalDeployment
	return nil
}

type runtimeHandler interface {
	HandleRuntime(context.Context, string, string, url.Values, map[string]any) (any, string, error)
}

type pinger interface {
	Ping(context.Context) error
}

func New(cfg config.Config) (*Server, error) {
	var consoleAdapter *consoleapp.Adapter
	if cfg.Apps.Console.Enabled {
		adapter, err := consoleapp.New(cfg.Apps.Console, cfg.Tenant)
		if err != nil {
			return nil, err
		}
		consoleAdapter = adapter
	}

	var directoryAdapter *directoryapp.Adapter
	if cfg.Apps.Directory.Enabled {
		if consoleAdapter != nil {
			if cfg.Apps.Console.DB != cfg.Apps.Directory.DB {
				_ = consoleAdapter.Close()
				return nil, httperror.New(
					http.StatusInternalServerError,
					"console_directory_db_config_mismatch",
					"Console and Directory runtimes must share one hzy_console database configuration",
				)
			}
			directoryAdapter = directoryapp.NewWithDB(
				consoleAdapter.DB(),
				cfg.Tenant,
				cfg.Control.PlatformURL,
				cfg.Auth.StaticToken,
			)
		} else {
			adapter, err := directoryapp.New(
				cfg.Apps.Directory,
				cfg.Tenant,
				cfg.Control.PlatformURL,
				cfg.Auth.StaticToken,
			)
			if err != nil {
				return nil, err
			}
			directoryAdapter = adapter
		}
	}

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
		cfg:       cfg,
		auth:      auth.New(cfg),
		finance:   financeAdapter,
		workflow:  workflowAdapter,
		webdev:    webdevAdapter,
		assets:    assetsAdapter,
		people:    peopleAdapter,
		altoc:     altocAdapter,
		aims:      aimsAdapter,
		codocs:    codocsAdapter,
		console:   consoleAdapter,
		directory: directoryAdapter,
	}, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	requestID := requestID(r)
	if strings.TrimSpace(r.Header.Get("X-Request-ID")) == "" {
		r.Header.Set("X-Request-ID", requestID)
	}
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

func (s *Server) consoleCutoverDeployment() string {
	return s.cfg.DeploymentForApp("console")
}

func (s *Server) route(r *http.Request) (routeResult, error) {
	path := cleanPath(r.URL.Path)

	if r.Method == http.MethodGet && (path == "/runtime/health" || path == "/runtime/healthz") {
		return routeResult{
			Operation: "runtime.health",
			Body:      s.runtimeHealth(r.Context()),
		}, nil
	}

	if r.Method == http.MethodPost && path == "/runtime/bootstrap/console-vault-master-key" {
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		result, err := s.bootstrapConsoleVaultMasterKey(body)
		return routeResult{
			Operation: "runtime.bootstrap.console_vault_master_key",
			Body:      result,
		}, err
	}

	if r.Method == http.MethodPost && path == "/runtime/bootstrap/console-oidc-signing-key" {
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		result, err := s.bootstrapConsoleOIDCSigningKey(r.Context(), body)
		return routeResult{
			Operation: "runtime.bootstrap.console_oidc_signing_key",
			Body:      result,
		}, err
	}

	if r.Method == http.MethodPost && path == "/runtime/internal/connector-runtime/people-sync-batches" {
		if !isLoopbackRemote(r.RemoteAddr) {
			return routeResult{}, httperror.New(http.StatusForbidden, "connector_runtime_loopback_required", "Connector Runtime People batches require a loopback connection")
		}
		if s.directory == nil || s.people == nil {
			return routeResult{}, httperror.New(http.StatusNotFound, "connector_people_sync_disabled", "Directory and People runtimes must both be enabled")
		}
		body, rawBody, err := readJSONBodyWithRaw(r)
		if err != nil {
			return routeResult{}, err
		}
		identity, err := s.directory.AuthenticateConnectorRuntimeRequest(r.Context(), r, rawBody)
		if err != nil {
			return routeResult{}, err
		}
		if _, err = s.directory.ApplyDingTalkDepartmentBatch(r.Context(), body); err != nil {
			return routeResult{}, err
		}
		snapshotResult, err := s.directory.FinalizeDingTalkDepartmentSnapshot(r.Context(), body, identity.ConnectorID)
		if err != nil {
			return routeResult{}, err
		}
		items, candidates, skipped, err := s.directory.ResolveDingTalkPeopleBatch(r.Context(), body)
		if err != nil {
			return routeResult{}, err
		}
		// 候选与正式条目在同一批次里分开传递：候选只能落成 People 入职单，
		// 不得进入 people_employees 或冻结生命周期。
		result, err := s.people.ApplyConnectorPeopleBatch(r.Context(), body, items, candidates, skipped, integrationoperation.TrustedContext{
			TenantCode:      identity.TenantCode,
			DeploymentCode:  s.cfg.DeploymentForApp("people"),
			SourceApp:       "people",
			ServiceClientID: "client:people.runtime",
			RequestID:       strings.TrimSpace(fmt.Sprint(body["jobId"])),
		})
		if err == nil && snapshotResult["handled"] == true {
			result["organizationSnapshot"] = snapshotResult
		}
		return routeResult{Operation: "people.connector_sync.apply", Body: result, Auth: &auth.Context{Tenant: identity.TenantCode, Deployment: identity.DeploymentCode, AppCode: "connector-runtime", Subject: identity.ConnectorID, Mode: "connector-signature"}}, err
	}

	if r.Method == http.MethodPost && strings.HasPrefix(path, "/runtime/internal/directory-connector/") {
		if !isLoopbackRemote(r.RemoteAddr) {
			return routeResult{}, httperror.New(http.StatusForbidden, "directory_runtime_loopback_required", "Directory Runtime internal routes require a loopback connection")
		}
		if s.directory == nil {
			return routeResult{}, httperror.New(http.StatusNotFound, "directory_runtime_disabled", "Directory Runtime is disabled")
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		identity, err := s.directory.AuthenticateRequest(r.Context(), r, body)
		if err != nil {
			return routeResult{}, err
		}
		if path == "/runtime/internal/directory-connector/configuration" {
			adapter, adapterErr := s.requireConsole()
			if adapterErr != nil {
				return routeResult{}, adapterErr
			}
			response, configErr := adapter.DirectoryConnectorConfiguration(
				r.Context(), identity.ConnectorID, identity.TenantCode, identity.DeploymentCode,
			)
			return routeResult{
				Operation: "directory.connector.configuration",
				Auth: &auth.Context{
					Tenant: identity.TenantCode, Deployment: identity.DeploymentCode,
					AppCode: "directory-connector", Subject: identity.ConnectorID,
					Mode: "connector-signature",
				},
				Body: response,
			}, configErr
		}
		response, operation, err := s.directory.Handle(r.Context(), r.Method, path, identity, body)
		return routeResult{Operation: operation, Body: response}, err
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
		result, err := s.triggerUpdate(body, requestID(r))
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

	if r.Method == http.MethodPost && path == "/v1/console/directory-connectors/enroll" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: "console:directory-connector:enroll",
			SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		if s.directory == nil {
			return routeResult{}, httperror.New(http.StatusServiceUnavailable, "directory_runtime_not_ready", "Directory Runtime is not ready")
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		result, err := s.directory.RedeemConnectorEnrollment(
			r.Context(), body, s.cfg.Tenant, s.cfg.DeploymentForApp("console"),
			s.cfg.Control.PlatformSigningKeyID, s.cfg.Control.PlatformSigningPublicKey,
		)
		if err == nil {
			result = map[string]any{"code": 0, "data": result}
		}
		return routeResult{
			Operation: "console.directory.connector.enroll",
			Auth:      &authCtx,
			Body:      result,
		}, err
	}

	if r.Method == http.MethodPost &&
		(path == "/v1/console/auth/external-login-transactions" ||
			path == "/v1/console/auth/external-login-transactions/consume") {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode:       "console",
			Scope:         "console:auth-external-login:write",
			SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		operation := "console.auth.external_login.issue"
		var result map[string]any
		if strings.HasSuffix(path, "/consume") {
			operation = "console.auth.external_login.consume"
			result, err = adapter.ConsumeExternalLoginTransaction(
				r.Context(), body, authCtx.Deployment,
			)
		} else {
			result, err = adapter.IssueExternalLoginTransaction(
				r.Context(), body, authCtx.Deployment,
			)
		}
		if err == nil {
			result = map[string]any{"code": 0, "data": result}
		}
		return routeResult{
			Operation: operation,
			Auth:      &authCtx,
			Body:      result,
		}, err
	}

	if r.Method == http.MethodPost &&
		(path == "/v1/console/auth/sessions" ||
			path == "/v1/console/auth/sessions/resolve" ||
			path == "/v1/console/auth/sessions/revoke") {
		scope := "console:auth-session:write"
		operation := "console.auth.session.issue"
		if strings.HasSuffix(path, "/resolve") {
			scope = "console:auth-session:read"
			operation = "console.auth.session.resolve"
		} else if strings.HasSuffix(path, "/revoke") {
			operation = "console.auth.session.revoke"
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode:       "console",
			Scope:         scope,
			SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		var result map[string]any
		switch path {
		case "/v1/console/auth/sessions":
			result, err = adapter.IssueAuthSession(r.Context(), body, consoleapp.AuditMutationMeta{
				IdempotencyKey: r.Header.Get("Idempotency-Key"),
				RequestID:      requestID(r),
				ActorType:      "service",
				ActorID:        authCtx.Subject,
				SourceApp:      authCtx.AppCode,
			})
		case "/v1/console/auth/sessions/resolve":
			result, err = adapter.ResolveAuthSession(r.Context(), body)
		default:
			result, err = adapter.RevokeAuthSession(r.Context(), body, consoleapp.AuditMutationMeta{
				IdempotencyKey: r.Header.Get("Idempotency-Key"),
				RequestID:      requestID(r),
				ActorType:      "service",
				ActorID:        authCtx.Subject,
				SourceApp:      authCtx.AppCode,
			})
		}
		if err == nil {
			result = map[string]any{"code": 0, "data": result}
		}
		return routeResult{
			Operation: operation,
			Auth:      &authCtx,
			Body:      result,
		}, err
	}

	if r.Method == http.MethodPost && path == "/v1/console/auth/identities/resolve-or-bind" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode:       "console",
			Scope:         "console:auth-identity:write",
			SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		result, err := adapter.ResolveOrBindAuthIdentity(r.Context(), body, consoleapp.AuditMutationMeta{
			IdempotencyKey: r.Header.Get("Idempotency-Key"),
			RequestID:      requestID(r),
			ActorType:      "service",
			ActorID:        authCtx.Subject,
			SourceApp:      authCtx.AppCode,
		})
		if err == nil {
			result = map[string]any{"code": 0, "data": result}
		}
		return routeResult{
			Operation: "console.auth.identity.resolve_or_bind",
			Auth:      &authCtx,
			Body:      result,
		}, err
	}

	if (r.Method == http.MethodGet && path == "/v1/console/auth/health-summary") ||
		(r.Method == http.MethodPost && path == "/v1/console/auth/clients/materialize") {
		scope := "console:auth-health:view"
		operation := "console.auth.health.read"
		if r.Method == http.MethodPost {
			scope = "console:auth-client:sync"
			operation = "console.auth.clients.materialize"
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode:       "console",
			Scope:         scope,
			SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		var result map[string]any
		if r.Method == http.MethodGet {
			result, err = adapter.AuthRuntimeHealthSummary(r.Context())
		} else {
			body, bodyErr := readJSONBody(r)
			if bodyErr != nil {
				return routeResult{}, bodyErr
			}
			result, err = adapter.MaterializeAuthClients(r.Context(), body, consoleapp.AuditMutationMeta{
				IdempotencyKey: r.Header.Get("Idempotency-Key"),
				RequestID:      requestID(r),
				ActorType:      "service",
				ActorID:        authCtx.Subject,
				SourceApp:      authCtx.AppCode,
			})
		}
		if err == nil {
			result = map[string]any{"code": 0, "data": result}
		}
		return routeResult{Operation: operation, Auth: &authCtx, Body: result}, err
	}

	if path == "/v1/console/policy-bundle" && (r.Method == http.MethodGet || r.Method == http.MethodPut) {
		scope := "console:policy-bundle:read"
		if r.Method == http.MethodPut {
			scope = "console:policy-bundle:write"
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "console", SourceAppCode: "console", Scope: scope, StrictServiceClaims: true})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		if authCtx.Mode == string(config.AuthJWT) {
			state, stateErr := adapter.VerifyOIDCServiceTokenState(r.Context(), map[string]any{"clientId": authCtx.ClientID, "credentialId": authCtx.CredentialID, "scope": scope})
			if stateErr != nil {
				return routeResult{}, stateErr
			}
			if state["active"] != true {
				return routeResult{}, httperror.New(403, "console_policy_credential_inactive", "Policy storage credential or grant inactive")
			}
		}
		var result map[string]any
		if r.Method == http.MethodGet {
			result, err = adapter.ReadPolicyBundle(r.Context(), authCtx.Tenant, authCtx.Deployment, r.URL.Query().Get("key"))
		} else {
			// Policy snapshots can exceed the ordinary 1 MiB business-command
			// budget; keep this exception bounded and exclusive to this endpoint.
			body, _, bodyErr := readJSONBodyWithRawLimit(r, 8<<20)
			if bodyErr != nil {
				return routeResult{}, bodyErr
			}
			result, err = adapter.WritePolicyBundle(r.Context(), authCtx.Tenant, authCtx.Deployment, body, r.Header.Get("Idempotency-Key"))
		}
		return routeResult{Operation: scope, Auth: &authCtx, Body: map[string]any{"code": 0, "data": result}}, err
	}

	// JWKS is public OIDC discovery material. Requiring a JWT here creates a
	// circular dependency because JWT verification itself must load these keys.
	if r.Method == http.MethodGet && path == "/v1/console/auth/oidc/jwks" {
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		result, err := adapter.OIDCPublishedJWKS(r.Context())
		if err == nil {
			result = map[string]any{"code": 0, "data": result}
		}
		return routeResult{
			Operation: "console.auth.oidc.jwks.read",
			Body:      result,
		}, err
	}

	if r.Method == http.MethodPost &&
		(path == "/v1/console/auth/oidc/clients/resolve" ||
			path == "/v1/console/auth/oidc/authorization-codes" ||
			path == "/v1/console/auth/oidc/authorization-codes/consume" ||
			path == "/v1/console/auth/oidc/refresh-tokens" ||
			path == "/v1/console/auth/oidc/refresh-tokens/consume" ||
			path == "/v1/console/auth/oidc/refresh-tokens/revoke" ||
			path == "/v1/console/auth/oidc/token-events" ||
			path == "/v1/console/auth/oidc/sign" ||
			path == "/v1/console/auth/oidc/service-token-state") {
		scope := "console:auth-oidc:read"
		operation := "console.auth.oidc.token_event.append"
		if path == "/v1/console/auth/oidc/clients/resolve" {
			operation = "console.auth.oidc.client.resolve"
		} else if path == "/v1/console/auth/oidc/service-token-state" {
			operation = "console.auth.oidc.service_token_state.verify"
		} else if path == "/v1/console/auth/oidc/sign" {
			scope = "console:auth-oidc:sign"
			operation = "console.auth.oidc.token.sign"
		} else {
			scope = "console:auth-oidc:write"
			switch path {
			case "/v1/console/auth/oidc/authorization-codes":
				operation = "console.auth.oidc.authorization_code.issue"
			case "/v1/console/auth/oidc/authorization-codes/consume":
				operation = "console.auth.oidc.authorization_code.consume"
			case "/v1/console/auth/oidc/refresh-tokens":
				operation = "console.auth.oidc.refresh_token.issue"
			case "/v1/console/auth/oidc/refresh-tokens/consume":
				operation = "console.auth.oidc.refresh_token.consume"
			case "/v1/console/auth/oidc/refresh-tokens/revoke":
				operation = "console.auth.oidc.refresh_token.revoke"
			default:
				operation = "console.auth.oidc.token_event.append"
			}
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode:       "console",
			Scope:         scope,
			SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		body := map[string]any{}
		if r.Method == http.MethodPost {
			body, err = readJSONBody(r)
			if err != nil {
				return routeResult{}, err
			}
		}
		var result map[string]any
		switch path {
		case "/v1/console/auth/oidc/clients/resolve":
			result, err = adapter.ResolveOIDCClient(r.Context(), body)
		case "/v1/console/auth/oidc/authorization-codes":
			result, err = adapter.CreateOIDCAuthorizationCode(r.Context(), body, consoleapp.AuditMutationMeta{
				IdempotencyKey: r.Header.Get("Idempotency-Key"),
				RequestID:      requestID(r),
				ActorType:      "service",
				ActorID:        authCtx.Subject,
				SourceApp:      authCtx.AppCode,
			})
		case "/v1/console/auth/oidc/authorization-codes/consume":
			result, err = adapter.ConsumeOIDCAuthorizationCode(r.Context(), body)
		case "/v1/console/auth/oidc/refresh-tokens":
			result, err = adapter.IssueOIDCRefreshToken(r.Context(), body, consoleapp.AuditMutationMeta{
				IdempotencyKey: r.Header.Get("Idempotency-Key"),
				RequestID:      requestID(r),
				ActorType:      "service",
				ActorID:        authCtx.Subject,
				SourceApp:      authCtx.AppCode,
			})
		case "/v1/console/auth/oidc/refresh-tokens/consume":
			result, err = adapter.ConsumeOIDCRefreshToken(r.Context(), body)
		case "/v1/console/auth/oidc/refresh-tokens/revoke":
			result, err = adapter.RevokeOIDCRefreshTokens(r.Context(), body, consoleapp.AuditMutationMeta{
				IdempotencyKey: r.Header.Get("Idempotency-Key"),
				RequestID:      requestID(r),
				ActorType:      "service",
				ActorID:        authCtx.Subject,
				SourceApp:      authCtx.AppCode,
			})
		case "/v1/console/auth/oidc/token-events":
			result, err = adapter.AppendOIDCTokenEvent(r.Context(), body, consoleapp.AuditMutationMeta{
				IdempotencyKey: r.Header.Get("Idempotency-Key"),
				RequestID:      requestID(r),
				ActorType:      "service",
				ActorID:        authCtx.Subject,
				SourceApp:      authCtx.AppCode,
			})
		case "/v1/console/auth/oidc/sign":
			if claims, ok := body["claims"].(map[string]any); ok {
				if err := bindOIDCSigningClaimsToRuntime(claims, authCtx, s.cfg.DeploymentBindings); err != nil {
					return routeResult{}, err
				}
			}
			result, err = adapter.SignOIDCToken(r.Context(), body, consoleapp.AuditMutationMeta{
				RequestID: requestID(r), ActorType: "service",
				ActorID: authCtx.Subject, SourceApp: authCtx.AppCode,
			})
		default:
			result, err = adapter.VerifyOIDCServiceTokenState(r.Context(), body)
		}
		if err == nil {
			result = map[string]any{"code": 0, "data": result}
		}
		return routeResult{Operation: operation, Auth: &authCtx, Body: result}, err
	}

	if r.Method == http.MethodPost && path == "/v1/console/auth/service-tokens/issue" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: "console:service-token:issue", SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		result, err := adapter.IssueConsoleRuntimeServiceToken(
			r.Context(), body, authCtx.Deployment, consoleapp.AuditMutationMeta{
				RequestID: requestID(r), ActorType: "service",
				ActorID: authCtx.Subject, SourceApp: authCtx.AppCode,
			},
		)
		if err == nil {
			result = map[string]any{"code": 0, "data": result}
		}
		return routeResult{
			Operation: "console.auth.service_token.issue", Auth: &authCtx, Body: result,
		}, err
	}

	if r.Method == http.MethodPost &&
		(path == "/v1/console/auth/service-clients/consume" ||
			path == "/v1/console/auth/runtime-app-identities/consume" ||
			path == "/v1/console/auth/bootstrap-access-keys/consume") {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: "console:service-client:consume", SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		var result map[string]any
		operation := "console.auth.service_client.consume"
		switch path {
		case "/v1/console/auth/service-clients/consume":
			result, err = adapter.ConsumeServiceClientCredential(r.Context(), body)
		case "/v1/console/auth/runtime-app-identities/consume":
			operation = "console.auth.runtime_app_identity.consume"
			result, err = adapter.ConsumeRuntimeAppIdentity(r.Context(), body)
		default:
			operation = "console.auth.bootstrap_access_key.consume"
			result, err = adapter.ConsumeBootstrapAccessKey(r.Context(), body)
		}
		if err == nil {
			result = map[string]any{"code": 0, "data": result}
		}
		return routeResult{Operation: operation, Auth: &authCtx, Body: result}, err
	}

	if path == "/v1/console/oss/avatars" &&
		(r.Method == http.MethodGet || r.Method == http.MethodPut) {
		scope := "console:avatar-object:read"
		operation := "console.avatar_object.read"
		if r.Method == http.MethodPut {
			scope = "console:avatar-object:write"
			operation = "console.avatar_object.write"
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: scope, SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		actorID, _, _ := runtimeActorContextDetails(r, authCtx)
		actorType := "service"
		if actorID != strings.TrimSpace(authCtx.Subject) {
			actorType = "human"
		}
		meta := consoleapp.VaultAccessMeta{
			ActorType: actorType,
			ActorID:   actorID,
			AppCode:   "console",
			RequestIP: trustedRequestIP(r),
			UserAgent: strings.TrimSpace(r.UserAgent()),
		}
		integrationCode := strings.TrimSpace(r.URL.Query().Get("integrationCode"))
		if integrationCode == "" {
			integrationCode = "oss.default"
		}
		var result map[string]any
		if r.Method == http.MethodGet {
			meta.Reason = "avatar_object_read:" + integrationCode
			result, err = adapter.GetOSSAvatar(
				r.Context(),
				integrationCode,
				r.URL.Query().Get("objectPath"),
				meta,
			)
		} else {
			actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
			if actorErr != nil {
				return routeResult{}, actorErr
			}
			meta.ActorType = "human"
			meta.ActorID = actorUID
			meta.Reason = "avatar_object_write:" + integrationCode
			body, bodyErr := readJSONBody(r)
			if bodyErr != nil {
				return routeResult{}, bodyErr
			}
			result, err = adapter.PutOSSAvatar(r.Context(), integrationCode, body, meta)
		}
		if err == nil {
			result = map[string]any{"code": 0, "data": result}
		}
		return routeResult{Operation: operation, Auth: &authCtx, Body: result}, err
	}

	if r.Method == http.MethodPost &&
		strings.HasPrefix(path, "/v1/console/service/integrations/") &&
		strings.Contains(path, "/wecom/") {
		suffix := strings.TrimPrefix(path, "/v1/console/service/integrations/")
		parts := strings.Split(suffix, "/")
		if len(parts) != 3 || parts[1] != "wecom" {
			return routeResult{}, httperror.New(
				http.StatusNotFound, "route_not_found", "Route not found",
			)
		}
		code, decodeErr := url.PathUnescape(parts[0])
		if decodeErr != nil || code == "" || strings.Contains(code, "/") {
			return routeResult{}, httperror.New(
				http.StatusBadRequest,
				"console_integration_code_invalid",
				"Integration code is invalid",
			)
		}
		operation := strings.TrimSpace(parts[2])
		if operation != "oauth-user" && operation != "user-detail" {
			return routeResult{}, httperror.New(
				http.StatusNotFound,
				"console_wecom_operation_not_found",
				"WeCom operation was not found",
			)
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: "integration_operations:execute",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		result, err := adapter.ExecuteServiceWeComOperation(
			r.Context(), code, operation, body,
			authCtx.Subject, authCtx.AppCode,
			trustedRequestIP(r), strings.TrimSpace(r.UserAgent()),
		)
		var response any = result
		if err == nil {
			response = map[string]any{"code": 0, "data": result}
		}
		return routeResult{
			Operation: "console.service.integration.wecom." + operation,
			Auth:      &authCtx,
			Body:      response,
		}, err
	}

	if r.Method == http.MethodPost &&
		strings.HasPrefix(path, "/v1/console/service/integrations/") &&
		strings.Contains(path, "/gitlab/") {
		suffix := strings.TrimPrefix(path, "/v1/console/service/integrations/")
		parts := strings.Split(suffix, "/")
		if len(parts) != 3 || parts[1] != "gitlab" {
			return routeResult{}, httperror.New(
				http.StatusNotFound, "route_not_found", "Route not found",
			)
		}
		code, decodeErr := url.PathUnescape(parts[0])
		if decodeErr != nil || code == "" || strings.Contains(code, "/") {
			return routeResult{}, httperror.New(
				http.StatusBadRequest,
				"console_integration_code_invalid",
				"Integration code is invalid",
			)
		}
		operation := strings.TrimSpace(parts[2])
		allowedOperations := map[string]bool{
			"project-info": true, "group-projects": true,
			"commits": true, "commit-diff": true,
			"markdown-tree": true, "file": true, "commit": true,
			"issue-upsert": true, "resolve-actions": true,
		}
		if !allowedOperations[operation] {
			return routeResult{}, httperror.New(
				http.StatusNotFound,
				"console_gitlab_operation_not_found",
				"GitLab operation was not found",
			)
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: "integration_operations:execute",
		})
		if err != nil {
			return routeResult{}, err
		}
		if (operation == "commit" || operation == "issue-upsert") && strings.TrimSpace(r.Header.Get("Idempotency-Key")) == "" {
			return routeResult{}, httperror.New(
				http.StatusBadRequest,
				"idempotency_key_required",
				"Idempotency-Key is required for GitLab commit operations",
			)
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		result, err := adapter.ExecuteServiceGitLabOperation(
			r.Context(), code, operation, body,
			authCtx.Subject, authCtx.AppCode,
			trustedRequestIP(r), strings.TrimSpace(r.UserAgent()),
		)
		var response any = result
		if err == nil {
			response = map[string]any{"code": 0, "data": result}
		}
		return routeResult{
			Operation: "console.service.integration.gitlab." + operation,
			Auth:      &authCtx,
			Body:      response,
		}, err
	}

	if strings.HasPrefix(path, "/v1/console/service/integrations") {
		suffix := strings.TrimPrefix(path, "/v1/console/service/integrations")
		isList := suffix == "" && r.Method == http.MethodGet
		isResolve := strings.HasSuffix(suffix, "/resolve") && r.Method == http.MethodPost
		isDetail := strings.HasPrefix(suffix, "/") &&
			!strings.Contains(strings.TrimPrefix(suffix, "/"), "/") &&
			r.Method == http.MethodGet
		if !isList && !isResolve && !isDetail {
			return routeResult{}, httperror.New(http.StatusNotFound, "route_not_found", "Route not found")
		}
		scope := "integration_config:view"
		operation := "console.service.integration.read"
		if isResolve {
			scope = "credential_vault:resolve"
			operation = "console.service.integration.resolve"
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: scope,
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		var result map[string]any
		switch {
		case isList:
			result, err = adapter.ListServiceIntegrations(
				r.Context(), r.URL.Query(), authCtx.Subject, authCtx.AppCode,
			)
		case isResolve:
			codePart := strings.TrimSuffix(strings.TrimPrefix(suffix, "/"), "/resolve")
			code, decodeErr := url.PathUnescape(codePart)
			if decodeErr != nil || code == "" || strings.Contains(code, "/") {
				return routeResult{}, httperror.New(
					http.StatusBadRequest, "console_integration_code_invalid", "Integration code is invalid",
				)
			}
			result, err = adapter.ResolveServiceIntegrationCredential(
				r.Context(), code, authCtx.Subject, authCtx.AppCode,
				trustedRequestIP(r), strings.TrimSpace(r.UserAgent()),
			)
		default:
			code, decodeErr := url.PathUnescape(strings.TrimPrefix(suffix, "/"))
			if decodeErr != nil || code == "" || strings.Contains(code, "/") {
				return routeResult{}, httperror.New(
					http.StatusBadRequest, "console_integration_code_invalid", "Integration code is invalid",
				)
			}
			result, err = adapter.GetServiceIntegration(
				r.Context(), code, authCtx.Subject, authCtx.AppCode,
			)
		}
		if err == nil {
			result = map[string]any{"code": 0, "data": result}
		}
		return routeResult{Operation: operation, Auth: &authCtx, Body: result}, err
	}

	if strings.HasPrefix(path, "/v1/console/integrations") {
		var scope, operation string
		switch {
		case r.Method == http.MethodGet && path == "/v1/console/integrations":
			scope, operation = "console:integration:view", "console.integration.list"
		case r.Method == http.MethodPost && path == "/v1/console/integrations":
			scope, operation = "console:integration:edit", "console.integration.create"
		case r.Method == http.MethodGet && strings.Count(strings.TrimPrefix(path, "/v1/console/integrations/"), "/") == 0:
			scope, operation = "console:integration:view", "console.integration.read"
		case r.Method == http.MethodPatch && strings.Count(strings.TrimPrefix(path, "/v1/console/integrations/"), "/") == 0:
			scope, operation = "console:integration:edit", "console.integration.update"
		case r.Method == http.MethodPost && strings.HasSuffix(path, "/rotate"):
			scope, operation = "console:integration:rotate", "console.integration.credential.rotate"
		case r.Method == http.MethodPost && strings.HasSuffix(path, "/check"):
			scope, operation = "console:integration:test", "console.integration.check"
		default:
			return routeResult{}, httperror.New(http.StatusNotFound, "route_not_found", "Route not found")
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: scope, SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		var result any
		switch {
		case r.Method == http.MethodGet && path == "/v1/console/integrations":
			result, err = adapter.ListIntegrations(r.Context(), r.URL.Query())
		case r.Method == http.MethodGet:
			code := strings.TrimPrefix(path, "/v1/console/integrations/")
			result, err = adapter.GetIntegration(r.Context(), code)
		default:
			actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
			if actorErr != nil {
				return routeResult{}, actorErr
			}
			body, bodyErr := readJSONBody(r)
			if bodyErr != nil {
				return routeResult{}, bodyErr
			}
			meta := consoleapp.MutationMeta{
				IdempotencyKey: r.Header.Get("Idempotency-Key"),
				RequestID:      requestID(r),
				ActorID:        actorUID,
			}
			switch {
			case path == "/v1/console/integrations":
				result, err = adapter.CreateIntegration(r.Context(), body, meta)
			case strings.HasSuffix(path, "/rotate"):
				code := strings.TrimSuffix(
					strings.TrimPrefix(path, "/v1/console/integrations/"), "/rotate",
				)
				result, err = adapter.RotateIntegrationCredential(r.Context(), code, body, meta)
			case strings.HasSuffix(path, "/check"):
				code := strings.TrimSuffix(
					strings.TrimPrefix(path, "/v1/console/integrations/"), "/check",
				)
				result, err = adapter.CheckIntegration(r.Context(), code, meta)
			default:
				code := strings.TrimPrefix(path, "/v1/console/integrations/")
				result, err = adapter.UpdateIntegration(r.Context(), code, body, meta)
			}
		}
		if err == nil {
			result = map[string]any{"code": 0, "data": result}
		}
		return routeResult{Operation: operation, Auth: &authCtx, Body: result}, err
	}

	if strings.HasPrefix(path, "/v1/console/connector-runtime") {
		var scope, operation string
		switch {
		case r.Method == http.MethodGet && path == "/v1/console/connector-runtime":
			scope, operation = "console:connector-runtime:view", "console.connector_runtime.read"
		case r.Method == http.MethodPost && path == "/v1/console/connector-runtime/enrollments":
			scope, operation = "console:connector-runtime:admin", "console.connector_runtime.enrollment.issue"
		case r.Method == http.MethodPost && path == "/v1/console/connector-runtime/enroll":
			scope, operation = "console:connector-runtime:enroll", "console.connector_runtime.enrollment.redeem"
		case r.Method == http.MethodPost && path == "/v1/console/connector-runtime/heartbeat":
			scope, operation = "console:connector-runtime:heartbeat", "console.connector_runtime.heartbeat"
		case r.Method == http.MethodPost && path == "/v1/console/connector-runtime/revoke":
			scope, operation = "console:connector-runtime:admin", "console.connector_runtime.revoke"
		default:
			return routeResult{}, httperror.New(http.StatusNotFound, "route_not_found", "Route not found")
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: scope, SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		deploymentCode := s.cfg.DeploymentForApp("console")
		var result any
		switch path {
		case "/v1/console/connector-runtime":
			result, err = adapter.ConnectorRuntimeMetadata(r.Context(), deploymentCode)
			if err == nil {
				result = map[string]any{"code": 0, "data": result}
			}
		case "/v1/console/connector-runtime/enrollments":
			actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
			if actorErr != nil {
				return routeResult{}, actorErr
			}
			result, err = adapter.IssueConnectorRuntimeEnrollment(
				r.Context(), deploymentCode, consoleapp.ConnectorRuntimeMutationMeta{
					IdempotencyKey: r.Header.Get("Idempotency-Key"),
					RequestID:      requestID(r),
					ActorID:        actorUID,
				},
			)
			if err == nil {
				result = map[string]any{"code": 0, "data": result}
			}
		case "/v1/console/connector-runtime/enroll":
			body, bodyErr := readJSONBody(r)
			if bodyErr != nil {
				return routeResult{}, bodyErr
			}
			result, err = adapter.RedeemConnectorRuntimeEnrollment(r.Context(), deploymentCode, body)
			if err == nil {
				result = map[string]any{"code": 0, "data": result}
			}
		case "/v1/console/connector-runtime/heartbeat":
			body, bodyErr := readJSONBody(r)
			if bodyErr != nil {
				return routeResult{}, bodyErr
			}
			result, err = adapter.RecordConnectorRuntimeHeartbeat(r.Context(), deploymentCode, body)
			if err == nil {
				result = map[string]any{"code": 0, "data": result}
			}
		case "/v1/console/connector-runtime/revoke":
			actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
			if actorErr != nil {
				return routeResult{}, actorErr
			}
			result, err = adapter.RevokeConnectorRuntime(
				r.Context(), deploymentCode, consoleapp.ConnectorRuntimeMutationMeta{
					IdempotencyKey: r.Header.Get("Idempotency-Key"),
					RequestID:      requestID(r),
					ActorID:        actorUID,
				},
			)
		}
		return routeResult{Operation: operation, Auth: &authCtx, Body: result}, err
	}

	if (r.Method == http.MethodGet || r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodPatch || r.Method == http.MethodDelete) && strings.HasPrefix(path, "/v1/console/directory/") {
		var scope, operation string
		sourceApp := "console"
		switch {
		case r.Method == http.MethodGet && path == "/v1/console/directory/provisioning":
			scope, operation = "console:directory-connector:view", "console.directory.connector.provisioning"
		case r.Method == http.MethodGet && path == "/v1/console/directory/me/password-capability":
			scope, operation = "console:directory-connector:view", "console.directory.connector.password-capability"
		case r.Method == http.MethodPost && path == "/v1/console/directory/me/password":
			scope, operation = "console:directory-connector:execute", "console.directory.connector.password-change.queue"
		case (r.Method == http.MethodGet || r.Method == http.MethodPost) && strings.HasPrefix(path, "/v1/console/directory/operations/"):
			scope, operation = "console:directory-connector:view", "console.directory.connector.operation.read"
		case r.Method == http.MethodPost && path == "/v1/console/directory/sources/ldap/test":
			scope, operation = "console:directory-connector:execute", "console.directory.connector.test.queue"
		case r.Method == http.MethodGet && path == "/v1/console/directory/sources":
			scope, operation = "console:directory-source:view", "console.directory.sources.read"
		case r.Method == http.MethodPost && path == "/v1/console/directory/sources":
			scope, operation = "console:directory-source:edit", "console.directory.source.upsert"
		case (r.Method == http.MethodGet || r.Method == http.MethodPut) &&
			strings.HasPrefix(path, "/v1/console/directory/sources/"):
			scope, operation = "console:directory-source:view", "console.directory.source.read"
			if r.Method == http.MethodPut {
				scope, operation = "console:directory-source:edit", "console.directory.source.upsert"
			}
		case r.Method == http.MethodPost && path == "/v1/console/directory/connector-operations/ldap-sync":
			scope, operation = "console:directory-connector:execute", "console.directory.connector.sync.queue"
		case r.Method == http.MethodPost && path == "/v1/console/directory/connector-operations/users":
			scope, operation = "console:directory-connector:execute", "console.directory.connector.user-create.queue"
		case r.Method == http.MethodPost && path == "/v1/console/directory/identity-reservations":
			scope, operation = "console:directory-connector:execute", "console.directory.identity.reserve"
		case r.Method == http.MethodPost && path == "/v1/console/directory/identity-reservations:release":
			scope, operation = "console:directory-connector:execute", "console.directory.identity.release"
		case r.Method == http.MethodPost && path == "/v1/console/directory/activation/issue":
			scope, operation = "console:directory-connector:execute", "console.directory.activation.issue"
		case r.Method == http.MethodPut && path == "/v1/console/directory/me/avatar":
			scope, operation = "console:directory-profile:edit", "console.directory.profile.avatar.update"
		case r.Method == http.MethodGet && path == "/v1/console/directory/meta":
			scope, operation = "console:directory-user:view", "console.directory.meta"
		case r.Method == http.MethodGet && path == "/v1/console/directory/users":
			scope, operation = "console:directory-user:view", "console.directory.users.read"
		case r.Method == http.MethodPost && path == "/v1/console/directory/users":
			scope, operation = "console:directory-user:edit", "console.directory.user.create"
		case path == "/v1/console/directory/users/batch" && r.Method == http.MethodPost:
			scope, operation = "console:directory-user:view", "console.directory.users.batch"
		case (r.Method == http.MethodGet || r.Method == http.MethodPatch) && strings.HasPrefix(path, "/v1/console/directory/users/"):
			scope, operation = "console:directory-user:view", "console.directory.user.read"
			if r.Method == http.MethodPatch {
				scope, operation = "console:directory-user:edit", "console.directory.user.update"
			}
		case r.Method == http.MethodGet && path == "/v1/console/directory/user-departments":
			scope, operation = "console:directory-user:view", "console.directory.user-departments.read"
		case r.Method == http.MethodGet && path == "/v1/console/directory/accessible-departments":
			scope, operation = "console:directory-department:view", "console.directory.accessible-departments.read"
		case r.Method == http.MethodGet && path == "/v1/console/directory/departments":
			scope, operation = "console:directory-department:view", "console.directory.departments.read"
		case (r.Method == http.MethodGet || r.Method == http.MethodPost) && path == "/v1/console/directory/hr-sources/dingtalk/department-mappings":
			scope, operation = "console:hr-source-sync:view", "console.directory.dingtalk_department_mappings.preview"
			if r.Method == http.MethodPost {
				scope, operation = "console:hr-source-sync:admin", "console.directory.dingtalk_department_mappings.apply"
			}
		case (r.Method == http.MethodGet || r.Method == http.MethodPost) && path == "/v1/console/directory/hr-sources/dingtalk/department-changes":
			scope, operation = "console:hr-source-sync:view", "console.directory.dingtalk_department_changes.preview"
			if r.Method == http.MethodPost {
				scope, operation = "console:hr-source-sync:admin", "console.directory.dingtalk_department_changes.apply"
			}
		case r.Method == http.MethodPost && path == "/v1/console/directory/departments":
			scope, operation = "console:directory-department:edit", "console.directory.department.create"
		case (r.Method == http.MethodGet || r.Method == http.MethodPatch || r.Method == http.MethodDelete) && strings.HasPrefix(path, "/v1/console/directory/departments/"):
			scope, operation = "console:directory-department:view", "console.directory.department.read"
			if r.Method != http.MethodGet {
				scope, operation = "console:directory-department:edit", "console.directory.department.mutate"
			}
		case r.Method == http.MethodGet && path == "/v1/console/directory/committees":
			scope, operation = "console:directory-department:view", "console.directory.committees.read"
		case r.Method == http.MethodPost && path == "/v1/console/directory/committees":
			scope, operation = "console:directory-department:edit", "console.directory.committee.create"
		case (r.Method == http.MethodGet || r.Method == http.MethodPatch || r.Method == http.MethodDelete) && strings.HasPrefix(path, "/v1/console/directory/committees/"):
			scope, operation = "console:directory-department:view", "console.directory.committee.read"
			if r.Method != http.MethodGet {
				scope, operation = "console:directory-department:edit", "console.directory.committee.mutate"
			}
		case r.Method == http.MethodGet && path == "/v1/console/directory/projects":
			scope, operation = "console:directory-project:view", "console.directory.projects.read"
		case r.Method == http.MethodPost && path == "/v1/console/directory/projects":
			scope, operation = "console:directory-project:edit", "console.directory.project.create"
		case (r.Method == http.MethodGet || r.Method == http.MethodPost || r.Method == http.MethodPatch || r.Method == http.MethodDelete) && strings.HasPrefix(path, "/v1/console/directory/projects/"):
			scope, operation = "console:directory-project:view", "console.directory.project.read"
			if r.Method != http.MethodGet {
				scope, operation = "console:directory-project:edit", "console.directory.project.mutate"
			}
		case r.Method == http.MethodGet && path == "/v1/console/directory/subjects/export":
			scope, operation = "console:directory-sync:export", "console.directory.subjects.export"
		case r.Method == http.MethodGet && path == "/v1/console/directory/subjects/memberships":
			scope, operation = "console:directory-sync:export", "console.directory.subjects.memberships"
		case (r.Method == http.MethodGet || r.Method == http.MethodPost) &&
			(path == "/v1/console/directory/sync-jobs" ||
				strings.HasPrefix(path, "/v1/console/directory/sync-jobs/")):
			scope, operation = "console:directory-sync:view", "console.directory.sync_jobs.read"
			if r.Method == http.MethodPost {
				scope, operation = "console:directory-sync:edit", "console.directory.sync_jobs.start"
			}
		case r.Method == http.MethodPost && isConsoleDirectoryLifecyclePath(path, "employment"):
			scope, operation = "console:directory-employment:sync", "console.directory.lifecycle.employment"
		case r.Method == http.MethodPost && isConsoleDirectoryLifecyclePath(path, "offboarding"):
			scope, operation = "console:directory-offboarding:disable", "console.directory.lifecycle.offboarding"
		case r.Method == http.MethodPost && path == "/v1/console/directory/service/dingtalk-profile-sync-batches":
			scope, operation = "console:directory-profiles:sync", "console.directory.dingtalk-profile.batch"
			sourceApp = "console"
		case r.Method == http.MethodPost && path == "/v1/console/directory/service/dingtalk-profile-sync-failures":
			scope, operation = "console:directory-profiles:sync", "console.directory.dingtalk-profile.failure"
			sourceApp = "console"
		}
		if scope != "" {
			authCtx, err := s.auth.Authenticate(r, auth.Requirement{
				AppCode: "console", Scope: scope, SourceAppCode: sourceApp,
			})
			if err != nil {
				return routeResult{}, err
			}
			if s.directory == nil {
				return routeResult{}, httperror.New(http.StatusServiceUnavailable, "directory_runtime_not_ready", "Directory Runtime is not ready")
			}
			var result any
			switch {
			case r.Method == http.MethodGet && path == "/v1/console/directory/sources":
				adapter, adapterErr := s.requireConsole()
				if adapterErr != nil {
					return routeResult{}, adapterErr
				}
				result, err = adapter.ListDirectorySources(r.Context())
			case (r.Method == http.MethodGet || r.Method == http.MethodPut) &&
				strings.HasPrefix(path, "/v1/console/directory/sources/") &&
				path != "/v1/console/directory/sources/ldap/test":
				adapter, adapterErr := s.requireConsole()
				if adapterErr != nil {
					return routeResult{}, adapterErr
				}
				provider, decodeErr := url.PathUnescape(strings.TrimPrefix(path, "/v1/console/directory/sources/"))
				if decodeErr != nil || provider == "" || strings.Contains(provider, "/") {
					return routeResult{}, httperror.New(http.StatusBadRequest, "console_directory_source_provider_invalid", "Directory source provider is invalid")
				}
				if r.Method == http.MethodGet {
					result, err = adapter.DirectorySource(r.Context(), provider)
				} else {
					actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
					if actorErr != nil {
						return routeResult{}, actorErr
					}
					body, bodyErr := readJSONBody(r)
					if bodyErr != nil {
						return routeResult{}, bodyErr
					}
					result, err = adapter.UpsertDirectorySource(r.Context(), provider, body, consoleapp.MutationMeta{
						IdempotencyKey: r.Header.Get("Idempotency-Key"),
						RequestID:      requestID(r), ActorID: actorUID,
					})
					if err == nil {
						result = map[string]any{"code": 0, "data": result}
					}
				}
			case r.Method == http.MethodPost && path == "/v1/console/directory/sources":
				adapter, adapterErr := s.requireConsole()
				if adapterErr != nil {
					return routeResult{}, adapterErr
				}
				actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
				if actorErr != nil {
					return routeResult{}, actorErr
				}
				body, bodyErr := readJSONBody(r)
				if bodyErr != nil {
					return routeResult{}, bodyErr
				}
				result, err = adapter.UpsertDirectorySource(r.Context(), "", body, consoleapp.MutationMeta{
					IdempotencyKey: r.Header.Get("Idempotency-Key"),
					RequestID:      requestID(r), ActorID: actorUID,
				})
				if err == nil {
					result = map[string]any{"code": 0, "data": result}
				}
			case r.Method == http.MethodGet && path == "/v1/console/directory/provisioning":
				result, err = s.directory.ConsoleDirectoryProvisioningState(r.Context(), authCtx.Deployment)
			case r.Method == http.MethodGet && path == "/v1/console/directory/me/password-capability":
				actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
				if actorErr != nil {
					return routeResult{}, actorErr
				}
				result, err = s.directory.ConsoleSelfLDAPPasswordCapability(r.Context(), actorUID, authCtx.Deployment)
			case r.Method == http.MethodGet && strings.HasPrefix(path, "/v1/console/directory/operations/"):
				actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
				if actorErr != nil {
					return routeResult{}, actorErr
				}
				operationID, decodeErr := url.PathUnescape(strings.TrimPrefix(path, "/v1/console/directory/operations/"))
				if decodeErr != nil || operationID == "" || strings.Contains(operationID, "/") {
					return routeResult{}, httperror.New(http.StatusBadRequest, "directory_connector_operation_id_invalid", "Directory Connector operation id is invalid")
				}
				result, err = s.directory.ConsoleDirectoryConnectorOperation(r.Context(), operationID, actorUID)
			case r.Method == http.MethodPost && strings.HasPrefix(path, "/v1/console/directory/operations/"):
				body, bodyErr := readJSONBody(r)
				if bodyErr != nil {
					return routeResult{}, bodyErr
				}
				if contextErr := injectTrustedServiceCommandContext(r, authCtx, body); contextErr != nil {
					return routeResult{}, contextErr
				}
				actorUID, actorErr := trustedConsoleServiceCommandActor(r, authCtx)
				if actorErr != nil {
					return routeResult{}, actorErr
				}
				command, ok := serviceCommandPayload(body)
				if !ok || strings.TrimSpace(stringValue(command["actorUid"])) != actorUID {
					return routeResult{}, httperror.New(http.StatusForbidden, "trusted_console_service_command_actor_required", "Onboarding status command actor is invalid")
				}
				operationID, decodeErr := url.PathUnescape(strings.TrimPrefix(path, "/v1/console/directory/operations/"))
				if decodeErr != nil || operationID == "" || strings.Contains(operationID, "/") || operationID != stringValue(command["provisionOperationId"]) {
					return routeResult{}, httperror.New(http.StatusBadRequest, "directory_connector_operation_id_invalid", "Directory Connector operation id is invalid")
				}
				result, err = s.directory.ConsoleDirectoryOnboardingOperation(
					r.Context(), operationID, stringValue(command["uid"]), stringValue(command["onboardingCode"]))
			case r.Method == http.MethodPost && path == "/v1/console/directory/me/password":
				actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
				if actorErr != nil {
					return routeResult{}, actorErr
				}
				body, bodyErr := readJSONBody(r)
				if bodyErr != nil {
					return routeResult{}, bodyErr
				}
				result, err = s.directory.ConsoleQueueSelfLDAPPasswordChange(r.Context(), body, authCtx.Deployment,
					directoryapp.ConsoleMutationMeta{
						IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
						ActorID: actorUID, ActorType: "human",
					})
				if err == nil {
					result = map[string]any{"code": 0, "data": result}
				}
			case r.Method == http.MethodPost &&
				(path == "/v1/console/directory/sources/ldap/test" ||
					path == "/v1/console/directory/connector-operations/ldap-sync"):
				actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
				if actorErr != nil {
					return routeResult{}, actorErr
				}
				meta := directoryapp.ConsoleMutationMeta{
					IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
					ActorID: actorUID, ActorType: "human",
				}
				if strings.HasSuffix(path, "/ldap-sync") {
					result, err = s.directory.ConsoleQueueLDAPSync(r.Context(), authCtx.Deployment, meta)
				} else {
					result, err = s.directory.ConsoleQueueLDAPConnectionTest(r.Context(), authCtx.Deployment, meta)
				}
				if err == nil {
					result = map[string]any{"code": 0, "data": result}
				}
			// 激活凭据的查看与兑换由未登录员工经 Console BFF 触发：员工此时还
			// 没有可用账号，无法提供任何用户身份。此处仍受 runtime 服务认证保护，
			// 凭据本身是唯一的授权材料。
			// 身份预留：开户前原子占位 UID/登录名/邮箱/外部主体。
			case r.Method == http.MethodPost && path == "/v1/console/directory/identity-reservations":
				body, bodyErr := readJSONBody(r)
				if bodyErr != nil {
					return routeResult{}, bodyErr
				}
				command := body
				actorUID := ""
				if payload, serviceCommand := serviceCommandPayload(body); serviceCommand {
					if contextErr := injectTrustedServiceCommandContext(r, authCtx, body); contextErr != nil {
						return routeResult{}, contextErr
					}
					var actorErr error
					actorUID, actorErr = trustedConsoleServiceCommandActor(r, authCtx)
					if actorErr != nil {
						return routeResult{}, actorErr
					}
					command = payload
				} else {
					var actorErr error
					actorUID, actorErr = trustedConsoleMutationActor(r, authCtx)
					if actorErr != nil {
						return routeResult{}, actorErr
					}
				}
				result, err = s.directory.ConsoleReserveDirectoryIdentity(r.Context(), directoryapp.ConsoleIdentityReservationInput{
					UID:             stringValue(command["uid"]),
					Username:        stringValue(command["username"]),
					Email:           stringValue(command["email"]),
					ProviderCode:    stringValue(command["providerCode"]),
					ProviderSubject: stringValue(command["providerSubject"]),
					SourceApp:       firstNonEmptyText(command["sourceApp"], "console"),
					SourceBizCode:   firstNonEmptyText(command["sourceBizCode"], command["onboardingCode"]),
					ActorUID:        actorUID,
				}, authCtx.Deployment)
				if err == nil {
					result = map[string]any{"code": 0, "data": result}
				}
			// 遗留 dt-* 主体的受控归并。预览只读；执行按固定顺序停用、撤销会话、
			// 迁移归属、重绑身份。
			case r.Method == http.MethodGet && path == "/v1/console/directory/subject-merge:preview":
				result, err = s.directory.ConsoleMergePreview(r.Context(),
					r.URL.Query().Get("legacyUid"), r.URL.Query().Get("canonicalUid"))
				if err == nil {
					result = map[string]any{"code": 0, "data": result}
				}
			case r.Method == http.MethodPost && path == "/v1/console/directory/subject-merge":
				return routeResult{}, httperror.New(http.StatusGone, "console_subject_merge_manual_only",
					"Cross-application subject merge is disabled; use the audited migration runbook")
			case r.Method == http.MethodGet && path == "/v1/console/directory/employment-lifecycle-status":
				result, err = s.directory.ConsoleReadEmploymentLifecycleStatus(r.Context(), r.URL.Query().Get("uid"))
				if err == nil {
					result = map[string]any{"code": 0, "data": result}
				}
			case r.Method == http.MethodPost && path == "/v1/console/directory/identity-reservations:suggest":
				body, bodyErr := readJSONBody(r)
				if bodyErr != nil {
					return routeResult{}, bodyErr
				}
				result, err = s.directory.ConsoleSuggestDirectoryIdentity(r.Context(),
					stringValue(body["base"]), stringValue(body["emailDomain"]))
				if err == nil {
					result = map[string]any{"code": 0, "data": result}
				}
			case r.Method == http.MethodDelete && strings.HasPrefix(path, "/v1/console/directory/identity-reservations/"):
				if _, actorErr := trustedConsoleMutationActor(r, authCtx); actorErr != nil {
					return routeResult{}, actorErr
				}
				reservationID := strings.TrimPrefix(path, "/v1/console/directory/identity-reservations/")
				result, err = s.directory.ConsoleReleaseDirectoryIdentityReservation(r.Context(), reservationID)
				if err == nil {
					result = map[string]any{"code": 0, "data": result}
				}
			case r.Method == http.MethodPost && path == "/v1/console/directory/identity-reservations:release":
				body, bodyErr := readJSONBody(r)
				if bodyErr != nil {
					return routeResult{}, bodyErr
				}
				if contextErr := injectTrustedServiceCommandContext(r, authCtx, body); contextErr != nil {
					return routeResult{}, contextErr
				}
				actorUID, actorErr := trustedConsoleServiceCommandActor(r, authCtx)
				if actorErr != nil {
					return routeResult{}, actorErr
				}
				command, ok := serviceCommandPayload(body)
				if !ok || stringValue(command["actorUid"]) != actorUID {
					return routeResult{}, httperror.New(http.StatusForbidden, "trusted_console_service_command_actor_required", "Reservation release command actor is invalid")
				}
				result, err = s.directory.ConsoleReleaseOnboardingIdentityReservation(
					r.Context(), stringValue(command["reservationId"]), stringValue(command["uid"]),
					stringValue(command["onboardingCode"]))
				if err == nil {
					result = map[string]any{"code": 0, "data": result}
				}
			case r.Method == http.MethodPost && path == "/v1/console/directory/activation/inspect":
				body, bodyErr := readJSONBody(r)
				if bodyErr != nil {
					return routeResult{}, bodyErr
				}
				result, err = s.directory.ConsoleInspectActivationCredential(r.Context(), stringValue(body["token"]))
				if err == nil {
					result = map[string]any{"code": 0, "data": result}
				}
			case r.Method == http.MethodPost && path == "/v1/console/directory/activation/issue":
				body, bodyErr := readJSONBody(r)
				if bodyErr != nil {
					return routeResult{}, bodyErr
				}
				if contextErr := injectTrustedServiceCommandContext(r, authCtx, body); contextErr != nil {
					return routeResult{}, contextErr
				}
				actorUID, actorErr := trustedConsoleServiceCommandActor(r, authCtx)
				if actorErr != nil {
					return routeResult{}, actorErr
				}
				command, ok := serviceCommandPayload(body)
				if !ok || stringValue(command["actorUid"]) != actorUID {
					return routeResult{}, httperror.New(http.StatusForbidden, "trusted_console_service_command_actor_required", "Activation command actor is invalid")
				}
				result, err = s.directory.ConsoleIssueOnboardingActivationCredential(
					r.Context(), stringValue(command["uid"]), stringValue(command["provisionOperationId"]),
					stringValue(command["onboardingCode"]), "people")
				if err == nil {
					result = map[string]any{"code": 0, "data": result}
				}
			case r.Method == http.MethodPost && path == "/v1/console/directory/activation/redeem":
				body, bodyErr := readJSONBody(r)
				if bodyErr != nil {
					return routeResult{}, bodyErr
				}
				result, err = s.directory.ConsoleRedeemActivationCredential(r.Context(),
					stringValue(body["token"]), stringValue(body["newPassword"]),
					authCtx.Deployment, requestID(r))
				if err == nil {
					result = map[string]any{"code": 0, "data": result}
				}
			case r.Method == http.MethodPost && path == "/v1/console/directory/connector-operations/users":
				body, bodyErr := readJSONBody(r)
				if bodyErr != nil {
					return routeResult{}, bodyErr
				}
				command := body
				actorUID := ""
				if payload, serviceCommand := serviceCommandPayload(body); serviceCommand {
					if contextErr := injectTrustedServiceCommandContext(r, authCtx, body); contextErr != nil {
						return routeResult{}, contextErr
					}
					var actorErr error
					actorUID, actorErr = trustedConsoleServiceCommandActor(r, authCtx)
					if actorErr != nil {
						return routeResult{}, actorErr
					}
					command = payload
				} else {
					var actorErr error
					actorUID, actorErr = trustedConsoleMutationActor(r, authCtx)
					if actorErr != nil {
						return routeResult{}, actorErr
					}
				}
				result, err = s.directory.ConsoleQueueLDAPUserCreate(r.Context(), command, authCtx.Deployment,
					directoryapp.ConsoleMutationMeta{
						IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
						ActorID: actorUID, ActorType: "human",
					})
				if err == nil {
					result = map[string]any{"code": 0, "data": result}
				}
			case r.Method == http.MethodPost &&
				(path == "/v1/console/directory/service/dingtalk-profile-sync-batches" ||
					path == "/v1/console/directory/service/dingtalk-profile-sync-failures"):
				body, bodyErr := readJSONBody(r)
				if bodyErr != nil {
					return routeResult{}, bodyErr
				}
				if contextErr := injectTrustedServiceCommandContext(r, authCtx, body); contextErr != nil {
					return routeResult{}, contextErr
				}
				kind := "batch"
				if strings.HasSuffix(path, "-failures") {
					kind = "failure"
				}
				commandResult, commandErr := s.directory.ConsoleApplyDingTalkProfileCommand(r.Context(), kind, body)
				err = commandErr
				if err == nil {
					result = map[string]any{"code": 0, "data": commandResult["result"]}
				}
			case r.Method == http.MethodPut && path == "/v1/console/directory/me/avatar":
				actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
				if actorErr != nil {
					return routeResult{}, actorErr
				}
				body, bodyErr := readJSONBody(r)
				if bodyErr != nil {
					return routeResult{}, bodyErr
				}
				result, err = s.directory.ConsoleUpdateOwnAvatar(r.Context(), body, directoryapp.ConsoleMutationMeta{
					IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
					ActorID: actorUID, ActorType: "human",
				})
			case r.Method == http.MethodPost &&
				(isConsoleDirectoryLifecyclePath(path, "employment") ||
					isConsoleDirectoryLifecyclePath(path, "offboarding")):
				body, bodyErr := readJSONBody(r)
				if bodyErr != nil {
					return routeResult{}, bodyErr
				}
				if contextErr := injectTrustedServiceCommandContext(r, authCtx, body); contextErr != nil {
					return routeResult{}, contextErr
				}
				kind := directoryapp.ConsoleLifecycleEmployment
				suffix := "employment"
				if isConsoleDirectoryLifecyclePath(path, "offboarding") {
					kind = directoryapp.ConsoleLifecycleOffboarding
					suffix = "offboarding"
				}
				uidPart := strings.TrimSuffix(
					strings.TrimPrefix(path, "/v1/console/directory/service/users/"),
					"/"+suffix,
				)
				uid, decodeErr := url.PathUnescape(uidPart)
				if decodeErr != nil || uid == "" || strings.Contains(uid, "/") {
					return routeResult{}, httperror.New(http.StatusBadRequest, "directory_uid_invalid", "Directory uid is invalid")
				}
				result, err = s.directory.ConsoleApplyPeopleLifecycle(
					r.Context(),
					uid,
					kind,
					s.cfg.DeploymentForApp("console"),
					body,
				)
				if err == nil {
					result = map[string]any{"code": 0, "data": result}
				}
			case path == "/v1/console/directory/meta":
				result, err = s.directory.ConsoleMeta(r.Context())
			case path == "/v1/console/directory/users":
				if r.Method == http.MethodGet {
					result, err = s.directory.ConsoleUsers(r.Context(), r.URL.Query())
				} else {
					actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
					if actorErr != nil {
						return routeResult{}, actorErr
					}
					body, bodyErr := readJSONBody(r)
					if bodyErr != nil {
						return routeResult{}, bodyErr
					}
					result, err = s.directory.ConsoleCreateUser(r.Context(), body, directoryapp.ConsoleMutationMeta{
						IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
						ActorID: actorUID, ActorType: "human",
					})
				}
			case path == "/v1/console/directory/users/batch":
				body, bodyErr := readJSONBody(r)
				if bodyErr != nil {
					return routeResult{}, bodyErr
				}
				rawUIDs, ok := body["uids"].([]any)
				if !ok {
					return routeResult{}, httperror.New(http.StatusBadRequest, "directory_uids_invalid", "uids array is required")
				}
				uids := make([]string, 0, len(rawUIDs))
				for _, raw := range rawUIDs {
					uids = append(uids, strings.TrimSpace(fmt.Sprint(raw)))
				}
				result, err = s.directory.ConsoleBatchUsers(r.Context(), uids)
			case path == "/v1/console/directory/user-departments":
				result, err = s.directory.ConsoleUserDepartments(r.Context(), r.URL.Query().Get("uid"))
			case path == "/v1/console/directory/accessible-departments":
				result, err = s.directory.ConsoleAccessibleDepartments(r.Context(), r.URL.Query().Get("uid"))
			case strings.HasPrefix(path, "/v1/console/directory/users/"):
				suffix := strings.TrimPrefix(path, "/v1/console/directory/users/")
				isProjects := strings.HasSuffix(suffix, "/projects")
				uidPart := strings.TrimSuffix(suffix, "/projects")
				uid, decodeErr := url.PathUnescape(uidPart)
				if decodeErr != nil || uid == "" || strings.Contains(uid, "/") {
					return routeResult{}, httperror.New(http.StatusBadRequest, "directory_uid_invalid", "Directory uid is invalid")
				}
				if isProjects {
					result, err = s.directory.ConsoleUserProjects(r.Context(), uid, r.URL.Query())
				} else if r.Method == http.MethodPatch {
					actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
					if actorErr != nil {
						return routeResult{}, actorErr
					}
					body, bodyErr := readJSONBody(r)
					if bodyErr != nil {
						return routeResult{}, bodyErr
					}
					result, err = s.directory.ConsoleUpdateUser(r.Context(), uid, body, directoryapp.ConsoleMutationMeta{
						IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
						ActorID: actorUID, ActorType: "human",
					})
				} else {
					result, err = s.directory.ConsoleUser(r.Context(), uid, r.URL.Query().Get("includeInactive") == "true")
				}
			case path == "/v1/console/directory/departments":
				if r.Method == http.MethodGet {
					result, err = s.directory.ConsoleDepartments(r.Context(), r.URL.Query())
				} else {
					actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
					if actorErr != nil {
						return routeResult{}, actorErr
					}
					body, bodyErr := readJSONBody(r)
					if bodyErr != nil {
						return routeResult{}, bodyErr
					}
					result, err = s.directory.ConsoleCreateDepartment(r.Context(), body, false, directoryapp.ConsoleMutationMeta{
						IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
						ActorID: actorUID, ActorType: "human",
					})
				}
			case path == "/v1/console/directory/hr-sources/dingtalk/department-mappings":
				if r.Method == http.MethodGet {
					result, err = s.directory.ConsolePreviewDingTalkDepartmentMappings(r.Context())
				} else {
					body, bodyErr := readJSONBody(r)
					if bodyErr != nil {
						return routeResult{}, bodyErr
					}
					if contextErr := injectTrustedServiceCommandContext(r, authCtx, body); contextErr != nil {
						return routeResult{}, contextErr
					}
					actorUID, actorErr := trustedConsoleServiceCommandActor(r, authCtx)
					if actorErr != nil {
						return routeResult{}, actorErr
					}
					result, err = s.directory.ConsoleApplyDingTalkDepartmentMappings(r.Context(), body,
						directoryapp.ConsoleMutationMeta{
							IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
							ActorID: actorUID, ActorType: "human",
						})
				}
			case path == "/v1/console/directory/hr-sources/dingtalk/department-changes":
				if r.Method == http.MethodGet {
					result, err = s.directory.ConsoleDingTalkDepartmentSnapshotChanges(r.Context())
				} else {
					body, bodyErr := readJSONBody(r)
					if bodyErr != nil {
						return routeResult{}, bodyErr
					}
					if contextErr := injectTrustedServiceCommandContext(r, authCtx, body); contextErr != nil {
						return routeResult{}, contextErr
					}
					actorUID, actorErr := trustedConsoleServiceCommandActor(r, authCtx)
					if actorErr != nil {
						return routeResult{}, actorErr
					}
					result, err = s.directory.ConsoleApplyDingTalkDepartmentSnapshotChanges(r.Context(), body,
						directoryapp.ConsoleMutationMeta{
							IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
							ActorID: actorUID, ActorType: "human",
						})
				}
			case strings.HasPrefix(path, "/v1/console/directory/departments/"):
				suffix := strings.TrimPrefix(path, "/v1/console/directory/departments/")
				isMembers := strings.HasSuffix(suffix, "/members")
				codePart := strings.TrimSuffix(suffix, "/members")
				code, decodeErr := url.PathUnescape(codePart)
				if decodeErr != nil || code == "" || strings.Contains(code, "/") {
					return routeResult{}, httperror.New(http.StatusBadRequest, "directory_department_code_invalid", "Department code is invalid")
				}
				if isMembers {
					result, err = s.directory.ConsoleDepartmentMembers(r.Context(), code, r.URL.Query())
				} else if r.Method == http.MethodPatch {
					actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
					if actorErr != nil {
						return routeResult{}, actorErr
					}
					body, bodyErr := readJSONBody(r)
					if bodyErr != nil {
						return routeResult{}, bodyErr
					}
					result, err = s.directory.ConsoleUpdateDepartment(r.Context(), code, body, false, directoryapp.ConsoleMutationMeta{
						IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
						ActorID: actorUID, ActorType: "human",
					})
				} else if r.Method == http.MethodDelete {
					actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
					if actorErr != nil {
						return routeResult{}, actorErr
					}
					result, err = s.directory.ConsoleDeleteDepartment(r.Context(), code, false, directoryapp.ConsoleMutationMeta{
						IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
						ActorID: actorUID, ActorType: "human",
					})
				} else {
					result, err = s.directory.ConsoleDepartment(r.Context(), code)
				}
			case path == "/v1/console/directory/committees":
				if r.Method == http.MethodGet {
					result, err = s.directory.ConsoleCommittees(r.Context(), r.URL.Query())
				} else {
					actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
					if actorErr != nil {
						return routeResult{}, actorErr
					}
					body, bodyErr := readJSONBody(r)
					if bodyErr != nil {
						return routeResult{}, bodyErr
					}
					result, err = s.directory.ConsoleCreateDepartment(r.Context(), body, true, directoryapp.ConsoleMutationMeta{
						IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
						ActorID: actorUID, ActorType: "human",
					})
				}
			case strings.HasPrefix(path, "/v1/console/directory/committees/"):
				suffix := strings.TrimPrefix(path, "/v1/console/directory/committees/")
				parts := strings.Split(suffix, "/")
				code, decodeErr := url.PathUnescape(parts[0])
				if decodeErr != nil || code == "" || len(parts) > 3 ||
					(len(parts) > 1 && parts[1] != "members") {
					return routeResult{}, httperror.New(http.StatusBadRequest, "directory_committee_code_invalid", "Committee code is invalid")
				}
				isMembers := len(parts) == 2 && parts[1] == "members"
				isMember := len(parts) == 3 && parts[1] == "members"
				if isMember {
					uid, uidErr := url.PathUnescape(parts[2])
					if uidErr != nil || uid == "" || r.Method != http.MethodDelete {
						return routeResult{}, httperror.New(http.StatusBadRequest, "directory_committee_member_invalid", "Committee member path is invalid")
					}
					actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
					if actorErr != nil {
						return routeResult{}, actorErr
					}
					result, err = s.directory.ConsoleRemoveCommitteeMember(r.Context(), code, uid, directoryapp.ConsoleMutationMeta{
						IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
						ActorID: actorUID, ActorType: "human",
					})
				} else if isMembers {
					if r.Method == http.MethodGet {
						result, err = s.directory.ConsoleCommitteeMembers(r.Context(), code, r.URL.Query())
					} else {
						actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
						if actorErr != nil {
							return routeResult{}, actorErr
						}
						body, bodyErr := readJSONBody(r)
						if bodyErr != nil {
							return routeResult{}, bodyErr
						}
						result, err = s.directory.ConsoleSaveCommitteeMembers(r.Context(), code, body, directoryapp.ConsoleMutationMeta{
							IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
							ActorID: actorUID, ActorType: "human",
						})
					}
				} else if r.Method == http.MethodPatch {
					actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
					if actorErr != nil {
						return routeResult{}, actorErr
					}
					body, bodyErr := readJSONBody(r)
					if bodyErr != nil {
						return routeResult{}, bodyErr
					}
					result, err = s.directory.ConsoleUpdateDepartment(r.Context(), code, body, true, directoryapp.ConsoleMutationMeta{
						IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
						ActorID: actorUID, ActorType: "human",
					})
				} else if r.Method == http.MethodDelete {
					actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
					if actorErr != nil {
						return routeResult{}, actorErr
					}
					result, err = s.directory.ConsoleDeleteDepartment(r.Context(), code, true, directoryapp.ConsoleMutationMeta{
						IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
						ActorID: actorUID, ActorType: "human",
					})
				} else {
					result, err = s.directory.ConsoleCommittee(r.Context(), code)
				}
			case path == "/v1/console/directory/projects":
				if r.Method == http.MethodGet {
					result, err = s.directory.ConsoleProjects(r.Context(), r.URL.Query())
				} else {
					actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
					if actorErr != nil {
						return routeResult{}, actorErr
					}
					body, bodyErr := readJSONBody(r)
					if bodyErr != nil {
						return routeResult{}, bodyErr
					}
					result, err = s.directory.ConsoleCreateProject(r.Context(), body, directoryapp.ConsoleMutationMeta{
						IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
						ActorID: actorUID, ActorType: "human",
					})
				}
			case strings.HasPrefix(path, "/v1/console/directory/projects/"):
				suffix := strings.TrimPrefix(path, "/v1/console/directory/projects/")
				isMembers := strings.HasSuffix(suffix, "/members")
				codePart := strings.TrimSuffix(suffix, "/members")
				code, codeErr := decodeConsoleDirectoryProjectCode(codePart)
				if codeErr != nil {
					return routeResult{}, codeErr
				}
				if isMembers {
					if r.Method == http.MethodGet {
						result, err = s.directory.ConsoleProjectMembers(r.Context(), code, r.URL.Query())
					} else {
						actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
						if actorErr != nil {
							return routeResult{}, actorErr
						}
						body, bodyErr := readJSONBody(r)
						if bodyErr != nil {
							return routeResult{}, bodyErr
						}
						result, err = s.directory.ConsoleReplaceProjectMembers(r.Context(), code, body, directoryapp.ConsoleMutationMeta{
							IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
							ActorID: actorUID, ActorType: "human",
						})
					}
				} else if r.Method == http.MethodPatch {
					actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
					if actorErr != nil {
						return routeResult{}, actorErr
					}
					body, bodyErr := readJSONBody(r)
					if bodyErr != nil {
						return routeResult{}, bodyErr
					}
					result, err = s.directory.ConsoleUpdateProject(r.Context(), code, body, directoryapp.ConsoleMutationMeta{
						IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
						ActorID: actorUID, ActorType: "human",
					})
				} else if r.Method == http.MethodDelete {
					actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
					if actorErr != nil {
						return routeResult{}, actorErr
					}
					result, err = s.directory.ConsoleDeleteProject(r.Context(), code, directoryapp.ConsoleMutationMeta{
						IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
						ActorID: actorUID, ActorType: "human",
					})
				} else {
					result, err = s.directory.ConsoleProject(r.Context(), code)
				}
			case path == "/v1/console/directory/subjects/export":
				result, err = s.directory.ConsoleSubjectExports(r.Context(), r.URL.Query())
			case path == "/v1/console/directory/subjects/memberships":
				result, err = s.directory.ConsoleSubjectMemberships(r.Context(), r.URL.Query())
			case path == "/v1/console/directory/sync-jobs":
				if r.Method == http.MethodGet {
					result, err = s.directory.ConsoleDirectorySyncJobs(r.Context(), r.URL.Query())
				} else {
					actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
					if actorErr != nil {
						return routeResult{}, actorErr
					}
					body, bodyErr := readJSONBody(r)
					if bodyErr != nil {
						return routeResult{}, bodyErr
					}
					result, err = s.directory.ConsoleStartSubjectSync(r.Context(), body,
						directoryapp.ConsoleMutationMeta{
							IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
							ActorID: actorUID, ActorType: "human",
						}, authCtx.Deployment)
				}
			case r.Method == http.MethodPost && path == "/v1/console/directory/sync-jobs/dingtalk-profile":
				actorUID, actorErr := trustedConsoleMutationActor(r, authCtx)
				if actorErr != nil {
					return routeResult{}, actorErr
				}
				body, bodyErr := readJSONBody(r)
				if bodyErr != nil {
					return routeResult{}, bodyErr
				}
				result, err = s.directory.ConsoleRegisterDingTalkProfileJob(r.Context(), body,
					directoryapp.ConsoleMutationMeta{
						IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
						ActorID: actorUID, ActorType: "human",
					})
			case strings.HasPrefix(path, "/v1/console/directory/sync-jobs/"):
				suffix := strings.TrimPrefix(path, "/v1/console/directory/sync-jobs/")
				isEvents := strings.HasSuffix(suffix, "/events")
				codePart := strings.TrimSuffix(suffix, "/events")
				jobCode, decodeErr := url.PathUnescape(codePart)
				if decodeErr != nil || jobCode == "" || strings.Contains(jobCode, "/") {
					return routeResult{}, httperror.New(http.StatusBadRequest, "directory_sync_job_invalid", "Directory sync job code is invalid")
				}
				if isEvents {
					result, err = s.directory.ConsoleDirectorySyncEvents(r.Context(), jobCode, r.URL.Query())
				} else {
					result, err = s.directory.ConsoleDirectorySyncJob(r.Context(), jobCode)
				}
			}
			if err == nil && (r.Method == http.MethodGet || path == "/v1/console/directory/users/batch") {
				result = map[string]any{"code": 0, "data": result}
			}
			return routeResult{Operation: operation, Auth: &authCtx, Body: result}, err
		}
	}

	if r.Method == http.MethodGet && path == "/v1/console/profile" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode:       "console",
			Scope:         "console:org-profile:view",
			SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.Profile(r.Context())
		return routeResult{
			Operation: "console.profile.read",
			Auth:      &authCtx,
			Body:      body,
		}, err
	}

	if r.Method == http.MethodPut && path == "/v1/console/profile" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode:       "console",
			Scope:         "console:org-profile:edit",
			SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		actorUID, _, actorPurpose, delegated := runtimeSignedActorContext(r)
		if !delegated || actorUID == "" || actorUID == strings.TrimSpace(authCtx.Subject) || actorPurpose != "" {
			return routeResult{}, httperror.New(http.StatusForbidden, "trusted_console_actor_required", "Trusted Console user actor delegation is required")
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		result, err := adapter.UpdateProfile(r.Context(), consoleapp.UpdateProfileInput{
			Body:           body,
			IdempotencyKey: r.Header.Get("Idempotency-Key"),
			RequestID:      requestID(r),
			ActorID:        actorUID,
		})
		return routeResult{
			Operation: "console.profile.update",
			Auth:      &authCtx,
			Body:      result,
		}, err
	}

	if r.Method == http.MethodGet && (path == "/v1/console/settings/catalog" || path == "/v1/console/settings/values") {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode:       "console",
			Scope:         "console:system-setting:view",
			SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		var body map[string]any
		if path == "/v1/console/settings/catalog" {
			body, err = adapter.SettingCatalogs(r.Context(), r.URL.Query())
		} else {
			body, err = adapter.SettingValues(r.Context(), r.URL.Query())
		}
		return routeResult{
			Operation: "console.settings.read",
			Auth:      &authCtx,
			Body:      body,
		}, err
	}

	if r.Method == http.MethodPut &&
		(strings.HasPrefix(path, "/v1/console/settings/values/") ||
			strings.HasPrefix(path, "/v1/console/settings/managed-values/")) {
		managed := strings.HasPrefix(path, "/v1/console/settings/managed-values/")
		scope := "console:system-setting:edit"
		prefix := "/v1/console/settings/values/"
		if managed {
			scope = "console:system-setting:manage"
			prefix = "/v1/console/settings/managed-values/"
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode:       "console",
			Scope:         scope,
			SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		actorUID, _, actorPurpose, delegated := runtimeSignedActorContext(r)
		if !delegated || actorUID == "" || actorUID == strings.TrimSpace(authCtx.Subject) || actorPurpose != "" {
			return routeResult{}, httperror.New(http.StatusForbidden, "trusted_console_actor_required", "Trusted Console user actor delegation is required")
		}
		settingKey, err := url.PathUnescape(strings.TrimPrefix(path, prefix))
		if err != nil || settingKey == "" || strings.Contains(settingKey, "/") {
			return routeResult{}, httperror.New(http.StatusBadRequest, "invalid_setting_key", "Invalid settingKey")
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		meta := consoleapp.MutationMeta{
			IdempotencyKey: r.Header.Get("Idempotency-Key"),
			RequestID:      requestID(r),
			ActorID:        actorUID,
		}
		var result map[string]any
		if managed {
			result, err = adapter.UpdateManagedSetting(r.Context(), settingKey, body, meta)
		} else {
			result, err = adapter.UpdateSetting(r.Context(), settingKey, body, meta)
		}
		operation := "console.settings.update"
		if managed {
			operation = "console.settings.managed-update"
		}
		return routeResult{
			Operation: operation,
			Auth:      &authCtx,
			Body:      result,
		}, err
	}

	if path == "/v1/console/business-domains" && (r.Method == http.MethodGet || r.Method == http.MethodPost) {
		scope := "console:business-domain:view"
		if r.Method == http.MethodPost {
			scope = "console:business-domain:edit"
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "console", Scope: scope, SourceAppCode: "console"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		if r.Method == http.MethodGet {
			result, err := adapter.BusinessDomains(r.Context(), r.URL.Query())
			return routeResult{Operation: "console.business-domains.read", Auth: &authCtx, Body: result}, err
		}
		actorUID, err := trustedConsoleMutationActor(r, authCtx)
		if err != nil {
			return routeResult{}, err
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		result, err := adapter.CreateBusinessDomains(r.Context(), body, consoleapp.MutationMeta{
			IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r), ActorID: actorUID,
		})
		return routeResult{Operation: "console.business-domains.create", Auth: &authCtx, Body: result}, err
	}

	if strings.HasPrefix(path, "/v1/console/business-domains/") && (r.Method == http.MethodPatch || r.Method == http.MethodDelete) {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: "console:business-domain:edit", SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		actorUID, err := trustedConsoleMutationActor(r, authCtx)
		if err != nil {
			return routeResult{}, err
		}
		code, err := url.PathUnescape(strings.TrimPrefix(path, "/v1/console/business-domains/"))
		if err != nil || code == "" || strings.Contains(code, "/") {
			return routeResult{}, httperror.New(http.StatusBadRequest, "organization_code_invalid", "Invalid domainCode")
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		meta := consoleapp.MutationMeta{
			IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r), ActorID: actorUID,
		}
		var result map[string]any
		if r.Method == http.MethodPatch {
			result, err = adapter.UpdateBusinessDomain(r.Context(), code, body, meta)
		} else {
			result, err = adapter.DeleteBusinessDomain(r.Context(), code, body, meta)
		}
		return routeResult{Operation: "console.business-domains.mutate", Auth: &authCtx, Body: result}, err
	}

	if path == "/v1/console/regions" && (r.Method == http.MethodGet || r.Method == http.MethodPost) {
		scope := "console:region:view"
		if r.Method == http.MethodPost {
			scope = "console:region:edit"
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "console", Scope: scope, SourceAppCode: "console"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		if r.Method == http.MethodGet {
			result, err := adapter.Regions(r.Context(), r.URL.Query())
			return routeResult{Operation: "console.regions.read", Auth: &authCtx, Body: result}, err
		}
		actorUID, err := trustedConsoleMutationActor(r, authCtx)
		if err != nil {
			return routeResult{}, err
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		result, err := adapter.CreateRegion(r.Context(), body, r.URL.Query().Get("fromTemplate") == "STANDARD_7", consoleapp.MutationMeta{
			IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r), ActorID: actorUID,
		})
		return routeResult{Operation: "console.regions.create", Auth: &authCtx, Body: result}, err
	}

	if strings.HasPrefix(path, "/v1/console/regions/") {
		suffix := strings.TrimPrefix(path, "/v1/console/regions/")
		isDivisions := strings.HasSuffix(suffix, "/divisions")
		codePart := strings.TrimSuffix(suffix, "/divisions")
		code, err := url.PathUnescape(codePart)
		if err != nil || code == "" || strings.Contains(code, "/") {
			return routeResult{}, httperror.New(http.StatusBadRequest, "organization_code_invalid", "Invalid regionCode")
		}
		readOperation := (isDivisions && r.Method == http.MethodGet)
		writeOperation := (!isDivisions && (r.Method == http.MethodPatch || r.Method == http.MethodDelete)) || (isDivisions && r.Method == http.MethodPut)
		if readOperation || writeOperation {
			scope := "console:region:view"
			if writeOperation {
				scope = "console:region:edit"
			}
			authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "console", Scope: scope, SourceAppCode: "console"})
			if err != nil {
				return routeResult{}, err
			}
			adapter, err := s.requireConsole()
			if err != nil {
				return routeResult{}, err
			}
			if readOperation {
				result, err := adapter.RegionDivisions(r.Context(), code)
				return routeResult{Operation: "console.region-divisions.read", Auth: &authCtx, Body: result}, err
			}
			actorUID, err := trustedConsoleMutationActor(r, authCtx)
			if err != nil {
				return routeResult{}, err
			}
			body, err := readJSONBody(r)
			if err != nil {
				return routeResult{}, err
			}
			meta := consoleapp.MutationMeta{
				IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r), ActorID: actorUID,
			}
			var result map[string]any
			switch {
			case isDivisions:
				result, err = adapter.ReplaceRegionDivisions(r.Context(), code, body, meta)
			case r.Method == http.MethodPatch:
				result, err = adapter.UpdateRegion(r.Context(), code, body, meta)
			default:
				result, err = adapter.DeleteRegion(r.Context(), code, body, meta)
			}
			return routeResult{Operation: "console.regions.mutate", Auth: &authCtx, Body: result}, err
		}
	}

	if r.Method == http.MethodGet && path == "/v1/console/service/work-calendar/month" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: "console:work-calendar:view", SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		result, err := adapter.WorkCalendarMonth(r.Context(), r.URL.Query())
		return routeResult{Operation: "console.work-calendar.month.read", Auth: &authCtx, Body: result}, err
	}

	if r.Method == http.MethodGet && path == "/v1/console/work-calendars" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: "console:work-calendar:view", SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		result, err := adapter.WorkCalendars(r.Context())
		return routeResult{Operation: "console.work-calendars.read", Auth: &authCtx, Body: result}, err
	}

	if r.Method == http.MethodPost && path == "/v1/console/work-calendars/import-year" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: "console:work-calendar:import", SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		actorUID, err := trustedConsoleMutationActor(r, authCtx)
		if err != nil {
			return routeResult{}, err
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		result, err := adapter.ImportWorkCalendarYear(r.Context(), body, consoleapp.MutationMeta{
			IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r), ActorID: actorUID,
		})
		return routeResult{Operation: "console.work-calendars.import", Auth: &authCtx, Body: result}, err
	}

	if strings.HasPrefix(path, "/v1/console/work-calendars/") {
		suffix := strings.TrimPrefix(path, "/v1/console/work-calendars/")
		parts := strings.Split(suffix, "/")
		if len(parts) >= 2 {
			code, codeErr := url.PathUnescape(parts[0])
			if codeErr != nil || code == "" {
				return routeResult{}, httperror.New(http.StatusBadRequest, "calendar_code_invalid", "Invalid calendarCode")
			}
			isMonthsRead := len(parts) == 2 && parts[1] == "months" && r.Method == http.MethodGet
			isDaysRead := len(parts) == 2 && parts[1] == "days" && r.Method == http.MethodGet
			isDayUpdate := len(parts) == 3 && parts[1] == "days" && r.Method == http.MethodPatch
			if isMonthsRead || isDaysRead || isDayUpdate {
				scope := "console:work-calendar:view"
				if isDayUpdate {
					scope = "console:work-calendar:edit"
				}
				authCtx, err := s.auth.Authenticate(r, auth.Requirement{
					AppCode: "console", Scope: scope, SourceAppCode: "console",
				})
				if err != nil {
					return routeResult{}, err
				}
				adapter, err := s.requireConsole()
				if err != nil {
					return routeResult{}, err
				}
				if isMonthsRead {
					result, err := adapter.WorkCalendarMonths(r.Context(), code, r.URL.Query())
					return routeResult{Operation: "console.work-calendar.months.read", Auth: &authCtx, Body: result}, err
				}
				if isDaysRead {
					result, err := adapter.WorkCalendarDays(r.Context(), code, r.URL.Query())
					return routeResult{Operation: "console.work-calendar.days.read", Auth: &authCtx, Body: result}, err
				}
				actorUID, err := trustedConsoleMutationActor(r, authCtx)
				if err != nil {
					return routeResult{}, err
				}
				workDate, err := url.PathUnescape(parts[2])
				if err != nil {
					return routeResult{}, httperror.New(http.StatusBadRequest, "work_date_invalid", "Invalid workDate")
				}
				body, err := readJSONBody(r)
				if err != nil {
					return routeResult{}, err
				}
				result, err := adapter.UpdateWorkCalendarDay(r.Context(), code, workDate, body, consoleapp.MutationMeta{
					IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r), ActorID: actorUID,
				})
				return routeResult{Operation: "console.work-calendar.day.update", Auth: &authCtx, Body: result}, err
			}
		}
	}

	if path == "/v1/console/vault/secrets" &&
		(r.Method == http.MethodGet || r.Method == http.MethodPost) {
		scope := "console:vault-secret:view"
		if r.Method == http.MethodPost {
			scope = "console:vault-secret:edit"
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: scope, SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		if r.Method == http.MethodGet {
			result, readErr := adapter.ListVaultSecrets(r.Context(), r.URL.Query())
			if readErr == nil {
				result = map[string]any{"code": 0, "data": result}
			}
			return routeResult{Operation: "console.vault.secrets.read", Auth: &authCtx, Body: result}, readErr
		}
		actorUID, err := trustedConsoleMutationActor(r, authCtx)
		if err != nil {
			return routeResult{}, err
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		result, err := adapter.CreateVaultSecret(r.Context(), body, consoleapp.MutationMeta{
			IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r), ActorID: actorUID,
		})
		if err == nil {
			result = map[string]any{"code": 0, "data": result}
		}
		return routeResult{Operation: "console.vault.secret.create", Auth: &authCtx, Body: result}, err
	}

	if r.Method == http.MethodPost && strings.HasPrefix(path, "/v1/console/vault/secrets/") {
		suffix := strings.TrimPrefix(path, "/v1/console/vault/secrets/")
		parts := strings.Split(suffix, "/")
		if len(parts) == 2 && (parts[1] == "versions" || parts[1] == "rotate" || parts[1] == "reveal") {
			secretCode, decodeErr := url.PathUnescape(parts[0])
			if decodeErr != nil || secretCode == "" || strings.Contains(secretCode, "/") {
				return routeResult{}, httperror.New(http.StatusBadRequest, "console_vault_secret_code_invalid", "Vault secretCode is invalid")
			}
			scope := "console:vault-secret:edit"
			if parts[1] == "reveal" {
				scope = "console:vault-secret:reveal"
			}
			authCtx, err := s.auth.Authenticate(r, auth.Requirement{
				AppCode: "console", Scope: scope, SourceAppCode: "console",
			})
			if err != nil {
				return routeResult{}, err
			}
			actorUID, err := trustedConsoleMutationActor(r, authCtx)
			if err != nil {
				return routeResult{}, err
			}
			body, err := readJSONBody(r)
			if err != nil {
				return routeResult{}, err
			}
			adapter, err := s.requireConsole()
			if err != nil {
				return routeResult{}, err
			}
			var result map[string]any
			switch parts[1] {
			case "versions":
				result, err = adapter.AddVaultSecretVersion(r.Context(), secretCode, body, false, consoleapp.MutationMeta{
					IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r), ActorID: actorUID,
				})
			case "rotate":
				result, err = adapter.AddVaultSecretVersion(r.Context(), secretCode, body, true, consoleapp.MutationMeta{
					IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r), ActorID: actorUID,
				})
			default:
				reason := strings.TrimSpace(fmt.Sprint(body["reason"]))
				if reason == "" || reason == "<nil>" {
					return routeResult{}, httperror.New(http.StatusBadRequest, "console_vault_reveal_reason_required", "Vault reveal reason is required")
				}
				result, err = adapter.RevealVaultSecret(r.Context(), secretCode, body["versionNo"], consoleapp.VaultAccessMeta{
					ActorType: "human", ActorID: actorUID, AppCode: "console",
					RequestIP: trustedRequestIP(r), UserAgent: strings.TrimSpace(r.UserAgent()),
					Reason: reason, ApprovalCode: strings.TrimSpace(stringFromAny(body["approvalCode"])),
				})
			}
			if err == nil {
				result = map[string]any{"code": 0, "data": result}
			}
			return routeResult{Operation: "console.vault.secret." + parts[1], Auth: &authCtx, Body: result}, err
		}
	}

	if r.Method == http.MethodGet && (path == "/v1/console/audit/operation-logs" || path == "/v1/console/audit/login-logs" || path == "/v1/console/audit/lifecycle-metrics") {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: "console:audit:view", SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		var result map[string]any
		switch path {
		case "/v1/console/audit/operation-logs":
			result, err = adapter.OperationLogs(r.Context(), r.URL.Query())
		case "/v1/console/audit/login-logs":
			result, err = adapter.LoginLogs(r.Context(), r.URL.Query())
		default:
			result, err = adapter.LifecycleAuditMetrics(r.Context(), r.URL.Query())
		}
		return routeResult{Operation: "console.audit.read", Auth: &authCtx, Body: result}, err
	}

	if r.Method == http.MethodPost && (path == "/v1/console/audit/operation-logs" || path == "/v1/console/audit/login-logs") {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: "console:audit:write", SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		sourceApp := strings.TrimSpace(authCtx.AppCode)
		actorID := strings.TrimSpace(authCtx.Subject)
		if path == "/v1/console/audit/operation-logs" {
			sourceApp = strings.TrimSpace(fmt.Sprint(body["verifiedSourceApp"]))
			actorID = strings.TrimSpace(fmt.Sprint(body["verifiedActorId"]))
			delete(body, "verifiedSourceApp")
			delete(body, "verifiedActorId")
		} else {
			// Login audit source and service actor are authenticated token claims.
			// Never accept caller-projected "verified" identity fields here.
			delete(body, "verifiedSourceApp")
			delete(body, "verifiedActorId")
		}
		if sourceApp == "" || sourceApp == "<nil>" || actorID == "" || actorID == "<nil>" {
			return routeResult{}, httperror.New(http.StatusForbidden, "trusted_audit_service_required", "Trusted audit service context is required")
		}
		meta := consoleapp.AuditMutationMeta{
			IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
			ActorType: "service", ActorID: actorID, SourceApp: sourceApp,
		}
		var result map[string]any
		if path == "/v1/console/audit/operation-logs" {
			result, err = adapter.AppendOperationLog(r.Context(), body, meta)
		} else {
			result, err = adapter.AppendLoginLog(r.Context(), body, meta)
		}
		return routeResult{Operation: "console.audit.append", Auth: &authCtx, Body: result}, err
	}

	if r.Method == http.MethodPost && path == "/v1/console/audit/human-operation-logs" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: "console:audit:write", SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		actorUID, err := trustedConsoleMutationActor(r, authCtx)
		if err != nil {
			return routeResult{}, err
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		result, err := adapter.AppendOperationLog(r.Context(), body, consoleapp.AuditMutationMeta{
			IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r),
			ActorType: "human", ActorID: actorUID,
		})
		return routeResult{Operation: "console.audit.human-operation.append", Auth: &authCtx, Body: result}, err
	}

	if strings.HasPrefix(path, "/v1/console/platform-lifecycle/") {
		scope := "console:platform-lifecycle:view"
		if r.Method == http.MethodPost {
			scope = "console:platform-lifecycle:execute"
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: scope, SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		switch {
		case path == "/v1/console/platform-lifecycle/operations" && r.Method == http.MethodGet:
			if _, actorErr := trustedConsoleMutationActor(r, authCtx); actorErr != nil {
				return routeResult{}, actorErr
			}
			result, runtimeErr := adapter.PlatformLifecycleOperations(
				r.Context(), authCtx.Tenant, authCtx.Deployment, r.URL.Query(),
			)
			return routeResult{Operation: "console.platform-lifecycle.operations", Auth: &authCtx, Body: result}, runtimeErr
		case strings.HasPrefix(path, "/v1/console/platform-lifecycle/operations/") &&
			strings.HasSuffix(path, "/attempts") && r.Method == http.MethodGet:
			if _, actorErr := trustedConsoleMutationActor(r, authCtx); actorErr != nil {
				return routeResult{}, actorErr
			}
			operationID := strings.TrimSuffix(strings.TrimPrefix(
				path, "/v1/console/platform-lifecycle/operations/",
			), "/attempts")
			result, runtimeErr := adapter.PlatformLifecycleAttempts(
				r.Context(), authCtx.Tenant, authCtx.Deployment, operationID,
			)
			return routeResult{Operation: "console.platform-lifecycle.attempts", Auth: &authCtx, Body: result}, runtimeErr
		case path == "/v1/console/platform-lifecycle/drain/claim" && r.Method == http.MethodPost:
			result, runtimeErr := adapter.ClaimPlatformLifecycleOperation(
				r.Context(), authCtx.Tenant, authCtx.Deployment,
			)
			return routeResult{Operation: "console.platform-lifecycle.claim", Auth: &authCtx, Body: result}, runtimeErr
		case path == "/v1/console/platform-lifecycle/drain/checkpoint" && r.Method == http.MethodPost:
			body, bodyErr := readJSONBody(r)
			if bodyErr != nil {
				return routeResult{}, bodyErr
			}
			result, runtimeErr := adapter.CheckpointPlatformLifecycleOperation(
				r.Context(), authCtx.Tenant, authCtx.Deployment, body,
			)
			return routeResult{Operation: "console.platform-lifecycle.checkpoint", Auth: &authCtx, Body: result}, runtimeErr
		case path == "/v1/console/platform-lifecycle/actionables/prepare" && r.Method == http.MethodPost:
			body, bodyErr := readJSONBody(r)
			if bodyErr != nil {
				return routeResult{}, bodyErr
			}
			limit := 10
			if value, ok := body["limit"].(float64); ok {
				limit = int(value)
			}
			result, runtimeErr := adapter.PreparePlatformLifecycleActionables(
				r.Context(), authCtx.Tenant, authCtx.Deployment, limit,
			)
			return routeResult{Operation: "console.platform-lifecycle.actionables.prepare", Auth: &authCtx, Body: result}, runtimeErr
		case path == "/v1/console/platform-lifecycle/actionables/checkpoint" && r.Method == http.MethodPost:
			body, bodyErr := readJSONBody(r)
			if bodyErr != nil {
				return routeResult{}, bodyErr
			}
			result, runtimeErr := adapter.CheckpointPlatformLifecycleActionable(
				r.Context(), authCtx.Tenant, authCtx.Deployment, body,
			)
			return routeResult{Operation: "console.platform-lifecycle.actionables.checkpoint", Auth: &authCtx, Body: result}, runtimeErr
		case path == "/v1/console/platform-lifecycle/dead-letter-retry-source" && r.Method == http.MethodGet:
			if _, actorErr := trustedConsoleMutationActor(r, authCtx); actorErr != nil {
				return routeResult{}, actorErr
			}
			result, runtimeErr := adapter.PlatformLifecycleRetrySource(
				r.Context(), authCtx.Tenant, authCtx.Deployment,
				r.URL.Query().Get("uid"), r.URL.Query().Get("phase"),
			)
			return routeResult{Operation: "console.platform-lifecycle.retry-source", Auth: &authCtx, Body: result}, runtimeErr
		case path == "/v1/console/platform-lifecycle/dead-letter-retry-cancel" && r.Method == http.MethodPost:
			if _, actorErr := trustedConsoleMutationActor(r, authCtx); actorErr != nil {
				return routeResult{}, actorErr
			}
			body, bodyErr := readJSONBody(r)
			if bodyErr != nil {
				return routeResult{}, bodyErr
			}
			result, runtimeErr := adapter.CancelPlatformLifecycleRetry(
				r.Context(), authCtx.Tenant, authCtx.Deployment, body,
			)
			return routeResult{Operation: "console.platform-lifecycle.retry-cancel", Auth: &authCtx, Body: result}, runtimeErr
		default:
			return routeResult{}, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
	}

	if path == "/v1/console/runtime/clipboard" ||
		path == "/v1/console/runtime/presence/heartbeat" ||
		path == "/v1/console/runtime/presence/online" {
		scope := "console:runtime-compat:manage"
		if r.Method == http.MethodGet {
			scope = "console:runtime-compat:read"
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: scope, SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		switch {
		case path == "/v1/console/runtime/clipboard" && r.Method == http.MethodGet:
			uid, actorErr := trustedConsoleMutationActor(r, authCtx)
			if actorErr != nil {
				return routeResult{}, actorErr
			}
			result, runtimeErr := adapter.RuntimeClipboard(r.Context(), uid)
			return routeResult{Operation: "console.runtime.clipboard.read", Auth: &authCtx, Body: result}, runtimeErr
		case path == "/v1/console/runtime/clipboard" && r.Method == http.MethodPut:
			uid, actorErr := trustedConsoleMutationActor(r, authCtx)
			if actorErr != nil {
				return routeResult{}, actorErr
			}
			body, bodyErr := readJSONBody(r)
			if bodyErr != nil {
				return routeResult{}, bodyErr
			}
			result, runtimeErr := adapter.SetRuntimeClipboard(r.Context(), uid, body)
			return routeResult{Operation: "console.runtime.clipboard.write", Auth: &authCtx, Body: result}, runtimeErr
		case path == "/v1/console/runtime/presence/heartbeat" && r.Method == http.MethodPost:
			uid, actorErr := trustedConsoleMutationActor(r, authCtx)
			if actorErr != nil {
				return routeResult{}, actorErr
			}
			body, bodyErr := readJSONBody(r)
			if bodyErr != nil {
				return routeResult{}, bodyErr
			}
			result, runtimeErr := adapter.WriteRuntimeHeartbeat(r.Context(), uid, body)
			return routeResult{Operation: "console.runtime.presence.heartbeat", Auth: &authCtx, Body: result}, runtimeErr
		case path == "/v1/console/runtime/presence/online" && r.Method == http.MethodGet:
			if _, actorErr := trustedConsoleMutationActor(r, authCtx); actorErr != nil {
				return routeResult{}, actorErr
			}
			result, runtimeErr := adapter.RuntimeOnlineHeartbeats(r.Context(), r.URL.Query())
			return routeResult{Operation: "console.runtime.presence.online", Auth: &authCtx, Body: result}, runtimeErr
		default:
			return routeResult{}, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
	}

	if path == "/v1/console/notifications/todos" ||
		path == "/v1/console/notifications/todos/summary" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: "console:notification:read", SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		uid, err := trustedConsoleMutationActor(r, authCtx)
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		if path == "/v1/console/notifications/todos" && r.Method == http.MethodGet {
			result, runtimeErr := adapter.UserNotificationTodos(r.Context(), uid, r.URL.Query())
			return routeResult{Operation: "console.notifications.todos", Auth: &authCtx, Body: result}, runtimeErr
		}
		if path == "/v1/console/notifications/todos/summary" && r.Method == http.MethodGet {
			result, runtimeErr := adapter.UserNotificationTodoSummary(r.Context(), uid)
			return routeResult{Operation: "console.notifications.todos.summary", Auth: &authCtx, Body: result}, runtimeErr
		}
		return routeResult{}, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
	}

	if r.Method == http.MethodPost &&
		(path == "/v1/console/notifications/publish-canonical" ||
			path == "/v1/console/notifications/actionable-lifecycle" ||
			path == "/v1/console/notifications/deliveries") {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: "console:notification:publish", SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		var result map[string]any
		var operation string
		switch path {
		case "/v1/console/notifications/publish-canonical":
			operation = "console.notifications.publish"
			result, err = adapter.PublishCanonicalNotification(r.Context(), body)
		case "/v1/console/notifications/actionable-lifecycle":
			operation = "console.notifications.actionable-lifecycle"
			result, err = adapter.AdvanceNotificationActionableLifecycle(r.Context(), body)
		default:
			operation = "console.notifications.delivery"
			result, err = adapter.RecordNotificationDelivery(r.Context(), body)
		}
		return routeResult{Operation: operation, Auth: &authCtx, Body: result}, err
	}

	if (r.Method == http.MethodGet && (path == "/v1/console/notifications" || path == "/v1/console/notifications/summary" ||
		(strings.HasPrefix(path, "/v1/console/notifications/") && strings.HasSuffix(path, "/detail-fact")))) ||
		(r.Method == http.MethodPost && path == "/v1/console/notifications/read-all") {
		scope := "console:notification:read"
		if r.Method == http.MethodPost {
			scope = "console:notification:manage"
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: scope, SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		uid, err := trustedConsoleMutationActor(r, authCtx)
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		if r.Method == http.MethodGet && path == "/v1/console/notifications" {
			result, err := adapter.UserNotifications(r.Context(), uid, r.URL.Query())
			return routeResult{Operation: "console.notifications.read", Auth: &authCtx, Body: result}, err
		}
		if r.Method == http.MethodGet && path == "/v1/console/notifications/summary" {
			result, err := adapter.UserNotificationSummary(r.Context(), uid)
			return routeResult{Operation: "console.notifications.summary", Auth: &authCtx, Body: result}, err
		}
		if r.Method == http.MethodGet {
			suffix := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/console/notifications/"), "/detail-fact")
			notificationID, decodeErr := url.PathUnescape(suffix)
			if decodeErr != nil || notificationID == "" || strings.Contains(notificationID, "/") {
				return routeResult{}, httperror.New(http.StatusBadRequest, "notification_id_invalid", "notificationId is invalid")
			}
			result, detailErr := adapter.UserNotificationDetailFact(r.Context(), uid, notificationID)
			if detailErr == nil {
				result = map[string]any{"code": 0, "data": result}
			}
			return routeResult{Operation: "console.notifications.detail-fact", Auth: &authCtx, Body: result}, detailErr
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		result, err := adapter.MarkAllNotificationsRead(r.Context(), uid, body, consoleapp.MutationMeta{
			IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r), ActorID: uid,
		})
		return routeResult{Operation: "console.notifications.read-all", Auth: &authCtx, Body: result}, err
	}

	if r.Method == http.MethodPost && strings.HasPrefix(path, "/v1/console/notifications/") {
		suffix := strings.TrimPrefix(path, "/v1/console/notifications/")
		parts := strings.Split(suffix, "/")
		if len(parts) == 2 && (parts[1] == "read" || parts[1] == "archive") {
			authCtx, err := s.auth.Authenticate(r, auth.Requirement{
				AppCode: "console", Scope: "console:notification:manage", SourceAppCode: "console",
			})
			if err != nil {
				return routeResult{}, err
			}
			uid, err := trustedConsoleMutationActor(r, authCtx)
			if err != nil {
				return routeResult{}, err
			}
			notificationID, err := url.PathUnescape(parts[0])
			if err != nil {
				return routeResult{}, httperror.New(http.StatusBadRequest, "notification_id_invalid", "notificationId is invalid")
			}
			adapter, err := s.requireConsole()
			if err != nil {
				return routeResult{}, err
			}
			meta := consoleapp.MutationMeta{
				IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r), ActorID: uid,
			}
			var result map[string]any
			if parts[1] == "read" {
				result, err = adapter.MarkNotificationRead(r.Context(), uid, notificationID, meta)
			} else {
				result, err = adapter.ArchiveNotification(r.Context(), uid, notificationID, meta)
			}
			return routeResult{Operation: "console.notifications." + parts[1], Auth: &authCtx, Body: result}, err
		}
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
				"tenant":             s.cfg.Tenant,
				"deployment":         s.cfg.Deployment,
				"runtimeCode":        s.cfg.Control.RuntimeCode,
				"deploymentBindings": s.cfg.DeploymentBindings,
				"authMode":           s.cfg.Auth.Mode,
				"apps": map[string]any{
					"console":   map[string]any{"enabled": s.console != nil},
					"directory": map[string]any{"enabled": s.directory != nil},
					"finance":   map[string]any{"enabled": s.finance != nil},
					"workflow":  map[string]any{"enabled": s.workflow != nil},
					"webdev":    map[string]any{"enabled": s.webdev != nil},
					"assets":    map[string]any{"enabled": s.assets != nil},
					"people":    map[string]any{"enabled": s.people != nil},
					"altoc":     map[string]any{"enabled": s.altoc != nil},
					"aims":      map[string]any{"enabled": s.aims != nil},
					"codocs":    map[string]any{"enabled": s.codocs != nil},
				},
			},
		}, nil
	}

	if r.Method == http.MethodGet && path == "/runtime/schema/status" {
		app := r.URL.Query().Get("app")
		if app == "" {
			app = "finance"
		}
		if app != "console" && app != "finance" && app != "workflow" && app != "webdev" && app != "assets" && app != "people" && app != "altoc" && app != "aims" && app != "codocs" {
			return routeResult{}, httperror.New(http.StatusNotFound, "app_not_supported", "Unsupported schema status app")
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: app, Scope: app + ".schema.read"})
		if err != nil {
			return routeResult{}, err
		}
		var body any
		if app == "console" && r.URL.Query().Get("mode") == "cutover" {
			adapter, requireErr := s.requireConsole()
			if requireErr != nil {
				return routeResult{}, requireErr
			}
			body, err = adapter.CutoverReadiness(r.Context(), s.consoleCutoverDeployment())
		} else {
			body, err = s.schemaStatus(r.Context(), app)
		}
		return routeResult{Operation: "runtime.schema.status", Auth: &authCtx, Body: body}, err
	}

	if path == "/v1/console/cutover/dispositions" &&
		(r.Method == http.MethodGet || r.Method == http.MethodPost) {
		scope := "console:cutover-disposition:view"
		operation := "console.cutover_disposition.list"
		if r.Method == http.MethodPost {
			scope = "console:cutover-disposition:manage"
			operation = "console.cutover_disposition.apply"
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode: "console", Scope: scope, SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		var result map[string]any
		if r.Method == http.MethodGet {
			result, err = adapter.CutoverDispositionCandidates(r.Context())
		} else {
			body, bodyErr := readJSONBody(r)
			if bodyErr != nil {
				return routeResult{}, bodyErr
			}
			result, err = adapter.ApplyCutoverDispositions(
				r.Context(),
				body,
				consoleapp.AuditMutationMeta{
					IdempotencyKey: r.Header.Get("Idempotency-Key"),
					RequestID:      requestID(r),
					ActorType:      "service",
					ActorID:        authCtx.Subject,
					SourceApp:      authCtx.AppCode,
				},
			)
		}
		if err == nil {
			result = map[string]any{"code": 0, "data": result}
		}
		return routeResult{Operation: operation, Auth: &authCtx, Body: result}, err
	}

	if r.Method == http.MethodPost &&
		strings.HasPrefix(path, "/v1/console/cutover/service-clients/") &&
		strings.HasSuffix(path, "/retire") {
		serviceClientID := strings.TrimSuffix(
			strings.TrimPrefix(path, "/v1/console/cutover/service-clients/"),
			"/retire",
		)
		if serviceClientID == "" || strings.Contains(serviceClientID, "/") {
			return routeResult{}, httperror.New(
				http.StatusNotFound,
				"cutover_service_client_route_invalid",
				"Cutover service client route is invalid",
			)
		}
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode:       "console",
			Scope:         "console:cutover-service-client:retire",
			SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		body, err := readJSONBody(r)
		if err != nil {
			return routeResult{}, err
		}
		result, err := adapter.RetireLegacyCutoverServiceClient(
			r.Context(),
			serviceClientID,
			body,
			consoleapp.AuditMutationMeta{
				IdempotencyKey: r.Header.Get("Idempotency-Key"),
				RequestID:      requestID(r),
				ActorType:      "service",
				ActorID:        authCtx.Subject,
				SourceApp:      authCtx.AppCode,
			},
		)
		if err == nil {
			result = map[string]any{"code": 0, "data": result}
		}
		return routeResult{
			Operation: "console.cutover_service_client.retire",
			Auth:      &authCtx,
			Body:      result,
		}, err
	}

	if r.Method == http.MethodPost && path == "/v1/console/admin/service-grant-repairs/aims-codocs-runtime-read" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{
			AppCode:       "console",
			Scope:         "console:service-client:grant",
			SourceAppCode: "console",
		})
		if err != nil {
			return routeResult{}, err
		}
		actorUID, err := trustedConsoleMutationActor(r, authCtx)
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireConsole()
		if err != nil {
			return routeResult{}, err
		}
		result, err := adapter.ReconcileAimsCodocsRuntimeReadGrant(r.Context(), actorUID, requestID(r))
		if err == nil {
			result = map[string]any{"code": 0, "data": result}
		}
		return routeResult{
			Operation: "console.service_grant_repair.aims_codocs_runtime_read",
			Auth:      &authCtx,
			Body:      result,
		}, err
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
		actorUID, deptCodes, err := trustedWorkflowUserActor(r, authCtx)
		if err != nil {
			return routeResult{}, err
		}
		injectRuntimeAuthBody(body, authCtx, actorUID, deptCodes)
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
		actorUID, deptCodes, err := trustedWorkflowUserActor(r, authCtx)
		if err != nil {
			return routeResult{}, err
		}
		injectRuntimeAuthBody(body, authCtx, actorUID, deptCodes)
		result, err := adapter.CreateInstance(r.Context(), body)
		return routeResult{Operation: "workflow.instances.create", Auth: &authCtx, Body: result}, err
	}

	if r.Method == http.MethodPost && path == "/v1/workflow/service/finance-invoice-approval" {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "workflow", Scope: "workflow:invoice-request:create"})
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
		actorUID, deptCodes, actorPurpose := runtimeActorContextDetails(r, authCtx)
		if actorUID == "" || actorUID == strings.TrimSpace(authCtx.Subject) || actorPurpose != "service-command" {
			return routeResult{}, httperror.New(http.StatusForbidden, "trusted_service_actor_required", "trusted service-command actor delegation is required")
		}
		if err := injectRuntimeIdempotencyBody(r, body); err != nil {
			return routeResult{}, err
		}
		injectRuntimeAuthBody(body, authCtx, actorUID, deptCodes)
		setRuntimeTrustedBody(body, authCtx, requestID(r))
		if err := injectTrustedServiceCommandContext(r, authCtx, body); err != nil {
			return routeResult{}, err
		}
		result, operation, err := adapter.HandleRuntime(r.Context(), r.Method, path, r.URL.Query(), body)
		return routeResult{Operation: operation, Auth: &authCtx, Body: result}, err
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
		actorUID, deptCodes, actorPurpose := runtimeActorContextDetails(r, authCtx)
		_, _, _, actorDelegated := runtimeSignedActorContext(r)
		if workflowRuntimeRequiresTrustedActor(path) && !actorDelegated {
			return routeResult{}, httperror.New(http.StatusForbidden, "trusted_workflow_actor_required", "trusted actor delegation is required for Workflow user paths")
		}
		query := runtimeQueryWithAuth(r.URL.Query(), authCtx, actorUID, deptCodes)
		if actorDelegated {
			query.Set("hzy_runtime_actor_delegated", "1")
		}
		setRuntimeTrustedQuery(query, authCtx, requestID(r))
		if actorPurpose != "" {
			query.Set("hzy_runtime_actor_purpose", actorPurpose)
		}
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
			setRuntimeTrustedBody(body, authCtx, requestID(r))
			if actorPurpose != "" {
				body["hzy_runtime_actor_purpose"] = actorPurpose
			}
		}
		result, operation, err := adapter.HandleRuntime(r.Context(), r.Method, path, query, body)
		if operation == "" {
			operation = "workflow.runtime"
		}
		return routeResult{Operation: operation, Auth: &authCtx, Body: result}, err
	}

	if isWebDevRuntimePath(path) {
		adapter, err := s.requireWebDev()
		if err != nil {
			return routeResult{}, err
		}
		return s.routeWebDevRuntime(r, adapter)
	}

	if r.Method == http.MethodPost {
		if worker, ok := dueNotificationWorkerForPath(path); ok {
			var adapter runtimeHandler
			var err error
			switch worker.AppCode {
			case "aims":
				adapter, err = s.requireAims()
			case "altoc":
				adapter, err = s.requireAltoc()
			case "assets":
				adapter, err = s.requireAssets()
			case "people":
				adapter, err = s.requirePeople()
			}
			if err != nil {
				return routeResult{}, err
			}
			return s.routeDueNotificationWorker(r, path, worker, adapter)
		}
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

	if r.Method == http.MethodPost && isFinanceDueNotificationRuntimePath(path) {
		authCtx, err := s.financeDueNotificationRuntimeAuth(r)
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
		if err := validateFinanceDueNotificationRuntimeBody(path, body); err != nil {
			return routeResult{}, err
		}
		setRuntimeTrustedBody(body, authCtx, requestID(r))
		body["hzy_runtime_actor_purpose"] = financeDueNotificationWorkerPurpose
		result, operation, err := adapter.HandleDueNotificationRuntime(r.Context(), path, body)
		return routeResult{Operation: operation, Auth: &authCtx, Body: result}, err
	}

	if r.Method == http.MethodPost && path == "/v1/finance/notification-details/authorize" {
		authCtx, query, err := s.financeNotificationDetailRuntimeAuth(r)
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
		result, err := adapter.AuthorizeNotificationDetail(r.Context(), query, body)
		return routeResult{Operation: "finance.notification_details.authorize", Auth: &authCtx, Body: result}, err
	}

	if r.Method == http.MethodGet && isFinanceIntegrationOperationDiagnosticPath(path) {
		authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "finance", Scope: "finance.read"})
		if err != nil {
			return routeResult{}, err
		}
		adapter, err := s.requireFinance()
		if err != nil {
			return routeResult{}, err
		}
		query, _, _, _, _, err := financeRuntimeQuery(r, authCtx, path)
		if err != nil {
			return routeResult{}, err
		}
		if path == "/v1/finance/integration-operations" {
			result, err := adapter.ListIntegrationOperationDiagnostics(r.Context(), query)
			return routeResult{Operation: "finance.integration_operations.diagnostics.list", Auth: &authCtx, Body: result}, err
		}
		operationID := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/finance/integration-operations/"), "/attempts")
		result, err := adapter.ListIntegrationOperationAttempts(r.Context(), operationID, query)
		return routeResult{Operation: "finance.integration_operations.attempts.list", Auth: &authCtx, Body: result}, err
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
		query, body, err := s.financeRuntimeMutationRequest(r, authCtx, path)
		if err != nil {
			return routeResult{}, err
		}
		result, operation, err := adapter.HandleMutationWithQuery(r.Context(), r.Method, path, query, body)
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
		query, _, _, _, _, err := financeRuntimeQuery(r, authCtx, path)
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.DashboardSummary(r.Context(), query)
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
		query, _, _, _, _, err := financeRuntimeQuery(r, authCtx, path)
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.ContractSummaries(r.Context(), query)
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
		query, _, _, _, _, err := financeRuntimeQuery(r, authCtx, path)
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.BankAccounts(r.Context(), query)
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
		query, _, _, _, _, err := financeRuntimeQuery(r, authCtx, path)
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.BankAccountBalances(r.Context(), query)
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
		query, _, _, _, _, err := financeRuntimeQuery(r, authCtx, path)
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.BankAccountBalanceChanges(r.Context(), query)
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
		query, _, _, _, _, err := financeRuntimeQuery(r, authCtx, path)
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.BankAccountBalanceSnapshots(r.Context(), code, query)
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
		query, _, _, _, _, err := financeRuntimeQuery(r, authCtx, path)
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.ContractSummaryWithQuery(r.Context(), contractCode, query)
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
		query, _, _, _, _, err := financeRuntimeQuery(r, authCtx, path)
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.MaintenanceFinancialSummary(r.Context(), customerCode, query)
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
		query, _, _, _, _, err := financeRuntimeQuery(r, authCtx, path)
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.PeopleCostParameters(r.Context(), query)
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
		query, _, _, _, _, err := financeRuntimeQuery(r, authCtx, path)
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.PerformanceAmounts(r.Context(), query)
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
		query, _, _, _, _, err := financeRuntimeQuery(r, authCtx, path)
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.MonthlyFinanceReport(r.Context(), query)
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
		query, _, _, _, _, err := financeRuntimeQuery(r, authCtx, path)
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.ProjectFinanceResolve(r.Context(), query)
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
		query, _, _, _, _, err := financeRuntimeQuery(r, authCtx, path)
		if err != nil {
			return routeResult{}, err
		}
		body, err := adapter.ProjectFinanceDetail(r.Context(), projectCode, query)
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
			query, _, _, _, _, err := financeRuntimeQuery(r, authCtx, path)
			if err != nil {
				return routeResult{}, err
			}
			body, err := adapter.ListResource(r.Context(), spec, query)
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
			query, _, _, _, _, err := financeRuntimeQuery(r, authCtx, path)
			if err != nil {
				return routeResult{}, err
			}
			body, err := adapter.GetRecordByCode(r.Context(), spec, code, query)
			return routeResult{Operation: spec.Operation, Auth: &authCtx, Body: body}, err
		}
	}

	return routeResult{}, httperror.New(http.StatusNotFound, "not_found", "Route not found")
}

func isLoopbackRemote(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(strings.TrimSpace(remoteAddr))
	if err != nil {
		host = strings.TrimSpace(remoteAddr)
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

// routeWebDevRuntime keeps the WebDev metadata adapter on the same trusted
// actor boundary as other user-facing tenant-runtime adapters.  The adapter
// owns a small pair of service-only Issue bridge routes; every other WebDev
// path originates from an authenticated WebDev console user and must carry a
// request-target-bound actor delegation.
func (s *Server) routeWebDevRuntime(r *http.Request, adapter runtimeHandler) (routeResult, error) {
	path := cleanPath(r.URL.Path)
	scope := "webdev.read"
	if r.Method != http.MethodGet {
		scope = "webdev.write"
	}
	authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "webdev", Scope: scope})
	if err != nil {
		return routeResult{}, err
	}

	servicePath := isWebDevRuntimeServicePath(r.Method, path)
	actorUID, deptCodes, actorPurpose := "", []string(nil), ""
	if !servicePath {
		var delegated bool
		actorUID, deptCodes, actorPurpose = runtimeActorContextDetails(r, authCtx)
		_, _, _, delegated = runtimeSignedActorContext(r)
		if !delegated || actorUID == "" || actorUID == strings.TrimSpace(authCtx.Subject) || actorPurpose != "" {
			return routeResult{}, httperror.New(http.StatusForbidden, "trusted_webdev_actor_required", "trusted actor delegation is required for WebDev user paths")
		}
	}

	query := runtimeQueryWithAuth(r.URL.Query(), authCtx, actorUID, deptCodes)
	if !servicePath {
		query.Set("hzy_runtime_actor_delegated", "1")
	}
	setRuntimeTrustedQuery(query, authCtx, requestID(r))

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
		setRuntimeTrustedBody(body, authCtx, requestID(r))
		if !servicePath {
			sanitizeWebDevUserBody(path, body, actorUID)
		}
	}

	result, operation, err := adapter.HandleRuntime(r.Context(), r.Method, path, query, body)
	if operation == "" {
		operation = "webdev.runtime"
	}
	return routeResult{Operation: operation, Auth: &authCtx, Body: result}, err
}

func isWebDevRuntimeServicePath(method string, path string) bool {
	if method == http.MethodPost && (path == "/v1/webdev/service/issues/intake" || path == "/v1/webdev/service/jobs" || isWebDevRuntimeServiceIssueClaimPath(path)) {
		return true
	}
	if method == http.MethodGet && (path == "/v1/webdev/service/issues/mine" || path == "/v1/webdev/service/issues/settings" || isWebDevRuntimeServiceIssueDetailPath(path)) {
		return true
	}
	return method == http.MethodPatch && isWebDevRuntimeServiceIssueDetailPath(path)
}

func isWebDevRuntimeServiceIssueDetailPath(path string) bool {
	id := strings.TrimPrefix(path, "/v1/webdev/service/issues/")
	return id != path && id != "" && !strings.Contains(id, "/") && id != "mine" && id != "settings"
}

func isWebDevRuntimeServiceIssueClaimPath(path string) bool {
	if !strings.HasPrefix(path, "/v1/webdev/service/issues/") || !strings.HasSuffix(path, "/claim") {
		return false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/webdev/service/issues/"), "/claim")
	return id != "" && !strings.Contains(id, "/")
}

func isConsoleDirectoryLifecyclePath(path string, action string) bool {
	prefix := "/v1/console/directory/service/users/"
	suffix := "/" + action
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return false
	}
	uid := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	return uid != "" && !strings.Contains(uid, "/")
}

// WebDev's old generic routes accepted these fields directly from the proxy.
// A signed WebDev console actor is the only authority for user-created job and
// Issue identities; tenant routing remains the verified runtime binding.
func sanitizeWebDevUserBody(path string, body map[string]any, actorUID string) {
	for _, key := range []string{"tenant", "tenantCode", "tenant_code", "actor", "createdBy", "created_by", "reporterUid", "reporter_uid", "reporterName", "reporter_name"} {
		delete(body, key)
	}
	if path == "/v1/webdev/jobs" {
		body["createdBy"] = actorUID
	}
	if path == "/v1/webdev/issues" {
		body["reporterUid"] = actorUID
		body["reporterName"] = actorUID
		body["source"] = "manual"
	}
	if strings.HasPrefix(path, "/v1/webdev/issues/") {
		body["actor"] = actorUID
	}
}

func (s *Server) routeAppRuntime(r *http.Request, appCode string, adapter runtimeHandler) (routeResult, error) {
	path := cleanPath(r.URL.Path)
	scope := appCode + ".read"
	if r.Method != http.MethodGet {
		scope = appCode + ".write"
	}
	sourceAppCode := ""
	peopleHRSourceRemap := isPeopleHRSourceDepartmentRemapPath(appCode, r.Method, path)
	if peopleHRSourceRemap {
		scope = peopleHRSourceDepartmentRemapScope
		sourceAppCode = "people"
	}
	if readScope := readOnlyAppRuntimeScope(appCode, r.Method, path); readScope != "" {
		scope = readScope
	}
	if offboardingScope := peopleOffboardingRuntimeScope(appCode, r.Method, path); offboardingScope != "" {
		scope = offboardingScope
	}
	if isNotificationDetailAuthorizationRuntimePath(appCode, r.Method, path) {
		scope = appCode + ".read"
	}
	authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: appCode, Scope: scope, SourceAppCode: sourceAppCode})
	if err != nil {
		return routeResult{}, err
	}
	actorUID, deptCodes, actorPurpose := runtimeActorContextDetails(r, authCtx)
	_, _, _, actorDelegated := runtimeSignedActorContext(r)
	if peopleHRSourceRemap && (authCtx.Mode != string(config.AuthJWT) || strings.TrimSpace(authCtx.Subject) != peopleHRSourceDepartmentRemapSubject) {
		return routeResult{}, httperror.New(http.StatusForbidden, "trusted_people_hr_source_remap_client_required", "dedicated People Runtime identity is required")
	}
	if peopleHRSourceRemap && (!actorDelegated || actorUID == "" || actorUID == strings.TrimSpace(authCtx.Subject) || actorPurpose != "") {
		return routeResult{}, httperror.New(http.StatusForbidden, "trusted_people_hr_source_remap_actor_required", "signed People administrator actor delegation is required")
	}
	if isNotificationDetailAuthorizationRuntimePath(appCode, r.Method, path) && actorPurpose != "notification-detail-authorization" {
		return routeResult{}, httperror.New(http.StatusForbidden, "trusted_notification_actor_required", "trusted notification detail actor delegation is required")
	}
	query := runtimeQueryWithAuth(r.URL.Query(), authCtx, actorUID, deptCodes)
	if actorDelegated {
		query.Set("hzy_runtime_actor_delegated", "1")
	}
	setRuntimeTrustedQuery(query, authCtx, requestID(r))
	if actorPurpose != "" {
		query.Set("hzy_runtime_actor_purpose", actorPurpose)
	}
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
		setRuntimeTrustedBody(body, authCtx, requestID(r))
		if actorPurpose != "" {
			body["hzy_runtime_actor_purpose"] = actorPurpose
		}
		if err := injectTrustedServiceCommandContext(r, authCtx, body); err != nil {
			return routeResult{}, err
		}
	}
	result, operation, err := adapter.HandleRuntime(r.Context(), r.Method, path, query, body)
	if operation == "" {
		operation = appCode + ".runtime"
	}
	return routeResult{Operation: operation, Auth: &authCtx, Body: result}, err
}

const (
	peopleHRSourceDepartmentRemapScope   = "people:hr-source-department-remap:execute"
	peopleHRSourceDepartmentRemapSubject = "client:people.runtime"
)

func isPeopleHRSourceDepartmentRemapPath(appCode string, method string, path string) bool {
	return appCode == "people" && method == http.MethodPost && path == "/v1/people/service/hr-source-sync/dingtalk/departments:remap"
}

func (s *Server) financeNotificationDetailRuntimeAuth(r *http.Request) (auth.Context, url.Values, error) {
	authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "finance", Scope: "finance.read"})
	if err != nil {
		return auth.Context{}, nil, err
	}
	actorUID, deptCodes, actorPurpose := runtimeActorContextDetails(r, authCtx)
	if actorPurpose != "notification-detail-authorization" {
		return auth.Context{}, nil, httperror.New(http.StatusForbidden, "trusted_notification_actor_required", "trusted notification detail actor delegation is required")
	}
	query := runtimeQueryWithAuth(r.URL.Query(), authCtx, actorUID, deptCodes)
	query.Set("hzy_runtime_actor_purpose", actorPurpose)
	return authCtx, query, nil
}

// financeRuntimeQuery separates user-facing Finance paths from the explicit
// service/worker contracts. Finance data-scope assertions travel in the
// request target, so they are trustworthy only when the target is covered by
// a valid runtime actor HMAC. A bearer token by itself is never a user actor.
func financeRuntimeQuery(r *http.Request, authCtx auth.Context, path string) (url.Values, string, []string, string, bool, error) {
	actorUID, deptCodes, actorPurpose := runtimeActorContextDetails(r, authCtx)
	_, _, _, delegated := runtimeSignedActorContext(r)
	if financeRuntimeRequiresTrustedActor(path) && !delegated {
		return nil, "", nil, "", false, httperror.New(http.StatusForbidden, "trusted_finance_actor_required", "trusted actor delegation is required for Finance user paths")
	}
	if !delegated {
		// Dedicated service-command and scheduled contracts are actorless. Do
		// not accidentally turn the service-client subject into a user actor.
		actorUID, deptCodes, actorPurpose = "", nil, ""
	}
	query := runtimeQueryWithAuth(r.URL.Query(), authCtx, actorUID, deptCodes)
	if !delegated {
		for key := range query {
			if finance.RuntimeAuthContextKey(key) {
				delete(query, key)
			}
		}
	} else {
		query.Set("hzy_runtime_actor_delegated", "1")
	}
	setRuntimeTrustedQuery(query, authCtx, requestID(r))
	if actorPurpose != "" {
		query.Set("hzy_runtime_actor_purpose", actorPurpose)
	}
	return query, actorUID, deptCodes, actorPurpose, delegated, nil
}

// isFinanceIntegrationOperationMachineTransition 标出 integration operation 的
// **机器态**生命周期跃迁。这些跃迁由 worker 与 service-command 派发器发起，按设计
// 就没有用户会话——data-runtime 其它地方也这么写：「Dedicated service-command and
// scheduled contracts are actorless」。
//
// 走查 ISSUE-B-025 生产实测：finance 的 :claim 被 financeRuntimeRequiresTrustedActor
// 的前缀式一刀切挡成 403 trusted_finance_actor_required，而调用方
// tryDispatchFinanceWorkflowOperation 把异常吞成 pending，于是 Finance -> Workflow
// 第二跳静默停摆；finance 又不在网关 SCHEDULER_APPS 里、其定时 drain 还被
// HZY_FINANCE_INTEGRATION_OPERATIONS_ENABLED=false 关闭，没有任何兜底。
//
// 刻意**不**豁免 :replay——那是浏览器管理动作，必须继续要求可信委托 actor
// （BFF 侧另有 hasTenantGlobalIntegrationOperationGrant 把关，两层都要保留）。
// financeIntegrationOperationCollectionTransitions 是命名空间根上的机器态动作
// （无 operation key）。financeIntegrationOperationKeyedTransitions 是带 key 的。
//
// 这两张表必须覆盖调用方实际发起的**全部**机器态路径。
// finance_machine_transition_coverage_test.go 会扫描 foundation 的死信 drain 与
// finance 的派发/drain 源码，把它们调用的每一条路径与这里比对，漏一条即失败——
// 走查 ISSUE-B-025 第一版只列了 claim/succeed/fail/claim-next，
// 死信链路的 :pending-dead-letter-actionables 因此仍被挡成 403，
// finance 的 drain 一启动就整体失败。
var financeIntegrationOperationCollectionTransitions = map[string]bool{
	"claim-next":                      true,
	"pending-dead-letter-actionables": true,
	"pending-failure-notifications":   true,
	"pending-dead-letter-closures":    true,
}

var financeIntegrationOperationKeyedTransitions = map[string]bool{
	"claim":                            true,
	"succeed":                          true,
	"fail":                             true,
	"failure-notified":                 true,
	"dead-letter-actionable-published": true,
	"dead-letter-closure-acknowledged": true,
	// :replay 刻意不在此表——它是浏览器管理动作，必须继续要求可信委托 actor。
}

func isFinanceIntegrationOperationMachineTransition(path string) bool {
	const namespace = "/v1/finance/integration-operations"
	if action, ok := strings.CutPrefix(path, namespace+":"); ok {
		return financeIntegrationOperationCollectionTransitions[action]
	}
	rest, ok := strings.CutPrefix(path, namespace+"/")
	if !ok {
		return false
	}
	// key 本身可能被百分号编码，动作永远在最后一个冒号之后。
	index := strings.LastIndex(rest, ":")
	if index < 0 {
		return false
	}
	return financeIntegrationOperationKeyedTransitions[rest[index+1:]]
}

// financeRuntimeRequiresTrustedActor 保留 finance 比其它应用更严的默认：资金路径的
// 写操作必须带已验证用户 actor。与 routeAppRuntime 的差别只在表达方式——那边用
// 具名路径谓词逐条判定，这边此前是前缀式一刀切。现在改为同样的具名谓词模式，
// 把 actorless 的机器态跃迁显式排除，而不是放宽整体默认。
func financeRuntimeRequiresTrustedActor(path string) bool {
	if isFinanceIntegrationOperationMachineTransition(path) {
		return false
	}
	return !strings.HasPrefix(path, "/v1/finance/service/") &&
		path != "/v1/finance/workflow/callback" &&
		path != "/v1/finance/workflow/actions/sync"
}

func (s *Server) financeRuntimeMutationRequest(r *http.Request, authCtx auth.Context, path string) (url.Values, map[string]any, error) {
	query, actorUID, deptCodes, actorPurpose, _, err := financeRuntimeQuery(r, authCtx, path)
	if err != nil {
		return nil, nil, err
	}
	body, err := readJSONBody(r)
	if err != nil {
		return nil, nil, err
	}
	finance.SanitizeRuntimeMutationBody(body)
	if err := injectRuntimeIdempotencyBody(r, body); err != nil {
		return nil, nil, err
	}
	injectRuntimeAuthBody(body, authCtx, actorUID, deptCodes)
	setRuntimeTrustedBody(body, authCtx, requestID(r))
	if actorPurpose != "" {
		body["hzy_runtime_actor_purpose"] = actorPurpose
	}
	// Finance 的 service-command 接收端（invoice-requests:create 等）与其它应用一样
	// 依赖运行时注入的可信 service-command 上下文；缺了它 ReceiptCommandFromBody 会
	// 拿到空 tenant/source_app 并退化成 ErrInvalidIdentity(400)。
	// 无 serviceCommand envelope 时该调用是 no-op，普通用户态 mutation 不受影响。
	if err := injectTrustedServiceCommandContext(r, authCtx, body); err != nil {
		return nil, nil, err
	}
	return query, body, nil
}

// readOnlyAppRuntimeScope keeps command-shaped queries on a read capability.
// POST /document-access/check carries a request body because the document
// access subject is structured, but it does not mutate Codocs state. Requiring
// codocs.write here would reject the deliberately least-privileged Aims
// service token before the adapter can evaluate the signed project scope.
func readOnlyAppRuntimeScope(appCode, method, path string) string {
	if appCode == "aims" && method == http.MethodPost && (path == "/v1/aims/internal/product-catalog/view" || path == "/v1/aims/internal/product-list") {
		return "aims.read"
	}

	if appCode == "aims" && method == http.MethodPost && strings.HasPrefix(path, "/v1/aims/internal/products/") {
		for _, suffix := range []string{"/documents:view", "/documents:list", "/workspace:view", "/members:list", "/versions:list", "/versions:view", "/versions:scope-list", "/components:list", "/objectives:item-objectives", "/objectives:list", "/objectives:view", "/objectives:observations", "/objectives:items", "/objectives:cycles", "/priority-models:list", "/reach-observations:list", "/reach-observations:view", "/roadmap-views:list", "/roadmap-views:view", "/roadmap-views:apply", "/roadmaps:window-view", "/roadmaps:quarter-view", "/roadmaps:commitments", "/roadmaps:cross-snapshots", "/roadmaps:cross-snapshot-targets", "/cross-dependencies:targets", "/cross-dependencies:list", "/cross-dependencies:view", "/versions:scope-history", "/versions:release-view", "/versions:execution-coordination", "/versions:release-diff", "/versions:release-list", "/versions:acceptance-preview", "/versions:acceptance-list", "/versions:acceptance-view", "/handoff-project:authorization", "/feature-unscheduled:view", "/feature-roadmap:view", "/planning-feature:view", "/feature-requests:list", "/features:version-matrix", "/features:list", "/features:view", "/requests:list", "/requests:view", "/request-sources:list", "/planning-items:list", "/planning-items:view", "/planning-cycles:list", "/planning-cycles:view", "/planning-candidates:list", "/planning-assessments:list", "/planning-comments:history", "/planning-comments:list", "/planning-reviews:list", "/planning-observations:list", "/planning-observations:view", "/planning-budget:preview", "/planning-withdrawal:preview", "/planning-consumption:view", "/planning-queue:preview", "/planning-matrix:view", "/planning-capacity:view", "/planning-selection:preview", "/planning-dependencies:view"} {
			if !strings.HasSuffix(path, suffix) {
				continue
			}
			code := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/aims/internal/products/"), suffix)
			if code != "" && !strings.Contains(code, "/") {
				return "aims.read"
			}
		}
	}
	if appCode == "codocs" && method == http.MethodPost && path == "/v1/codocs/service/product-documents/search" {
		return "codocs.read"
	}
	if appCode == "codocs" && method == http.MethodPost && strings.HasPrefix(path, "/v1/codocs/service/product-documents/") && (strings.HasSuffix(path, "/metadata") || strings.HasSuffix(path, "/content")) {
		return "codocs.read"
	}
	if appCode == "codocs" && method == http.MethodPost && path == "/v1/codocs/document-access/check" {
		return "codocs.read"
	}
	if appCode == "people" && method == http.MethodPost && path == "/v1/people/employees:search" {
		return "people.read"
	}
	return ""
}

func peopleOffboardingRuntimeScope(appCode, method, path string) string {
	if appCode != "people" {
		return ""
	}
	if method == http.MethodGet && (path == "/v1/people/offboarding-cases" || strings.HasPrefix(path, "/v1/people/offboarding-cases/")) {
		return "people:offboarding_tasks:view"
	}
	if method == http.MethodPost && path == "/v1/people/offboarding-cases" {
		return "people:offboarding_tasks:admin"
	}
	if method == http.MethodPost && strings.HasPrefix(path, "/v1/people/offboarding-tasks/") && strings.HasSuffix(path, ":confirm") {
		return "people:offboarding_tasks:confirm"
	}
	if method == http.MethodPost && strings.HasPrefix(path, "/v1/people/offboarding-tasks/") && strings.HasSuffix(path, ":cancel") {
		return "people:offboarding_tasks:cancel"
	}
	return ""
}

func isNotificationDetailAuthorizationRuntimePath(appCode, method, path string) bool {
	if method != http.MethodPost {
		return false
	}
	return (appCode == "aims" && path == "/v1/aims/notification-details/authorize") ||
		(appCode == "assets" && path == "/v1/assets/notification-details/authorize") ||
		(appCode == "people" && path == "/v1/people/notification-details/authorize") ||
		(appCode == "altoc" && path == "/v1/altoc/notification-details/authorize") ||
		(appCode == "finance" && path == "/v1/finance/notification-details/authorize")
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
	setRuntimeTrustedQuery(query, authCtx, "")
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
	setRuntimeTrustedBody(body, authCtx, "")
	setRuntimeDeptBody(body, deptCodes)
}

func setRuntimeTrustedQuery(query url.Values, authCtx auth.Context, requestID string) {
	trusted := runtimeTrustedContext(authCtx, requestID)
	for key, value := range trusted {
		if value != "" {
			query.Set(key, value)
		}
	}
}

func setRuntimeTrustedBody(body map[string]any, authCtx auth.Context, requestID string) {
	for key, value := range runtimeTrustedContext(authCtx, requestID) {
		if value != "" {
			body[key] = value
		}
	}
}

func runtimeTrustedContext(authCtx auth.Context, requestID string) map[string]string {
	clientID := strings.TrimSpace(authCtx.ClientID)
	if clientID == "" {
		// Legacy verified contexts may only carry a subject identifier.
		clientID = strings.TrimSpace(authCtx.Subject)
	}
	return map[string]string{
		"hzy_runtime_tenant_code":       strings.TrimSpace(authCtx.Tenant),
		"hzy_runtime_deployment_code":   strings.TrimSpace(authCtx.Deployment),
		"hzy_runtime_source_app":        strings.TrimSpace(authCtx.AppCode),
		"hzy_runtime_service_client_id": clientID,
		"hzy_runtime_request_id":        strings.TrimSpace(requestID),
	}
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
	actorUID, deptCodes, _ := runtimeActorContextDetails(r, authCtx)
	return actorUID, deptCodes
}

// Workflow prepare/create are user-facing mutations.  Their current_user field
// must be supplied by a short-lived, target-runtime-token-bound actor
// delegation, never by the JSON body or the Workflow service client identity.
// Service-command writes use their dedicated receipt route instead.
func trustedWorkflowUserActor(r *http.Request, authCtx auth.Context) (string, []string, error) {
	actorUID, deptCodes, purpose, delegated := runtimeSignedActorContext(r)
	if !delegated || actorUID == "" || actorUID == strings.TrimSpace(authCtx.Subject) || purpose != "" {
		return "", nil, httperror.New(http.StatusForbidden, "trusted_workflow_actor_required", "trusted user actor delegation is required for Workflow instance mutations")
	}
	return actorUID, deptCodes, nil
}

func trustedConsoleMutationActor(r *http.Request, authCtx auth.Context) (string, error) {
	actorUID, _, actorPurpose, delegated := runtimeSignedActorContext(r)
	if !delegated || actorUID == "" || actorUID == strings.TrimSpace(authCtx.Subject) || actorPurpose != "" {
		return "", httperror.New(http.StatusForbidden, "trusted_console_actor_required", "Trusted Console user actor delegation is required")
	}
	return actorUID, nil
}

func trustedConsoleServiceCommandActor(r *http.Request, authCtx auth.Context) (string, error) {
	actorUID, _, actorPurpose, delegated := runtimeSignedActorContext(r)
	if !delegated || actorUID == "" || actorUID == strings.TrimSpace(authCtx.Subject) || actorPurpose != "service-command" {
		return "", httperror.New(http.StatusForbidden, "trusted_console_service_command_actor_required", "Trusted Console service-command actor delegation is required")
	}
	return actorUID, nil
}

func runtimeActorContextDetails(r *http.Request, authCtx auth.Context) (string, []string, string) {
	if actorUID, deptCodes, purpose, ok := runtimeSignedActorContext(r); ok {
		return actorUID, deptCodes, purpose
	}
	return strings.TrimSpace(authCtx.Subject), nil, ""
}

func runtimeSignedActorContext(r *http.Request) (string, []string, string, bool) {
	actorUID := strings.TrimSpace(r.Header.Get("X-HZY-Actor-Uid"))
	signedAt := strings.TrimSpace(r.Header.Get("X-HZY-Actor-Signed-At"))
	signature := strings.TrimSpace(r.Header.Get("X-HZY-Actor-Signature"))
	purpose := strings.TrimSpace(r.Header.Get("X-HZY-Actor-Purpose"))
	token := runtimeBearerToken(r)
	if actorUID == "" || signedAt == "" || signature == "" || token == "" {
		return "", nil, "", false
	}
	if !runtimeActorSignedAtValid(signedAt, purpose) {
		return "", nil, "", false
	}
	deptCodes := runtimeHeaderDeptCodes(r)
	canonical := []string{
		r.Method,
		r.URL.RequestURI(),
		actorUID,
		strings.Join(deptCodes, ","),
		signedAt,
	}
	if purpose != "" {
		canonical = append(canonical, purpose)
	}
	payload := strings.Join(canonical, "\n")
	mac := hmac.New(sha256.New, []byte(token))
	_, _ = mac.Write([]byte(payload))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(signature), []byte(expected)) {
		return "", nil, "", false
	}
	return actorUID, deptCodes, purpose, true
}

func runtimeBearerToken(r *http.Request) string {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(header) < 8 || !strings.EqualFold(header[:7], "Bearer ") {
		return ""
	}
	return strings.TrimSpace(header[7:])
}

func runtimeActorSignedAtValid(value string, purpose string) bool {
	signedAt, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return false
	}
	now := timeNow().UnixNano() / int64(time.Millisecond)
	if purpose == "notification-detail-authorization" {
		if signedAt > now {
			return signedAt-now <= int64(5*time.Second/time.Millisecond)
		}
		return now-signedAt <= int64(60*time.Second/time.Millisecond)
	}
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
		"actor_uid",
		"actorUid",
		"current_user_scopes",
		"currentUserScopes",
		"current_user_dept_code",
		"currentUserDeptCode",
		"current_user_dept_codes",
		"currentUserDeptCodes",
		"current_user_department_code",
		"currentUserDepartmentCode",
		"current_user_department_codes",
		"currentUserDepartmentCodes",
		"hzy_runtime_tenant_code",
		"hzyRuntimeTenantCode",
		"hzy_runtime_deployment_code",
		"hzyRuntimeDeploymentCode",
		"hzy_runtime_source_app",
		"hzyRuntimeSourceApp",
		"hzy_runtime_service_client_id",
		"hzyRuntimeServiceClientId",
		"hzy_runtime_request_id",
		"hzyRuntimeRequestId",
		"hzy_runtime_actor_purpose",
		"hzyRuntimeActorPurpose",
		"hzy_runtime_actor_delegated",
		"hzyRuntimeActorDelegated",
		"hzy_runtime_service_command_tenant_code",
		"hzy_runtime_service_command_source_deployment_code",
		"hzy_runtime_service_command_target_deployment_code",
		"hzy_runtime_service_command_source_app",
		"hzy_runtime_service_command_target_app",
		"hzy_runtime_service_command_source_client_id":
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
	for _, scope := range authCtx.Scopes {
		semantic := runtimeAudienceSemanticScope(scope)
		if semantic != scope && strings.Count(semantic, ":") >= 2 && !stringInSlice(scopes, semantic) {
			scopes = append(scopes, semantic)
		}
	}
	if authCtx.Mode == string(config.AuthDisabled) || authCtx.Mode == string(config.AuthStaticToken) {
		adminScope := strings.TrimSpace(authCtx.AppCode) + ".admin"
		if strings.TrimSpace(authCtx.AppCode) != "" && !stringInSlice(scopes, adminScope) {
			scopes = append(scopes, adminScope)
		}
	}
	return scopes
}

func runtimeAudienceSemanticScope(scope string) string {
	normalized := strings.TrimSpace(scope)
	for _, prefix := range []string{"data-runtime:", "tenant-runtime:"} {
		if strings.HasPrefix(normalized, prefix) {
			return strings.TrimPrefix(normalized, prefix)
		}
	}
	return normalized
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

func (s *Server) requireConsole() (*consoleapp.Adapter, error) {
	if s.console == nil {
		return nil, httperror.New(http.StatusNotFound, "console_adapter_disabled", "Console adapter is disabled")
	}
	return s.console, nil
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
	case "console":
		adapter, err := s.requireConsole()
		if err != nil {
			return nil, err
		}
		return adapter.SchemaStatus(ctx)
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
	apps["console"] = appHealth(ctx, s.console != nil, s.console)
	if consoleHealth, ok := apps["console"].(map[string]any); ok && s.console != nil {
		consoleHealth["vaultKeyConfigured"] = s.console.VaultMasterKeyConfigured()
	}
	apps["finance"] = appHealth(ctx, s.finance != nil, s.finance)
	apps["workflow"] = appHealth(ctx, s.workflow != nil, s.workflow)
	apps["webdev"] = appHealth(ctx, s.webdev != nil, s.webdev)
	apps["assets"] = appHealth(ctx, s.assets != nil, s.assets)
	apps["people"] = appHealth(ctx, s.people != nil, s.people)
	apps["altoc"] = appHealth(ctx, s.altoc != nil, s.altoc)
	apps["aims"] = appHealth(ctx, s.aims != nil, s.aims)
	apps["codocs"] = appHealth(ctx, s.codocs != nil, s.codocs)
	apps["directory"] = appHealth(ctx, s.directory != nil, s.directory)

	status := "ok"
	for _, entry := range apps {
		values, _ := entry.(map[string]any)
		if values["enabled"] == true && values["db"] != "ok" {
			status = "degraded"
			break
		}
	}
	return map[string]any{
		"runtimeProduct": "hzy-data-runtime",
		"status":         status,
		"version":        version.Version,
		"commit":         version.Commit,
		"builtAt":        version.BuiltAt,
		"tenant":         s.cfg.Tenant,
		"deployment":     s.cfg.Deployment,
		"apps":           apps,
	}
}

// ControlSnapshot returns coarse runtime readiness data for the Platform control
// plane. It intentionally excludes database addresses, credentials and business
// records.
func (s *Server) ControlSnapshot(ctx context.Context) map[string]any {
	apps := map[string]any{}
	for _, appCode := range []string{"console", "finance", "workflow", "webdev", "assets", "people", "altoc", "aims", "codocs"} {
		enabled := map[string]bool{
			"console": s.console != nil,
			"finance": s.finance != nil, "workflow": s.workflow != nil, "webdev": s.webdev != nil,
			"assets": s.assets != nil, "people": s.people != nil, "altoc": s.altoc != nil,
			"aims": s.aims != nil, "codocs": s.codocs != nil,
		}[appCode]
		entry := map[string]any{"enabled": enabled, "schemaStatus": "disabled"}
		if enabled {
			status, err := s.schemaStatus(ctx, appCode)
			if err != nil {
				entry["schemaStatus"] = "error"
			} else if encoded, marshalErr := json.Marshal(status); marshalErr == nil {
				var values map[string]any
				if json.Unmarshal(encoded, &values) == nil {
					entry["schemaStatus"] = strings.TrimSpace(fmt.Sprint(values["status"]))
				}
			}
		}
		apps[appCode] = entry
	}
	return map[string]any{"databaseStatus": "passed", "apps": apps}
}

func (s *Server) triggerUpdate(body map[string]any, incomingRequestID string) (map[string]any, error) {
	request, err := resolveRuntimeUpdateRequest(body)
	if err != nil {
		return nil, err
	}
	journalPath := updateJournalPath()
	if existing, readErr := updater.ReadUpdateJournal(journalPath); readErr == nil {
		if existing.Status == "queued" || existing.Status == "running" {
			return nil, httperror.New(http.StatusConflict, "runtime_update_in_progress", "A persistent runtime update operation is already in progress")
		}
	} else if !os.IsNotExist(readErr) {
		return nil, httperror.New(http.StatusConflict, "runtime_update_state_unknown", "Runtime update journal is unreadable; refusing a new operation")
	}

	operationBytes := make([]byte, 16)
	if _, err := rand.Read(operationBytes); err != nil {
		return nil, httperror.New(http.StatusInternalServerError, "runtime_update_operation_id_failed", "Failed to create runtime update operation ID")
	}
	requestFingerprint := sha256.Sum256([]byte(incomingRequestID))
	triggeredAt := time.Now().UTC().Format(time.RFC3339)
	journal := updater.UpdateJournal{
		SchemaVersion:            updater.UpdateJournalSchemaVersion,
		OperationID:              "update-" + hex.EncodeToString(operationBytes),
		RequestID:                hex.EncodeToString(requestFingerprint[:]),
		Trigger:                  "api",
		Status:                   "queued",
		Phase:                    "queued",
		TargetVersion:            request.TargetVersion,
		PackageSourceFingerprint: request.PackageSourceFingerprint,
		BeforeVersion:            version.Version,
		TriggeredAt:              triggeredAt,
		AutomaticRetry:           false,
	}
	if digest, digestErr := updater.FileSHA256(filepath.Join(request.InstallDir, "hzy-data-runtime")); digestErr == nil {
		journal.BeforeBinarySHA256 = digest
	}
	if err := updater.WriteUpdateJournal(journalPath, journal); err != nil {
		return nil, httperror.New(http.StatusInternalServerError, "runtime_update_journal_failed", "Failed to persist runtime update operation")
	}
	if err := writeSystemdUpdateRequest(request.TargetVersion, journal.OperationID); err != nil {
		journal.Status = "failed"
		journal.Phase = "failed"
		journal.ErrorCode = "runtime_update_request_failed"
		journal.FinishedAt = time.Now().UTC().Format(time.RFC3339)
		_ = updater.WriteUpdateJournal(journalPath, journal)
		return nil, err
	}
	status := updateJournalStatus(journal)
	s.updateMu.Lock()
	s.updateStatus = status
	s.updateMu.Unlock()
	return copyMap(status), nil
}

// RequestControlPlaneUpdate queues a signed exact-version update selected by
// the enrolled Platform control plane. Package origin and service paths remain
// server-owned through resolveRuntimeUpdateRequest.
func (s *Server) RequestControlPlaneUpdate(targetVersion string) error {
	_, err := s.triggerUpdate(
		map[string]any{"targetVersion": strings.TrimSpace(targetVersion)},
		"platform-control-heartbeat-"+strings.TrimSpace(targetVersion),
	)
	return err
}

func writeSystemdUpdateRequest(targetVersion string, operationIDs ...string) error {
	path := updateRequestPath()
	if err := os.MkdirAll(filepath.Dir(path), 0750); err != nil {
		return httperror.New(http.StatusInternalServerError, "runtime_update_request_failed", "Failed to prepare update request directory: "+err.Error())
	}

	content := "HZY_DATA_RUNTIME_UPDATE_VERSION=" + strconv.Quote(targetVersion) + "\n"
	if len(operationIDs) > 1 {
		return httperror.New(http.StatusInternalServerError, "runtime_update_request_failed", "Invalid runtime update operation ID count")
	}
	if len(operationIDs) == 1 {
		operationID := operationIDs[0]
		if !operationIDPattern.MatchString(operationID) {
			return httperror.New(http.StatusInternalServerError, "runtime_update_request_failed", "Invalid runtime update operation ID")
		}
		content += "HZY_DATA_RUNTIME_UPDATE_OPERATION_ID=" + strconv.Quote(operationID) + "\n"
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".update-request-*")
	if err != nil {
		return httperror.New(http.StatusInternalServerError, "runtime_update_request_failed", "Failed to prepare update request: "+err.Error())
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0600); err != nil {
		_ = temporary.Close()
		return httperror.New(http.StatusInternalServerError, "runtime_update_request_failed", "Failed to secure update request: "+err.Error())
	}
	if _, err := temporary.WriteString(content); err != nil {
		_ = temporary.Close()
		return httperror.New(http.StatusInternalServerError, "runtime_update_request_failed", "Failed to write update request: "+err.Error())
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return httperror.New(http.StatusInternalServerError, "runtime_update_request_failed", "Failed to sync update request: "+err.Error())
	}
	if err := temporary.Close(); err != nil {
		return httperror.New(http.StatusInternalServerError, "runtime_update_request_failed", "Failed to close update request: "+err.Error())
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return httperror.New(http.StatusInternalServerError, "runtime_update_request_failed", "Failed to write update request: "+err.Error())
	}
	if err := os.Chmod(path, 0600); err != nil {
		return httperror.New(http.StatusInternalServerError, "runtime_update_request_failed", "Failed to secure update request: "+err.Error())
	}
	directory, err := os.Open(filepath.Dir(path))
	if err != nil {
		return httperror.New(http.StatusInternalServerError, "runtime_update_request_failed", "Failed to open update request directory: "+err.Error())
	}
	defer directory.Close()
	if err := directory.Sync(); err != nil {
		return httperror.New(http.StatusInternalServerError, "runtime_update_request_failed", "Failed to sync update request directory: "+err.Error())
	}
	return nil
}

func updateRequestPath() string {
	configDir := firstNonEmptyText(os.Getenv("HZY_DATA_RUNTIME_CONFIG_DIR"), "/etc/hzy-data-runtime")
	return filepath.Join(configDir, "update-request.env")
}

func updateJournalPath() string {
	configDir := firstNonEmptyText(os.Getenv("HZY_DATA_RUNTIME_CONFIG_DIR"), "/etc/hzy-data-runtime")
	return filepath.Join(configDir, "update-journal.json")
}

func (s *Server) runtimeUpdateStatus() map[string]any {
	if journal, err := updater.ReadUpdateJournal(updateJournalPath()); err == nil {
		if (journal.Status == "queued" || journal.Status == "running") && updateJournalIsStale(journal, time.Now()) {
			journal.Status = "partial_or_unknown"
			journal.Phase = "unknown"
			journal.ErrorCode = "runtime_update_executor_stale"
			journal.FinishedAt = time.Now().UTC().Format(time.RFC3339)
			_ = updater.WriteUpdateJournal(updateJournalPath(), journal)
		}
		status := updateJournalStatus(journal)
		status["checkedAt"] = time.Now().UTC().Format(time.RFC3339)
		status["observedVersion"] = version.Version
		if journal.AfterVersion != "" {
			status["expectedVersionMatches"] = journal.AfterVersion == version.Version
		}
		return status
	} else if !os.IsNotExist(err) {
		return map[string]any{
			"status":    "partial_or_unknown",
			"phase":     "unknown",
			"running":   false,
			"errorCode": "runtime_update_journal_read_failed",
			"checkedAt": time.Now().UTC().Format(time.RFC3339),
		}
	}
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
	status["running"] = status["status"] == "queued" || status["status"] == "running"
	status["checkedAt"] = time.Now().UTC().Format(time.RFC3339)
	return status
}

func updateJournalIsStale(journal updater.UpdateJournal, now time.Time) bool {
	reference := journal.StartedAt
	if reference == "" {
		reference = journal.TriggeredAt
	}
	parsed, err := time.Parse(time.RFC3339, reference)
	if err != nil {
		return true
	}
	return now.Sub(parsed) > 10*time.Minute
}

func updateJournalStatus(journal updater.UpdateJournal) map[string]any {
	return map[string]any{
		"operationId":              journal.OperationID,
		"requestId":                journal.RequestID,
		"status":                   journal.Status,
		"phase":                    journal.Phase,
		"running":                  journal.Status == "queued" || journal.Status == "running",
		"targetVersion":            journal.TargetVersion,
		"packageSourceFingerprint": journal.PackageSourceFingerprint,
		"restart":                  true,
		"force":                    false,
		"triggeredAt":              journal.TriggeredAt,
		"startedAt":                journal.StartedAt,
		"finishedAt":               journal.FinishedAt,
		"errorCode":                journal.ErrorCode,
		"result": map[string]any{
			"beforeVersion":      journal.BeforeVersion,
			"beforeBinarySha256": journal.BeforeBinarySHA256,
			"afterVersion":       journal.AfterVersion,
			"afterBinarySha256":  journal.AfterBinarySHA256,
			"artifactSha256":     journal.ArtifactSHA256,
			"manifestSha256":     journal.ManifestSHA256,
			"signingKeyId":       journal.SigningKeyID,
			"rollbackStatus":     journal.RollbackStatus,
		},
	}
}

func copyMap(input map[string]any) map[string]any {
	return map[string]any{
		"operationId":              input["operationId"],
		"requestId":                input["requestId"],
		"status":                   input["status"],
		"phase":                    input["phase"],
		"running":                  input["running"],
		"targetVersion":            input["targetVersion"],
		"packageSourceFingerprint": input["packageSourceFingerprint"],
		"restart":                  input["restart"],
		"force":                    input["force"],
		"triggeredAt":              input["triggeredAt"],
		"startedAt":                input["startedAt"],
		"finishedAt":               input["finishedAt"],
		"errorCode":                input["errorCode"],
		"result":                   input["result"],
	}
}

func appHealth(ctx context.Context, enabled bool, adapter pinger) map[string]any {
	if !enabled {
		return map[string]any{"enabled": false}
	}
	if err := adapter.Ping(ctx); err != nil {
		return map[string]any{"enabled": true, "db": "unavailable"}
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

func trustedRequestIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
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
	message := "Internal server error"

	var httpErr httperror.Error
	if errors.As(err, &httpErr) {
		status = httpErr.Status
		code = httpErr.Code
		message = httpErr.Message
	} else if mappedStatus, mappedCode, mappedMessage, ok := integrationOperationSentinelStatus(err); ok {
		status = mappedStatus
		code = mappedCode
		message = mappedMessage
	} else {
		// 兜底成 500 之前必须留痕。
		//
		// 2026-08-23/24：`:fail` 连续数周静默 500，而 writeError 对未映射错误一句都不打，
		// 只能看到 `internal_error`，两轮修复都因为猜错哨兵而落空。
		// 未分类错误同时还被 retryableHTTPStatus 判为可重试，直接导致调用方无限重试。
		// 原始 error 只进服务端日志，不进响应体。
		log.Printf(`{"level":"error","event":"unmapped_error","requestId":%q,"error":%q}`,
			requestID, err.Error())
	}

	body := errorBody{}
	body.Error.Code = code
	body.Error.Message = message
	body.Error.Retryable = retryableHTTPStatus(status)
	body.Error.RequestID = requestID
	body.Error.Details = map[string]any{}
	writeJSON(w, requestID, status, body)
	return status, code
}

// integrationOperationSentinelStatus 把 integration operation 的乐观并发/租约哨兵
// 统一映射为 409。
//
// 2026-08-23 生产事故：这些哨兵在各应用入口逐个手工映射，people 的
// claim/succeed/fail 漏了，`ErrStaleFencing`（租约过期）漏成 500。
// 而 retryableHTTPStatus 把 >=500 判定为可重试，于是调用方永不 checkpoint、
// 无限重领重试——单条 operation attempt_count 冲到 5261，max_attempts=8 完全失效。
// 在中央 writeError 兜底可以避免任何应用再次遗漏。各应用仍可自行返回更精确的 httperror。
//
// ErrCorruptOperation 刻意不在此映射：它代表真实数据损坏，应保持 500 以便暴露。
func integrationOperationSentinelStatus(err error) (int, string, string, bool) {
	switch {
	case errors.Is(err, integrationoperation.ErrStaleFencing):
		return http.StatusConflict, "integration_operation_lease_stale",
			"integration operation lease is stale; re-claim before completing", true
	case errors.Is(err, integrationoperation.ErrPersistenceRace):
		return http.StatusConflict, "integration_operation_persistence_race",
			"integration operation changed concurrently; re-claim before completing", true
	case errors.Is(err, integrationoperation.ErrOperationNotFound):
		return http.StatusConflict, "integration_operation_not_found",
			"integration operation no longer matches the presented lease", true

	// 幂等 / 收据 / 重放类：确定性冲突，重试不会改变结果。
	case errors.Is(err, integrationoperation.ErrIdempotencyPayloadMismatch):
		return http.StatusConflict, "service_command_idempotency_payload_mismatch",
			"idempotency key was reused with a different payload", true
	case errors.Is(err, integrationoperation.ErrReceiptInProgress):
		return http.StatusConflict, "service_command_receipt_in_progress",
			"service command receipt is still processing", true
	case errors.Is(err, integrationoperation.ErrReceiptRejected):
		return http.StatusConflict, "service_command_receipt_rejected",
			"service command receipt was rejected", true
	case errors.Is(err, integrationoperation.ErrReplayRejected):
		return http.StatusConflict, "integration_operation_replay_rejected",
			"integration operation replay was rejected", true
	case errors.Is(err, integrationoperation.ErrImmutableIdentity):
		return http.StatusConflict, "integration_operation_identity_immutable",
			"integration operation identity cannot change", true

	// 入参校验类：调用方提交的内容非法，重试同样失败，必须是 4xx。
	case errors.Is(err, integrationoperation.ErrInvalidIdentity):
		return http.StatusBadRequest, "integration_operation_identity_invalid",
			"integration operation identity value is invalid", true
	case errors.Is(err, integrationoperation.ErrInvalidOperationID):
		return http.StatusBadRequest, "integration_operation_id_invalid",
			"integration operation ID is invalid", true
	case errors.Is(err, integrationoperation.ErrUnsafePersistenceContent):
		return http.StatusBadRequest, "integration_operation_content_unsafe",
			"integration operation content failed safe-persistence validation", true
	}
	return 0, "", "", false
}

func retryableHTTPStatus(status int) bool {
	return status == http.StatusRequestTimeout ||
		status == http.StatusTooEarly ||
		status == http.StatusTooManyRequests ||
		status >= http.StatusInternalServerError
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

func isFinanceIntegrationOperationDiagnosticPath(path string) bool {
	return path == "/v1/finance/integration-operations" ||
		(strings.HasPrefix(path, "/v1/finance/integration-operations/") && strings.HasSuffix(path, "/attempts"))
}

func isFinanceDueNotificationRuntimePath(path string) bool {
	switch path {
	case "/v1/finance/service/notifications:scan-due",
		"/v1/finance/service/notifications:acknowledge",
		"/v1/finance/service/notifications:acknowledge-closure":
		return true
	default:
		return false
	}
}

const (
	financeDueNotificationWorkerScope   = "finance.notifications_due.execute"
	financeDueNotificationWorkerSubject = "client:finance.runtime"
	financeDueNotificationWorkerActor   = "finance.scheduled-notification-worker"
	financeDueNotificationWorkerPurpose = "finance-due-notification-worker"
)

type dueNotificationWorker struct {
	AppCode string
	Scope   string
	Subject string
	Actor   string
	Purpose string
}

func dueNotificationWorkerForPath(path string) (dueNotificationWorker, bool) {
	workers := map[string]dueNotificationWorker{
		"/v1/aims/service/notifications:scan-due":              {"aims", "aims.notifications_due.execute", "client:aims.runtime", "aims.scheduled-notification-worker", "aims-due-notification-worker"},
		"/v1/aims/service/notifications:acknowledge":           {"aims", "aims.notifications_due.execute", "client:aims.runtime", "aims.scheduled-notification-worker", "aims-due-notification-worker"},
		"/v1/aims/service/notifications:acknowledge-closure":   {"aims", "aims.notifications_due.execute", "client:aims.runtime", "aims.scheduled-notification-worker", "aims-due-notification-worker"},
		"/v1/altoc/service/notifications:scan-due":             {"altoc", "altoc.notifications_due.execute", "client:altoc.runtime", "altoc.scheduled-receivable-notification-worker", "altoc-receivable-due-notification-worker"},
		"/v1/altoc/service/notifications:acknowledge":          {"altoc", "altoc.notifications_due.execute", "client:altoc.runtime", "altoc.scheduled-receivable-notification-worker", "altoc-receivable-due-notification-worker"},
		"/v1/altoc/service/notifications:acknowledge-closure":  {"altoc", "altoc.notifications_due.execute", "client:altoc.runtime", "altoc.scheduled-receivable-notification-worker", "altoc-receivable-due-notification-worker"},
		"/v1/assets/service/notifications:scan-due":            {"assets", "assets.notifications_due.execute", "client:assets.runtime", "assets.scheduled-notification-worker", "assets-due-notification-worker"},
		"/v1/assets/service/notifications:acknowledge":         {"assets", "assets.notifications_due.execute", "client:assets.runtime", "assets.scheduled-notification-worker", "assets-due-notification-worker"},
		"/v1/assets/service/notifications:acknowledge-closure": {"assets", "assets.notifications_due.execute", "client:assets.runtime", "assets.scheduled-notification-worker", "assets-due-notification-worker"},
		"/v1/people/service/notifications:scan-due":            {"people", "people.notifications_due.execute", "client:people.runtime", "people.scheduled-offboarding-notification-worker", "people-offboarding-due-notification-worker"},
		"/v1/people/service/notifications:acknowledge":         {"people", "people.notifications_due.execute", "client:people.runtime", "people.scheduled-offboarding-notification-worker", "people-offboarding-due-notification-worker"},
		"/v1/people/service/notifications:acknowledge-closure": {"people", "people.notifications_due.execute", "client:people.runtime", "people.scheduled-offboarding-notification-worker", "people-offboarding-due-notification-worker"},
	}
	worker, ok := workers[path]
	return worker, ok
}

// routeDueNotificationWorker keeps the actorless checkpoint contracts out of
// the broad app.write router. A module runtime bearer is deliberately not
// enough: each worker must use its dedicated short-lived client grant and a
// request-target-bound HMAC assertion.
func (s *Server) routeDueNotificationWorker(r *http.Request, path string, worker dueNotificationWorker, adapter runtimeHandler) (routeResult, error) {
	authCtx, err := s.dueNotificationWorkerAuth(r, worker)
	if err != nil {
		return routeResult{}, err
	}
	body, err := readJSONBody(r)
	if err != nil {
		return routeResult{}, err
	}
	if err := validateDueNotificationWorkerBody(path, body); err != nil {
		return routeResult{}, err
	}
	setRuntimeTrustedBody(body, authCtx, requestID(r))
	body["hzy_runtime_actor_purpose"] = worker.Purpose
	result, operation, err := adapter.HandleRuntime(r.Context(), r.Method, path, url.Values{}, body)
	return routeResult{Operation: operation, Auth: &authCtx, Body: result}, err
}

func (s *Server) dueNotificationWorkerAuth(r *http.Request, worker dueNotificationWorker) (auth.Context, error) {
	authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: worker.AppCode, Scope: worker.Scope})
	if err != nil {
		return auth.Context{}, err
	}
	if authCtx.Mode != string(config.AuthJWT) || strings.TrimSpace(authCtx.Subject) != worker.Subject {
		return auth.Context{}, httperror.New(http.StatusForbidden, "trusted_due_notification_worker_required", "dedicated due-notification worker identity is required")
	}
	actorUID, deptCodes, purpose, delegated := runtimeSignedActorContext(r)
	if !delegated || actorUID != worker.Actor || purpose != worker.Purpose || len(deptCodes) != 0 {
		return auth.Context{}, httperror.New(http.StatusForbidden, "trusted_due_notification_worker_required", "purpose-bound due-notification worker delegation is required")
	}
	return authCtx, nil
}

func validateDueNotificationWorkerBody(path string, body map[string]any) error {
	allowed := map[string]bool{}
	switch {
	case strings.HasSuffix(path, "notifications:scan-due"):
		allowed = map[string]bool{"stream": true, "asOf": true, "cursor": true, "limit": true}
	case strings.HasSuffix(path, "notifications:acknowledge-closure"):
		allowed = map[string]bool{"eventVersion": true, "nextVersion": true}
	case strings.HasSuffix(path, "notifications:acknowledge"):
		allowed = map[string]bool{"eventVersion": true, "notificationId": true, "recipientUid": true}
		if strings.HasPrefix(path, "/v1/assets/") {
			allowed["stream"], allowed["sourceType"], allowed["sourceId"] = true, true, true
		}
	}
	for key := range body {
		if !allowed[key] {
			return httperror.New(http.StatusBadRequest, "due_notification_request_field_invalid", "due-notification worker request contains an unsupported field")
		}
	}
	return nil
}

// financeDueNotificationRuntimeAuth keeps the due-checkpoint mutation
// contract separate from normal Finance writes. A Finance application bearer
// with finance.write is deliberately insufficient: only the dedicated
// finance.runtime worker token, issued with its exact Console grant, may use
// the actorless scheduled endpoints. The purpose-bound HMAC also binds the
// worker assertion to this exact request target and short-lived bearer.
func (s *Server) financeDueNotificationRuntimeAuth(r *http.Request) (auth.Context, error) {
	authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "finance", Scope: financeDueNotificationWorkerScope})
	if err != nil {
		return auth.Context{}, err
	}
	if authCtx.Mode != string(config.AuthJWT) || strings.TrimSpace(authCtx.Subject) != financeDueNotificationWorkerSubject {
		return auth.Context{}, httperror.New(http.StatusForbidden, "trusted_finance_due_worker_required", "dedicated Finance due-notification worker identity is required")
	}
	actorUID, deptCodes, purpose, delegated := runtimeSignedActorContext(r)
	if !delegated || actorUID != financeDueNotificationWorkerActor || purpose != financeDueNotificationWorkerPurpose || len(deptCodes) != 0 {
		return auth.Context{}, httperror.New(http.StatusForbidden, "trusted_finance_due_worker_required", "purpose-bound Finance due-notification worker delegation is required")
	}
	return authCtx, nil
}

func validateFinanceDueNotificationRuntimeBody(path string, body map[string]any) error {
	allowed := map[string]bool{}
	switch path {
	case "/v1/finance/service/notifications:scan-due":
		allowed = map[string]bool{"stream": true, "asOf": true, "cursor": true, "limit": true}
	case "/v1/finance/service/notifications:acknowledge":
		allowed = map[string]bool{"eventVersion": true, "notificationId": true, "recipientUid": true}
	case "/v1/finance/service/notifications:acknowledge-closure":
		allowed = map[string]bool{"eventVersion": true, "nextVersion": true}
	default:
		return httperror.New(http.StatusNotFound, "not_found", "Route not found")
	}
	for key := range body {
		if !allowed[key] {
			return httperror.New(http.StatusBadRequest, "finance_due_request_field_invalid", "due-notification worker request contains an unsupported field")
		}
	}
	return nil
}

func isWorkflowRuntimePath(path string) bool {
	if path == "/v1/workflow/action-defs/sync" ||
		path == "/v1/workflow/instances/prepare" ||
		path == "/v1/workflow/instances" {
		return false
	}
	return strings.HasPrefix(path, "/v1/workflow/")
}

func workflowRuntimeRequiresTrustedActor(path string) bool {
	return path == "/v1/workflow/actions" ||
		strings.HasPrefix(path, "/v1/workflow/tasks/") ||
		strings.HasPrefix(path, "/v1/workflow/instances/") ||
		path == "/v1/workflow/instances" ||
		strings.HasPrefix(path, "/v1/workflow/admin/")
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
	data, _, err := readJSONBodyWithRaw(r)
	return data, err
}

func readJSONBodyWithRaw(r *http.Request) (map[string]any, []byte, error) {
	return readJSONBodyWithRawLimit(r, 1<<20)
}

func readJSONBodyWithRawLimit(r *http.Request, maxRequestBodyBytes int64) (map[string]any, []byte, error) {
	if r.Body == nil {
		return map[string]any{}, []byte{}, nil
	}
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, maxRequestBodyBytes+1))
	if err != nil {
		return nil, nil, err
	}
	if int64(len(body)) > maxRequestBodyBytes {
		return nil, nil, httperror.New(http.StatusRequestEntityTooLarge, "request_body_too_large", fmt.Sprintf("Request body exceeds %d MiB", maxRequestBodyBytes>>20))
	}
	if len(strings.TrimSpace(string(body))) == 0 {
		return map[string]any{}, body, nil
	}
	var data map[string]any
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, nil, httperror.New(http.StatusBadRequest, "invalid_json", "Invalid JSON request body")
	}
	return data, body, nil
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
