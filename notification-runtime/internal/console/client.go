package console

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/huizhi-yun/notification-runtime/internal/config"
	"github.com/huizhi-yun/notification-runtime/internal/httperror"
)

type Client struct {
	cfg    config.ConsoleConfig
	http   *http.Client
	mutex  sync.Mutex
	tokens map[string]tokenCacheEntry
}

type tokenCacheEntry struct {
	AccessToken string
	ExpiresAt   time.Time
}

type tokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int    `json:"expires_in"`
}

type envelope[T any] struct {
	Code    *int   `json:"code"`
	Data    T      `json:"data"`
	Message string `json:"message"`
}

type Integration struct {
	IntegrationCode   string         `json:"integrationCode"`
	ProviderCode      string         `json:"providerCode"`
	BaseURL           string         `json:"baseUrl"`
	Config            map[string]any `json:"config"`
	CurrentCredential *Credential    `json:"currentCredential"`
}

type Credential struct {
	SecretRef string `json:"secretRef"`
	VersionNo int    `json:"versionNo"`
}

type Secret struct {
	Value     string `json:"value"`
	VersionNo int    `json:"versionNo"`
}

type ConnectorHeartbeat struct {
	ConnectorID  string         `json:"connectorId"`
	Version      string         `json:"version"`
	Capabilities []string       `json:"capabilities"`
	StartedAt    string         `json:"startedAt"`
	Metrics      map[string]any `json:"metrics"`
}

type ConnectorHeartbeatResult struct {
	Status               string `json:"status"`
	NextHeartbeatSeconds int    `json:"nextHeartbeatSeconds"`
}

type DirectoryProfileUser struct {
	ProviderSubject string `json:"providerSubject"`
	Email           string `json:"email"`
	Name            string `json:"name"`
}

type DirectoryProfileBatch struct {
	JobID           string                 `json:"jobId"`
	BatchNumber     int                    `json:"batchNumber"`
	Final           bool                   `json:"final"`
	Provider        string                 `json:"provider"`
	IntegrationCode string                 `json:"integrationCode"`
	Watermark       string                 `json:"watermark"`
	Users           []DirectoryProfileUser `json:"users"`
}

type DirectoryProfileFailure struct {
	JobID           string `json:"jobId"`
	Provider        string `json:"provider"`
	IntegrationCode string `json:"integrationCode"`
	Watermark       string `json:"watermark"`
	ErrorCode       string `json:"errorCode"`
	ErrorMessage    string `json:"errorMessage"`
}

type DirectoryProfileResult struct {
	Updated int  `json:"updated"`
	Skipped int  `json:"skipped"`
	Final   bool `json:"final"`
}

func New(cfg config.ConsoleConfig) *Client {
	return &Client{
		cfg: cfg,
		http: &http.Client{
			Timeout: cfg.Timeout,
		},
		tokens: make(map[string]tokenCacheEntry),
	}
}

func (c *Client) Integration(ctx context.Context, integrationCode string) (Integration, error) {
	if c.cfg.ServiceURL == "" {
		return Integration{}, httperror.New(http.StatusServiceUnavailable, "tenant_runtime_unconfigured", "Tenant Runtime service API URL is not configured")
	}
	token, err := c.accessToken(ctx, "data-runtime", "data-runtime:integration_config:view")
	if err != nil {
		return Integration{}, err
	}
	endpoint := c.cfg.ServiceURL + "/v1/console/service/integrations/" + url.PathEscape(integrationCode)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return Integration{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)

	var response envelope[Integration]
	if err := c.doJSON(req, &response); err != nil {
		return Integration{}, err
	}
	if response.Code != nil && *response.Code != 0 {
		return Integration{}, httperror.New(http.StatusBadGateway, "console_integration_error", first(response.Message, "Console integration API returned an error"))
	}
	return response.Data, nil
}

