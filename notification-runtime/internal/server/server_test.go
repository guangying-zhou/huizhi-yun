package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/huizhi-yun/notification-runtime/internal/auth"
	"github.com/huizhi-yun/notification-runtime/internal/config"
	"github.com/huizhi-yun/notification-runtime/internal/deliveryledger"
	"github.com/huizhi-yun/notification-runtime/internal/httperror"
	"github.com/huizhi-yun/notification-runtime/internal/identityhandoff"
	"github.com/huizhi-yun/notification-runtime/internal/peoplejobs"
	"github.com/huizhi-yun/notification-runtime/internal/providers"
)

func testServer() http.Handler {
	return NewWithStore(config.Config{
		Tenant:     "C000001",
		Deployment: "prod",
		Auth: config.AuthConfig{
			Mode:        config.AuthStaticToken,
			StaticToken: "runtime-token",
		},
	}, &fakeLedger{}).Handler()
}

type blockingPeopleRunner struct{ started chan struct{} }

func (runner blockingPeopleRunner) RunPeopleSync(ctx context.Context, _ peoplejobs.StartRequest, _ func(peoplejobs.Batch) error) (peoplejobs.Counts, error) {
	close(runner.started)
	<-ctx.Done()
	return peoplejobs.Counts{}, ctx.Err()
}

type retryPeopleRunner struct{ calls atomic.Int32 }

func (runner *retryPeopleRunner) RunPeopleSync(_ context.Context, _ peoplejobs.StartRequest, _ func(peoplejobs.Batch) error) (peoplejobs.Counts, error) {
	if runner.calls.Add(1) == 1 {
		return peoplejobs.Counts{}, errors.New("provider unavailable")
	}
	return peoplejobs.Counts{Batches: 1}, nil
}

type noOpPeopleSink struct{}

func (noOpPeopleSink) Apply(context.Context, peoplejobs.Batch) (peoplejobs.Counts, error) {
	return peoplejobs.Counts{}, nil
}

