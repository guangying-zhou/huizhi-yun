package console

import (
	"bytes"
	"context"
	"encoding/json"
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
	if c.cfg.BaseURL == "" {
		return Integration{}, httperror.New(http.StatusServiceUnavailable, "console_unconfigured", "Console API URL is not configured")
	}
	token, err := c.accessToken(ctx, "integration_config", "integration_config:view")
	if err != nil {
		return Integration{}, err
	}
	endpoint := c.cfg.BaseURL + "/api/v1/console/integrations/" + url.PathEscape(integrationCode)
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

func (c *Client) ResolveSecret(ctx context.Context, secretRef string, purpose string) (Secret, error) {
	if c.cfg.BaseURL == "" {
		return Secret{}, httperror.New(http.StatusServiceUnavailable, "console_unconfigured", "Console API URL is not configured")
	}
	if strings.TrimSpace(secretRef) == "" {
		return Secret{}, httperror.New(http.StatusBadGateway, "missing_secret_ref", "Integration credential secretRef is empty")
	}
	token, err := c.accessToken(ctx, "credential_vault", "credential_vault:resolve")
	if err != nil {
		return Secret{}, err
	}
	body, _ := json.Marshal(map[string]string{
		"secretRef": secretRef,
		"purpose":   first(purpose, "notification_runtime"),
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.BaseURL+"/api/v1/console/vault/resolve", bytes.NewReader(body))
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

func (c *Client) accessToken(ctx context.Context, audience string, scope string) (string, error) {
	if c.cfg.TokenURL == "" || c.cfg.ClientID == "" || c.cfg.ClientSecret == "" {
		return "", httperror.New(http.StatusServiceUnavailable, "console_client_unconfigured", "Console service client is not configured")
	}

	cacheKey := c.cfg.TokenURL + "|" + c.cfg.ClientID + "|" + audience + "|" + scope
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