func (c *Client) ResolveSecret(ctx context.Context, integrationCode string) (Secret, error) {
	if c.cfg.ServiceURL == "" {
		return Secret{}, httperror.New(http.StatusServiceUnavailable, "tenant_runtime_unconfigured", "Tenant Runtime service API URL is not configured")
	}
	if strings.TrimSpace(integrationCode) == "" {
		return Secret{}, httperror.New(http.StatusBadGateway, "missing_integration_code", "Integration code is empty")
	}
	token, err := c.accessToken(ctx, "data-runtime", "data-runtime:credential_vault:resolve")
	if err != nil {
		return Secret{}, err
	}
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.cfg.ServiceURL+"/v1/console/service/integrations/"+url.PathEscape(integrationCode)+"/resolve",
		bytes.NewReader([]byte("{}")),
	)
	if err != nil {
		return Secret{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	var response envelope[Secret]
	if err := c.doJSON(req, &response); err != nil {
		return Secret{}, err
	}
	if response.Code != nil && *response.Code != 0 {
		return Secret{}, httperror.New(http.StatusBadGateway, "console_vault_error", first(response.Message, "Console vault API returned an error"))
	}
	return response.Data, nil
}

func (c *Client) ConnectorHeartbeat(ctx context.Context, heartbeat ConnectorHeartbeat) (ConnectorHeartbeatResult, error) {
	if c.cfg.BaseURL == "" {
		return ConnectorHeartbeatResult{}, httperror.New(http.StatusServiceUnavailable, "console_unconfigured", "Console API URL is not configured")
	}
	const audience = "console"
	const scope = "console:connector-runtime:heartbeat"
	token, err := c.accessToken(ctx, audience, scope)
	if err != nil {
		return ConnectorHeartbeatResult{}, err
	}
	result, err := c.connectorHeartbeat(ctx, heartbeat, token)
	if !isAuthorizationRejection(err) {
		return result, err
	}

	// A cached token can become unverifiable during a transient Console/runtime
	// cutover even though the connector credential is still active. Refresh it
	// once before treating the device identity as revoked.
	c.invalidateAccessToken(audience, scope, token)
	token, err = c.accessToken(ctx, audience, scope)
	if err != nil {
		return ConnectorHeartbeatResult{}, err
	}
	return c.connectorHeartbeat(ctx, heartbeat, token)
}

func (c *Client) connectorHeartbeat(ctx context.Context, heartbeat ConnectorHeartbeat, token string) (ConnectorHeartbeatResult, error) {
	body, err := json.Marshal(heartbeat)
	if err != nil {
		return ConnectorHeartbeatResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.BaseURL+"/api/v1/console/service/connector-runtime/heartbeat", bytes.NewReader(body))
	if err != nil {
		return ConnectorHeartbeatResult{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	var response envelope[ConnectorHeartbeatResult]
	if err := c.doJSON(req, &response); err != nil {
		return ConnectorHeartbeatResult{}, err
	}
	if response.Code != nil && *response.Code != 0 {
		return ConnectorHeartbeatResult{}, httperror.New(http.StatusBadGateway, "console_heartbeat_error", first(response.Message, "Console rejected Connector Runtime heartbeat"))
	}
	return response.Data, nil
}

func (c *Client) SyncDirectoryProfiles(ctx context.Context, batch DirectoryProfileBatch) (DirectoryProfileResult, error) {
	token, err := c.accessToken(ctx, "console", "console:directory-profiles:sync")
	if err != nil {
		return DirectoryProfileResult{}, err
	}
	body, err := json.Marshal(batch)
	if err != nil {
		return DirectoryProfileResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.BaseURL+"/api/v1/console/service/directory/dingtalk-profile-sync-batches", bytes.NewReader(body))
	if err != nil {
		return DirectoryProfileResult{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", fmt.Sprintf("connector-runtime:dingtalk-directory-profile:%s:%d:v1", batch.JobID, batch.BatchNumber))
	var response envelope[DirectoryProfileResult]
	if err := c.doJSON(req, &response); err != nil {
		return DirectoryProfileResult{}, err
	}
	if response.Code != nil && *response.Code != 0 {
		return DirectoryProfileResult{}, httperror.New(http.StatusBadGateway, "console_directory_profile_error", first(response.Message, "Console rejected DingTalk directory profiles"))
	}
	return response.Data, nil
}

func (c *Client) FailDirectoryProfileSync(ctx context.Context, failure DirectoryProfileFailure) error {
	token, err := c.accessToken(ctx, "console", "console:directory-profiles:sync")
	if err != nil {
		return err
	}
	body, err := json.Marshal(failure)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.BaseURL+"/api/v1/console/service/directory/dingtalk-profile-sync-failures", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", fmt.Sprintf("connector-runtime:dingtalk-directory-profile:%s:failure:v1", failure.JobID))
	var response envelope[map[string]any]
	return c.doJSON(req, &response)
}

func (c *Client) accessToken(ctx context.Context, audience string, scope string) (string, error) {
	if c.cfg.TokenURL == "" || c.cfg.ClientID == "" || c.cfg.ClientSecret == "" {
		return "", httperror.New(http.StatusServiceUnavailable, "console_client_unconfigured", "Console service client is not configured")
	}

	cacheKey := c.tokenCacheKey(audience, scope)
	c.mutex.Lock()
	cached := c.tokens[cacheKey]
	c.mutex.Unlock()
	if cached.AccessToken != "" && cached.ExpiresAt.After(time.Now().Add(30*time.Second)) {
		return cached.AccessToken, nil
	}

	form := url.Values{}
	form.Set("grant_type", "client_credentials")
	form.Set("client_id", c.cfg.ClientID)
	form.Set("client_secret", c.cfg.ClientSecret)
	form.Set("audience", audience)
	form.Set("scope", scope)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	var response tokenResponse
	if err := c.doJSON(req, &response); err != nil {
		return "", err
	}
	if response.AccessToken == "" || !strings.EqualFold(response.TokenType, "bearer") {
		return "", httperror.New(http.StatusBadGateway, "invalid_console_token_response", "Console did not return a bearer access token")
	}
	expiresIn := response.ExpiresIn
	if expiresIn < 60 {
		expiresIn = 900
	}

	c.mutex.Lock()
	c.tokens[cacheKey] = tokenCacheEntry{
		AccessToken: response.AccessToken,
		ExpiresAt:   time.Now().Add(time.Duration(expiresIn) * time.Second),
	}
	c.mutex.Unlock()
	return response.AccessToken, nil
}

func (c *Client) tokenCacheKey(audience string, scope string) string {
	return c.cfg.TokenURL + "|" + c.cfg.ClientID + "|" + audience + "|" + scope
}

func (c *Client) invalidateAccessToken(audience string, scope string, rejectedToken string) {
	cacheKey := c.tokenCacheKey(audience, scope)
	c.mutex.Lock()
	defer c.mutex.Unlock()
	if cached := c.tokens[cacheKey]; cached.AccessToken == rejectedToken {
		delete(c.tokens, cacheKey)
	}
}

func isAuthorizationRejection(err error) bool {
	var httpError *httperror.Error
	return errors.As(err, &httpError) &&
		(httpError.Status == http.StatusUnauthorized || httpError.Status == http.StatusForbidden)
}

func (c *Client) doJSON(req *http.Request, target any) error {
	resp, err := c.http.Do(req)
	if err != nil {
		return httperror.New(http.StatusBadGateway, "console_request_failed", err.Error())
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode >= 400 {
		return httperror.New(resp.StatusCode, "console_request_failed", string(body))
	}
	if err := json.Unmarshal(body, target); err != nil {
		return fmt.Errorf("invalid console JSON response: %w", err)
	}
	return nil
}

func first(values ...string) string {
	for _, value := range values {
		normalized := strings.TrimSpace(value)
		if normalized != "" {
			return normalized
		}
	}
	return ""
}