func connectorPeopleServer(t *testing.T, runner peoplejobs.Runner) (http.Handler, *peoplejobs.Manager) {
	t.Helper()
	store, err := peoplejobs.Open(context.Background(), filepath.Join(t.TempDir(), "people-jobs.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	manager := peoplejobs.NewManager(store, runner, noOpPeopleSink{})
	cfg := config.Config{
		Tenant: "C000001", Deployment: "prod",
		Auth: config.AuthConfig{Mode: config.AuthStaticToken, StaticToken: "runtime-token"},
	}
	server := NewWithProfileAndDependencies(cfg, ConnectorProfile(), &fakeLedger{}, &fakeProvider{})
	server.SetPeopleJobs(manager)
	return server.Handler(), manager
}

func waitServerPeopleJob(t *testing.T, manager *peoplejobs.Manager, id, status string) peoplejobs.Job {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		job, ok, err := manager.Get(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		if ok && job.Status == status {
			return job
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("job %s did not reach %s", id, status)
	return peoplejobs.Job{}
}

const validSendBody = `{
  "channel":"wecom","integrationCode":"wecom.default","sourceAppCode":"static-token-client","touser":"u1",
  "title":"title","description":"description","url":"https://example.test/task/1",
  "idempotencyKey":"notification-1"
}`

type fakeLedger struct {
	claim           deliveryledger.Claim
	claimErr        error
	succeedErr      error
	claims          []deliveryledger.ClaimInput
	succeeded       []deliveryledger.Completion
	failed          []deliveryledger.Completion
	unknown         []deliveryledger.Completion
	listResult      deliveryledger.ListResult
	listErr         error
	lists           []deliveryledger.ListInput
	reconcileResult deliveryledger.ReconcileResult
	reconcileErr    error
	reconciles      []deliveryledger.ReconcileInput
}

func (f *fakeLedger) Ready(context.Context) error { return nil }

func (f *fakeLedger) List(_ context.Context, input deliveryledger.ListInput) (deliveryledger.ListResult, error) {
	f.lists = append(f.lists, input)
	return f.listResult, f.listErr
}

func (f *fakeLedger) Reconcile(_ context.Context, input deliveryledger.ReconcileInput) (deliveryledger.ReconcileResult, error) {
	f.reconciles = append(f.reconciles, input)
	return f.reconcileResult, f.reconcileErr
}

func (f *fakeLedger) Claim(_ context.Context, input deliveryledger.ClaimInput) (deliveryledger.Claim, error) {
	f.claims = append(f.claims, input)
	return f.claim, f.claimErr
}
func (f *fakeLedger) Succeed(_ context.Context, input deliveryledger.Completion) error {
	f.succeeded = append(f.succeeded, input)
	return f.succeedErr
}
func (f *fakeLedger) Fail(_ context.Context, input deliveryledger.Completion) error {
	f.failed = append(f.failed, input)
	return nil
}
func (f *fakeLedger) MarkUnknown(_ context.Context, input deliveryledger.Completion) error {
	f.unknown = append(f.unknown, input)
	return nil
}
func (f *fakeLedger) Close() error { return nil }

type fakeProvider struct {
	calls              int
	result             providers.SendResult
	err                error
	identityCalls      int
	identityResult     providers.IdentityExchangeResult
	identityErr        error
	dingIdentityCalls  int
	dingIdentityResult providers.IdentityExchangeResult
	dingIdentityErr    error
}

func (f *fakeProvider) Send(context.Context, providers.SendRequest) (providers.SendResult, error) {
	f.calls++
	return f.result, f.err
}

func (f *fakeProvider) ExchangeIdentity(context.Context, providers.IdentityExchangeRequest) (providers.IdentityExchangeResult, error) {
	f.identityCalls++
	return f.identityResult, f.identityErr
}

func (f *fakeProvider) ExchangeDingTalkIdentity(context.Context, providers.DingTalkIdentityExchangeRequest) (providers.IdentityExchangeResult, error) {
	f.dingIdentityCalls++
	return f.dingIdentityResult, f.dingIdentityErr
}

func ledgerServer(ledger *fakeLedger, provider *fakeProvider) http.Handler {
	return NewWithDependencies(config.Config{
		Tenant: "C000001", Deployment: "prod",
		Auth: config.AuthConfig{Mode: config.AuthStaticToken, StaticToken: "runtime-token"},
	}, ledger, provider).Handler()
}

func connectorLedgerServer(ledger *fakeLedger, provider *fakeProvider) http.Handler {
	cfg := config.Config{
		Tenant: "C000001", Deployment: "prod",
		Auth: config.AuthConfig{Mode: config.AuthStaticToken, StaticToken: "runtime-token"},
	}
	return NewWithProfileAndDependencies(cfg, ConnectorProfile(), ledger, provider).Handler()
}

func request(handler http.Handler, method string, path string, body string, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	return recorder
}

func TestPeopleJobCommandRequiresActorAndHeaderBoundIdempotencyForJWT(t *testing.T) {
	actor := auth.Context{Mode: string(config.AuthJWT), SourceApp: "console"}
	if err := validatePeopleJobCommand(actor, "people-admin-1", "people-sync-command-0001", "people-sync-command-0001"); err != nil {
		t.Fatalf("valid command: %v", err)
	}
	for _, test := range []struct {
		name, actorUID, bodyKey, headerKey string
	}{
		{"missing actor", "", "people-sync-command-0001", "people-sync-command-0001"},
		{"missing header", "people-admin-1", "people-sync-command-0001", ""},
		{"mismatched header", "people-admin-1", "people-sync-command-0001", "people-sync-command-0002"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := validatePeopleJobCommand(actor, test.actorUID, test.bodyKey, test.headerKey); err == nil {
				t.Fatal("expected command binding rejection")
			}
		})
	}
	if err := validatePeopleJobCommand(auth.Context{Mode: string(config.AuthStaticToken)}, "", "", ""); err != nil {
		t.Fatalf("static-token development mode should remain compatible: %v", err)
	}
}

func TestHealthAndCapabilitiesAreReadOnly(t *testing.T) {
	handler := testServer()

	health := request(handler, http.MethodGet, "/runtime/health", "", "")
	if health.Code != http.StatusOK {
		t.Fatalf("health status = %d, want %d", health.Code, http.StatusOK)
	}

	capabilities := request(handler, http.MethodGet, "/runtime/capabilities", "", "")
	if capabilities.Code != http.StatusOK {
		t.Fatalf("capabilities status = %d, want %d", capabilities.Code, http.StatusOK)
	}

	var payload struct {
		Data struct {
			SchemaVersion      string   `json:"schemaVersion"`
			RuntimeProduct     string   `json:"runtimeProduct"`
			MigrationTarget    string   `json:"migrationTarget"`
			ArbitraryHTTPProxy bool     `json:"arbitraryHttpProxy"`
			Scopes             []string `json:"scopes"`
			Providers          []struct {
				Code                 string   `json:"code"`
				AllowedOrigins       []string `json:"allowedOrigins"`
				DynamicTargetAllowed bool     `json:"dynamicTargetAllowed"`
			} `json:"providers"`
			Capabilities []struct {
				Code          string `json:"code"`
				Method        string `json:"method"`
				Path          string `json:"path"`
				RequiredScope string `json:"requiredScope"`
				TargetScope   string `json:"targetScope"`
			} `json:"capabilities"`
		} `json:"data"`
	}
	if err := json.Unmarshal(capabilities.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode capabilities: %v", err)
	}
	wantScopes := []string{"notification-runtime:send", "notification-runtime:deliveries:read", "notification-runtime:deliveries:reconcile"}
	if fmt.Sprint(payload.Data.Scopes) != fmt.Sprint(wantScopes) {
		t.Fatalf("capability scopes = %v, want %v", payload.Data.Scopes, wantScopes)
	}
	if payload.Data.SchemaVersion != "hzy.connector-capabilities.v1" || payload.Data.RuntimeProduct != "hzy-notification-runtime" || payload.Data.MigrationTarget != "hzy-connector-runtime" || payload.Data.ArbitraryHTTPProxy {
		t.Fatalf("unexpected capability registry: %+v", payload.Data)
	}
	if len(payload.Data.Providers) != 1 || payload.Data.Providers[0].Code != "wecom" || payload.Data.Providers[0].DynamicTargetAllowed || fmt.Sprint(payload.Data.Providers[0].AllowedOrigins) != fmt.Sprint([]string{"https://qyapi.weixin.qq.com"}) {
		t.Fatalf("unsafe provider policy: %+v", payload.Data.Providers)
	}
	if len(payload.Data.Capabilities) != 3 || payload.Data.Capabilities[0].Path != "/v1/notifications/send" || payload.Data.Capabilities[0].RequiredScope != "notification-runtime:send" || payload.Data.Capabilities[0].TargetScope != "connector-runtime:notifications:send" {
		t.Fatalf("compatibility capability missing: %+v", payload.Data.Capabilities)
	}
}

func TestNotificationCompatibilityBoundaryRejectsGenericProxyShape(t *testing.T) {
	ledger := &fakeLedger{}
	provider := &fakeProvider{}
	handler := ledgerServer(ledger, provider)

	for _, body := range []string{
		strings.TrimSuffix(validSendBody, "}") + `,"targetUrl":"https://attacker.example"}`,
		strings.TrimSuffix(validSendBody, "}") + `,"method":"GET"}`,
		validSendBody + `{}`,
	} {
		response := request(handler, http.MethodPost, "/v1/notifications/send", body, "runtime-token")
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_json") {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
	}
	if len(ledger.claims) != 0 || provider.calls != 0 {
		t.Fatalf("generic proxy input crossed typed boundary: claims=%d calls=%d", len(ledger.claims), provider.calls)
	}

	response := request(handler, http.MethodPost, "/v1/proxy", `{}`, "runtime-token")
	if response.Code != http.StatusNotFound {
		t.Fatalf("generic proxy route status=%d, want 404", response.Code)
	}
}

func TestConnectorProfileAdvertisesTargetContractAndKeepsSendShape(t *testing.T) {
	ledger := &fakeLedger{claim: deliveryledger.Claim{DeliveryID: 21, Decision: deliveryledger.DecisionExecute, Fencing: 1}}
	provider := &fakeProvider{result: providers.SendResult{Provider: "wecom", IntegrationCode: "wecom.default", ProviderResult: map[string]any{"errcode": float64(0)}}}
	handler := connectorLedgerServer(ledger, provider)

	capabilityResponse := request(handler, http.MethodGet, "/runtime/capabilities", "", "")
	if capabilityResponse.Code != http.StatusOK || !strings.Contains(capabilityResponse.Body.String(), `"runtimeProduct":"hzy-connector-runtime"`) || !strings.Contains(capabilityResponse.Body.String(), `"requiredScope":"connector-runtime:notifications:send"`) {
		t.Fatalf("connector capabilities status=%d body=%s", capabilityResponse.Code, capabilityResponse.Body.String())
	}
	sendResponse := request(handler, http.MethodPost, "/v1/notifications/send", validSendBody, "runtime-token")
	if sendResponse.Code != http.StatusOK || provider.calls != 1 || len(ledger.succeeded) != 1 {
		t.Fatalf("connector compatibility send status=%d body=%s calls=%d checkpoints=%d", sendResponse.Code, sendResponse.Body.String(), provider.calls, len(ledger.succeeded))
	}
}

func TestConnectorPeopleJobCancelIsTypedAndIdempotent(t *testing.T) {
	started := make(chan struct{})
	handler, _ := connectorPeopleServer(t, blockingPeopleRunner{started: started})
	created := request(handler, http.MethodPost, "/v1/people-sync-jobs", `{"provider":"dingtalk","integrationCode":"dingtalk.default","objectScopes":["people"],"idempotencyKey":"server-cancel-job-0001"}`, "runtime-token")
	if created.Code != http.StatusAccepted {
		t.Fatalf("create status=%d body=%s", created.Code, created.Body.String())
	}
	var envelope struct {
		Data peoplejobs.Job `json:"data"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &envelope); err != nil || envelope.Data.JobID == "" {
		t.Fatalf("decode created job: %#v err=%v", envelope, err)
	}
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("job did not start")
	}
	for attempt := 0; attempt < 2; attempt++ {
		cancelled := request(handler, http.MethodPost, "/v1/people-sync-jobs/"+envelope.Data.JobID+"/cancel", "", "runtime-token")
		if cancelled.Code != http.StatusOK || !strings.Contains(cancelled.Body.String(), `"status":"cancelled"`) {
			t.Fatalf("cancel attempt=%d status=%d body=%s", attempt, cancelled.Code, cancelled.Body.String())
		}
	}
	retry := request(handler, http.MethodPost, "/v1/people-sync-jobs/"+envelope.Data.JobID+"/retry", "", "runtime-token")
	if retry.Code != http.StatusConflict || !strings.Contains(retry.Body.String(), "people_sync_job_not_retryable") {
		t.Fatalf("retry cancelled status=%d body=%s", retry.Code, retry.Body.String())
	}
}

func TestConnectorPeopleJobEndpointRejectsDirectoryProfileScope(t *testing.T) {
	handler, _ := connectorPeopleServer(t, blockingPeopleRunner{started: make(chan struct{})})
	response := request(handler, http.MethodPost, "/v1/people-sync-jobs", `{"provider":"dingtalk","integrationCode":"dingtalk.default","objectScopes":["people","directory_profiles"],"idempotencyKey":"server-forbidden-scope-0001"}`, "runtime-token")
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "directory_profile_scope_not_allowed") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestConnectorPeopleJobRetryRejectsHistoricalCombinedDirectoryProfileScope(t *testing.T) {
	runner := &retryPeopleRunner{}
	handler, manager := connectorPeopleServer(t, runner)
	job, created, err := manager.Start(context.Background(), peoplejobs.StartRequest{
		Provider:        "dingtalk",
		IntegrationCode: "dingtalk.default",
		ObjectScopes:    []string{"organization", "people", "directory_profiles"},
		IdempotencyKey:  "historical-combined-scope-0001",
	})
	if err != nil || !created {
		t.Fatalf("create historical job: created=%v err=%v", created, err)
	}
	waitServerPeopleJob(t, manager, job.JobID, "failed")

	retried := request(handler, http.MethodPost, "/v1/people-sync-jobs/"+job.JobID+"/retry", "", "runtime-token")
	if retried.Code != http.StatusConflict || !strings.Contains(retried.Body.String(), "directory_profile_job_retry_requires_dedicated_endpoint") {
		t.Fatalf("retry status=%d body=%s", retried.Code, retried.Body.String())
	}
	if runner.calls.Load() != 1 {
		t.Fatalf("historical directory profile job crossed retry boundary: calls=%d", runner.calls.Load())
	}
}

func TestConnectorPeopleJobRetryCreatesOneTraceableAttempt(t *testing.T) {
	runner := &retryPeopleRunner{}
	handler, manager := connectorPeopleServer(t, runner)
	created := request(handler, http.MethodPost, "/v1/people-sync-jobs", `{"provider":"dingtalk","integrationCode":"dingtalk.default","objectScopes":["people"],"idempotencyKey":"server-retry-job-0001"}`, "runtime-token")
	var original struct {
		Data peoplejobs.Job `json:"data"`
	}
	if created.Code != http.StatusAccepted || json.Unmarshal(created.Body.Bytes(), &original) != nil {
		t.Fatalf("create status=%d body=%s", created.Code, created.Body.String())
	}
	waitServerPeopleJob(t, manager, original.Data.JobID, "failed")

	retried := request(handler, http.MethodPost, "/v1/people-sync-jobs/"+original.Data.JobID+"/retry", "", "runtime-token")
	if retried.Code != http.StatusAccepted || !strings.Contains(retried.Body.String(), `"retryOfJobId":"`+original.Data.JobID+`"`) {
		t.Fatalf("retry status=%d body=%s", retried.Code, retried.Body.String())
	}
	var retryEnvelope struct {
		Data peoplejobs.Job `json:"data"`
	}
	if err := json.Unmarshal(retried.Body.Bytes(), &retryEnvelope); err != nil {
		t.Fatal(err)
	}
	replayed := request(handler, http.MethodPost, "/v1/people-sync-jobs/"+original.Data.JobID+"/retry", "", "runtime-token")
	if replayed.Code != http.StatusOK || !strings.Contains(replayed.Body.String(), `"jobId":"`+retryEnvelope.Data.JobID+`"`) {
		t.Fatalf("retry replay status=%d body=%s", replayed.Code, replayed.Body.String())
	}
	waitServerPeopleJob(t, manager, retryEnvelope.Data.JobID, "success")
	capabilities := request(handler, http.MethodGet, "/runtime/capabilities", "", "")
	for _, expected := range []string{"people.sync.jobs.cancel", "connector-runtime:jobs:cancel", "people.sync.jobs.retry"} {
		if !strings.Contains(capabilities.Body.String(), expected) {
			t.Fatalf("capabilities missing %q: %s", expected, capabilities.Body.String())
		}
	}
}

func TestIdentityExchangeExistsOnlyOnConnectorAndRejectsProxyFields(t *testing.T) {
	identity := providers.IdentityExchangeResult{Provider: "wecom", IntegrationCode: "wecom.default"}
	identity.Subject.ID = "zhangsan"
	identity.Subject.Kind = "member"
	provider := &fakeProvider{identityResult: identity}
	connector := connectorLedgerServer(&fakeLedger{}, provider)

	capabilities := request(connector, http.MethodGet, "/runtime/capabilities", "", "")
	if !strings.Contains(capabilities.Body.String(), `"code":"identity.wecom.exchange"`) || !strings.Contains(capabilities.Body.String(), `"requiredScope":"connector-runtime:identity:exchange"`) {
		t.Fatalf("identity capability missing: %s", capabilities.Body.String())
	}
	response := request(connector, http.MethodPost, "/v1/identity/wecom/exchange", `{"integrationCode":"wecom.default","authorizationCode":"one-time-code"}`, "runtime-token")
	if response.Code != http.StatusOK || provider.identityCalls != 1 || !strings.Contains(response.Body.String(), `"id":"zhangsan"`) {
		t.Fatalf("identity exchange status=%d body=%s calls=%d", response.Code, response.Body.String(), provider.identityCalls)
	}
	proxyShape := request(connector, http.MethodPost, "/v1/identity/wecom/exchange", `{"integrationCode":"wecom.default","authorizationCode":"one-time-code","targetUrl":"https://attacker.example"}`, "runtime-token")
	if proxyShape.Code != http.StatusBadRequest || provider.identityCalls != 1 {
		t.Fatalf("proxy-shaped identity request crossed boundary: status=%d body=%s calls=%d", proxyShape.Code, proxyShape.Body.String(), provider.identityCalls)
	}

	notification := ledgerServer(&fakeLedger{}, &fakeProvider{})
	notFound := request(notification, http.MethodPost, "/v1/identity/wecom/exchange", `{"integrationCode":"wecom.default","authorizationCode":"one-time-code"}`, "runtime-token")
	if notFound.Code != http.StatusNotFound {
		t.Fatalf("notification runtime identity route status=%d, want 404", notFound.Code)
	}
}

func TestWeComBrowserCallbackUsesSingleUseConnectorHandoff(t *testing.T) {
	identity := providers.IdentityExchangeResult{Provider: "wecom", IntegrationCode: "wecom.default"}
	identity.Subject.ID = "liukai"
	identity.Subject.Kind = "member"
	provider := &fakeProvider{identityResult: identity}
	store, err := identityhandoff.Open(context.Background(), filepath.Join(t.TempDir(), "operations.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	cfg := config.Config{
		Tenant: "C000001", Deployment: "C000001-console",
		Console: config.ConsoleConfig{BaseURL: "https://wiztek.huizhi.yun"},
		Auth:    config.AuthConfig{Mode: config.AuthStaticToken, StaticToken: "runtime-token"},
	}
	server := NewWithProfileAndDependencies(cfg, ConnectorProfile(), &fakeLedger{}, provider)
	server.SetWeComHandoffs(store)
	handler := server.Handler()
	state := "hzy_es_state-value-with-enough-entropy"
	created := request(handler, http.MethodPost, "/v1/identity/wecom/authorizations", `{"integrationCode":"wecom.default","state":"`+state+`"}`, "runtime-token")
	if created.Code != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", created.Code, created.Body.String())
	}
	var creation struct {
		Data struct {
			AuthorizationID string `json:"authorizationId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &creation); err != nil || creation.Data.AuthorizationID == "" {
		t.Fatalf("decode creation: %#v err=%v", creation, err)
	}
	callback := request(handler, http.MethodGet, "/v1/identity/wecom/callback?authorizationId="+url.QueryEscape(creation.Data.AuthorizationID)+"&state="+url.QueryEscape(state)+"&code=provider-code", "", "")
	if callback.Code != http.StatusFound || provider.identityCalls != 1 {
		t.Fatalf("callback status=%d body=%s calls=%d", callback.Code, callback.Body.String(), provider.identityCalls)
	}
	location, err := url.Parse(callback.Header().Get("Location"))
	if err != nil || location.Host != "wiztek.huizhi.yun" || location.Path != "/api/auth/wecom-callback" {
		t.Fatalf("callback location=%q err=%v", callback.Header().Get("Location"), err)
	}
	ticket := location.Query().Get("handoffTicket")
	if ticket == "" || location.Query().Get("state") != state {
		t.Fatalf("callback query=%s", location.RawQuery)
	}
	body := `{"integrationCode":"wecom.default","handoffTicket":"` + ticket + `"}`
	redeemed := request(handler, http.MethodPost, "/v1/identity/wecom/handoffs/redeem", body, "runtime-token")
	if redeemed.Code != http.StatusOK || !strings.Contains(redeemed.Body.String(), `"id":"liukai"`) {
		t.Fatalf("redeem status=%d body=%s", redeemed.Code, redeemed.Body.String())
	}
	replayed := request(handler, http.MethodPost, "/v1/identity/wecom/handoffs/redeem", body, "runtime-token")
	if replayed.Code != http.StatusConflict {
		t.Fatalf("replay status=%d body=%s", replayed.Code, replayed.Body.String())
	}
}

func TestDingTalkIdentityExchangeUsesDistinctTypedRoute(t *testing.T) {
	identity := providers.IdentityExchangeResult{Provider: "dingtalk", IntegrationCode: "dingtalk.default"}
	identity.Subject.ID = "staff-1001"
	identity.Subject.Kind = "member"
	provider := &fakeProvider{dingIdentityResult: identity}
	connector := connectorLedgerServer(&fakeLedger{}, provider)

	capabilities := request(connector, http.MethodGet, "/runtime/capabilities", "", "")
	if !strings.Contains(capabilities.Body.String(), `"code":"identity.dingtalk.exchange"`) || !strings.Contains(capabilities.Body.String(), `"requiredScope":"connector-runtime:identity:dingtalk:exchange"`) {
		t.Fatalf("DingTalk identity capability missing: %s", capabilities.Body.String())
	}
	response := request(connector, http.MethodPost, "/v1/identity/dingtalk/exchange", `{"integrationCode":"dingtalk.default","authorizationCode":"one-time-code"}`, "runtime-token")
	if response.Code != http.StatusOK || provider.dingIdentityCalls != 1 || !strings.Contains(response.Body.String(), `"id":"staff-1001"`) {
		t.Fatalf("DingTalk identity exchange status=%d body=%s calls=%d", response.Code, response.Body.String(), provider.dingIdentityCalls)
	}
	proxyShape := request(connector, http.MethodPost, "/v1/identity/dingtalk/exchange", `{"integrationCode":"dingtalk.default","authorizationCode":"one-time-code","headers":{"x":"y"}}`, "runtime-token")
	if proxyShape.Code != http.StatusBadRequest || provider.dingIdentityCalls != 1 {
		t.Fatalf("proxy-shaped DingTalk request crossed boundary: status=%d body=%s", proxyShape.Code, proxyShape.Body.String())
	}
}

func TestDingTalkIdentityExchangeLogsOnlySafeFailureCode(t *testing.T) {
	var logs bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(previous)

	provider := &fakeProvider{dingIdentityErr: httperror.New(http.StatusBadGateway, "dingtalk_identity_profile_failed", "provider detail")}
	connector := connectorLedgerServer(&fakeLedger{}, provider)
	response := request(connector, http.MethodPost, "/v1/identity/dingtalk/exchange", `{"integrationCode":"dingtalk.identity","authorizationCode":"one-time-code"}`, "runtime-token")
	if response.Code != http.StatusBadGateway || !strings.Contains(response.Body.String(), `"error":"dingtalk_identity_profile_failed"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(logs.String(), "dingtalk identity exchange failed code=dingtalk_identity_profile_failed") || strings.Contains(logs.String(), "provider detail") || strings.Contains(logs.String(), "one-time-code") {
		t.Fatalf("unsafe or incomplete identity failure log: %s", logs.String())
	}
}

func TestDeliveryListIsTenantScopedFilteredPaginatedAndRedacted(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	ledger := &fakeLedger{listResult: deliveryledger.ListResult{
		Deliveries: []deliveryledger.Delivery{{
			ID: 42, SourceApp: "workflow", Provider: "wecom", Integration: "wecom.default",
			State: deliveryledger.StatePartialUnknown, AttemptCount: 2, LastErrorCode: "transport_unknown",
			CreatedAt: now, UpdatedAt: now,
		}},
		NextID: 40,
	}}
	response := request(ledgerServer(ledger, &fakeProvider{}), http.MethodGet, "/v1/deliveries?status=partial_unknown&limit=25&cursor="+encodeDeliveryCursor(50), "", "runtime-token")
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if len(ledger.lists) != 1 {
		t.Fatalf("lists=%+v", ledger.lists)
	}
	input := ledger.lists[0]
	if input.Tenant != "C000001" || input.Deployment != "prod" || input.State != deliveryledger.StatePartialUnknown || input.Limit != 25 || input.BeforeID != 50 {
		t.Fatalf("unsafe list scope/filter=%+v", input)
	}
	body := response.Body.String()
	for _, forbidden := range []string{"idempotencyKey", "requestHash", "touser", "recipient", "token", "https://", "providerBody", "resultJson"} {
		if strings.Contains(strings.ToLower(body), strings.ToLower(forbidden)) {
			t.Fatalf("list leaked %q: %s", forbidden, body)
		}
	}
	if !strings.Contains(body, encodeDeliveryCursor(40)) {
		t.Fatalf("missing stable cursor: %s", body)
	}
}

func TestDeliveryListRejectsInvalidBoundsBeforeStore(t *testing.T) {
	for _, path := range []string{"/v1/deliveries?limit=0", "/v1/deliveries?limit=101", "/v1/deliveries?cursor=bad", "/v1/deliveries?status=unknown"} {
		ledger := &fakeLedger{}
		response := request(ledgerServer(ledger, &fakeProvider{}), http.MethodGet, path, "", "runtime-token")
		if response.Code != http.StatusBadRequest || len(ledger.lists) != 0 {
			t.Fatalf("path=%s status=%d lists=%d body=%s", path, response.Code, len(ledger.lists), response.Body.String())
		}
	}
}

func TestReconcileRequiresEvidenceAndPassesTrustedActorContext(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	ledger := &fakeLedger{reconcileResult: deliveryledger.ReconcileResult{
		Delivery: deliveryledger.Delivery{ID: 42, SourceApp: "workflow", Provider: "wecom", Integration: "wecom.default", State: deliveryledger.StateFailed, AttemptCount: 1, CreatedAt: now, UpdatedAt: now},
		AuditID:  7,
	}}
	body := `{"expectedStatus":"partial_unknown","result":"failed","reason":"Provider admin confirmed no message was accepted","evidence":{"type":"provider_admin_confirmation","reference":"INC-2026-0042"}}`
	response := request(ledgerServer(ledger, &fakeProvider{}), http.MethodPost, "/v1/deliveries/42/reconcile", body, "runtime-token")
	if response.Code != http.StatusOK || len(ledger.reconciles) != 1 {
		t.Fatalf("status=%d body=%s reconciles=%+v", response.Code, response.Body.String(), ledger.reconciles)
	}
	input := ledger.reconciles[0]
	if input.Tenant != "C000001" || input.Deployment != "prod" || input.ActorSourceApp != "static-token-client" || input.ActorClientID != "static-token-client" || input.ExpectedState != deliveryledger.StatePartialUnknown || input.Result != deliveryledger.StateFailed {
		t.Fatalf("reconcile input=%+v", input)
	}
	if strings.Contains(response.Body.String(), input.Reason) || strings.Contains(response.Body.String(), input.EvidenceReference) {
		t.Fatalf("response exposed evidence detail: %s", response.Body.String())
	}
}

func TestReconcileNeverResetsKnownOrActiveStates(t *testing.T) {
	ledger := &fakeLedger{reconcileErr: deliveryledger.ErrInvalidState}
	body := `{"expectedStatus":"partial_unknown","result":"failed","reason":"Provider admin confirmed no message was accepted","evidence":{"type":"provider_admin_confirmation","reference":"INC-2026-0042"}}`
	response := request(ledgerServer(ledger, &fakeProvider{}), http.MethodPost, "/v1/deliveries/42/reconcile", body, "runtime-token")
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "delivery_state_conflict") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestHealthFailsClosedWhenDeliveryStoreIsUnavailable(t *testing.T) {
	handler := New(config.Config{Tenant: "C000001", Deployment: "prod"}).Handler()
	health := request(handler, http.MethodGet, "/runtime/health", "", "")
	if health.Code != http.StatusServiceUnavailable || !strings.Contains(health.Body.String(), `"deliveryStore":"unavailable"`) {
		t.Fatalf("health status=%d body=%s", health.Code, health.Body.String())
	}
}

func TestSendRequiresRuntimeToken(t *testing.T) {
	handler := testServer()

	missing := request(handler, http.MethodPost, "/v1/notifications/send", "{}", "")
	if missing.Code != http.StatusUnauthorized {
		t.Fatalf("missing token status = %d, want %d", missing.Code, http.StatusUnauthorized)
	}

	invalid := request(handler, http.MethodPost, "/v1/notifications/send", "{}", "wrong")
	if invalid.Code != http.StatusUnauthorized {
		t.Fatalf("invalid token status = %d, want %d", invalid.Code, http.StatusUnauthorized)
	}

	accepted := request(handler, http.MethodPost, "/v1/notifications/send", "{", "runtime-token")
	if accepted.Code != http.StatusBadRequest {
		t.Fatalf("accepted token status = %d, want request body validation after auth", accepted.Code)
	}
}

func TestSensitiveBusinessActionRoutesAreNotExposed(t *testing.T) {
	handler := testServer()
	sensitivePaths := []string{
		"/v1/notifications/approve",
		"/v1/notifications/confirm",
		"/v1/notifications/export",
		"/v1/notifications/deploy",
		"/v1/notifications/download",
		"/v1/notifications/release",
		"/v1/deliveries/42/retry",
		"/v1/deliveries/42/reset",
	}

	for _, path := range sensitivePaths {
		recorder := request(handler, http.MethodPost, path, "{}", "runtime-token")
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("%s status = %d, want %d", path, recorder.Code, http.StatusNotFound)
		}
	}
}

func TestSendFailsClosedWithoutDeliveryStore(t *testing.T) {
	provider := &fakeProvider{}
	handler := NewWithDependencies(config.Config{
		Tenant: "C000001", Deployment: "prod",
		Auth: config.AuthConfig{Mode: config.AuthStaticToken, StaticToken: "runtime-token"},
	}, nil, provider).Handler()
	response := request(handler, http.MethodPost, "/v1/notifications/send", validSendBody, "runtime-token")
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if provider.calls != 0 {
		t.Fatalf("provider calls=%d", provider.calls)
	}
}

func TestSucceededReplayDoesNotCallProvider(t *testing.T) {
	stored := []byte(`{"provider":"wecom","integrationCode":"wecom.default","providerResult":{"errcode":0,"msgid":"m1"}}`)
	ledger := &fakeLedger{claim: deliveryledger.Claim{DeliveryID: 1, Decision: deliveryledger.DecisionReplaySucceeded, State: deliveryledger.StateSucceeded, Fencing: 1, ResultJSON: stored}}
	provider := &fakeProvider{}
	response := request(ledgerServer(ledger, provider), http.MethodPost, "/v1/notifications/send", validSendBody, "runtime-token")
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if provider.calls != 0 {
		t.Fatalf("provider calls=%d", provider.calls)
	}
	if !strings.Contains(response.Body.String(), `"replayed":true`) {
		t.Fatalf("replay marker missing: %s", response.Body.String())
	}
}

func TestProcessingUnknownAndHashConflictNeverCallProvider(t *testing.T) {
	tests := []struct {
		name  string
		claim deliveryledger.Claim
		err   error
		code  string
	}{
		{"processing", deliveryledger.Claim{Decision: deliveryledger.DecisionInProgress}, nil, "delivery_in_progress"},
		{"unknown", deliveryledger.Claim{Decision: deliveryledger.DecisionPartialUnknown}, nil, "delivery_outcome_unknown"},
		{"hash mismatch", deliveryledger.Claim{}, deliveryledger.ErrPayloadMismatch, "idempotency_payload_mismatch"},
	}
	for _, item := range tests {
		t.Run(item.name, func(t *testing.T) {
			ledger := &fakeLedger{claim: item.claim, claimErr: item.err}
			provider := &fakeProvider{}
			response := request(ledgerServer(ledger, provider), http.MethodPost, "/v1/notifications/send", validSendBody, "runtime-token")
			if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), item.code) {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if provider.calls != 0 {
				t.Fatalf("provider calls=%d", provider.calls)
			}
		})
	}
}

func TestProviderResultIsMinimizedAndCheckpointed(t *testing.T) {
	ledger := &fakeLedger{claim: deliveryledger.Claim{DeliveryID: 11, Decision: deliveryledger.DecisionExecute, Fencing: 2}}
	provider := &fakeProvider{result: providers.SendResult{
		Provider: "wecom", IntegrationCode: "wecom.default",
		ProviderResult: map[string]any{"errcode": float64(0), "msgid": "m1", "errmsg": "secret upstream detail", "access_token": "secret"},
	}}
	response := request(ledgerServer(ledger, provider), http.MethodPost, "/v1/notifications/send", validSendBody, "runtime-token")
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "secret") {
		t.Fatalf("response leaked provider detail: %s", response.Body.String())
	}
	if len(ledger.succeeded) != 1 || strings.Contains(string(ledger.succeeded[0].ResultJSON), "secret") {
		t.Fatalf("checkpoint=%+v", ledger.succeeded)
	}
}

func TestProviderFailuresUseKnownAndUnknownCheckpoints(t *testing.T) {
	tests := []struct {
		name        string
		providerErr error
		unknown     bool
	}{
		{"known", httperror.New(http.StatusBadGateway, "wecom_send_error", "raw provider body secret"), false},
		{"unknown", httperror.New(http.StatusBadGateway, "wecom_send_request_failed", "URL with access_token=secret"), true},
	}
	for _, item := range tests {
		t.Run(item.name, func(t *testing.T) {
			ledger := &fakeLedger{claim: deliveryledger.Claim{DeliveryID: 12, Decision: deliveryledger.DecisionExecute, Fencing: 3}}
			provider := &fakeProvider{err: item.providerErr}
			response := request(ledgerServer(ledger, provider), http.MethodPost, "/v1/notifications/send", validSendBody, "runtime-token")
			if response.Code != http.StatusBadGateway {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			var checkpoint deliveryledger.Completion
			if item.unknown {
				if len(ledger.unknown) != 1 {
					t.Fatal("missing unknown checkpoint")
				}
				checkpoint = ledger.unknown[0]
			} else {
				if len(ledger.failed) != 1 {
					t.Fatal("missing fail checkpoint")
				}
				checkpoint = ledger.failed[0]
			}
			if strings.Contains(checkpoint.ErrorSummary, "secret") || checkpoint.ErrorSummary != "Notification provider request failed" {
				t.Fatalf("unsafe summary=%q", checkpoint.ErrorSummary)
			}
		})
	}
}

func TestSuccessCheckpointFailureAttemptsUnknownFence(t *testing.T) {
	ledger := &fakeLedger{claim: deliveryledger.Claim{DeliveryID: 13, Decision: deliveryledger.DecisionExecute, Fencing: 4}, succeedErr: errors.New("db unavailable")}
	provider := &fakeProvider{result: providers.SendResult{Provider: "wecom", IntegrationCode: "wecom.default", ProviderResult: map[string]any{"errcode": float64(0)}}}
	response := request(ledgerServer(ledger, provider), http.MethodPost, "/v1/notifications/send", validSendBody, "runtime-token")
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if len(ledger.unknown) != 1 || ledger.unknown[0].ErrorCode != "success_checkpoint_failed" {
		t.Fatalf("unknown=%+v", ledger.unknown)
	}
}
