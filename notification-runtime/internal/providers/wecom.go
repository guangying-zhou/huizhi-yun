package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	consoleclient "github.com/huizhi-yun/notification-runtime/internal/console"
	"github.com/huizhi-yun/notification-runtime/internal/httperror"
)

const DefaultWeComBaseURL = "https://qyapi.weixin.qq.com"

type WeComProvider struct {
	console *consoleclient.Client
	http    *http.Client
	mutex   sync.Mutex
	tokens  map[string]wecomToken
}

type SendRequest struct {
	Channel         string `json:"channel"`
	IntegrationCode string `json:"integrationCode"`
	ToUser          any    `json:"touser"`
	Title           string `json:"title"`
	Description     string `json:"description"`
	URL             string `json:"url"`
	ButtonText      string `json:"btntxt"`
	IdempotencyKey  string `json:"idempotencyKey"`
}

type SendResult struct {
	Provider        string         `json:"provider"`
	IntegrationCode string         `json:"integrationCode"`
	ProviderResult  map[string]any `json:"providerResult"`
}

type wecomToken struct {
	AccessToken string
	ExpiresAt   time.Time
}

type wecomTokenResponse struct {
	ErrCode     int    `json:"errcode"`
	ErrMsg      string `json:"errmsg"`
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
}

func NewWeComProvider(console *consoleclient.Client) *WeComProvider {
	return &WeComProvider{
		console: console,
		http: &http.Client{
			Timeout: 10 * time.Second,
		},
		tokens: make(map[string]wecomToken),
	}
}

func (p *WeComProvider) Send(ctx context.Context, input SendRequest) (SendResult, error) {
	integrationCode := first(input.IntegrationCode, "wecom.default")
	touser := normalizeToUser(input.ToUser)
	if touser == "" {
		return SendResult{}, httperror.New(http.StatusBadRequest, "invalid_touser", "touser is required")
	}
	if strings.TrimSpace(input.Title) == "" || strings.TrimSpace(input.Description) == "" || strings.TrimSpace(input.URL) == "" {
		return SendResult{}, httperror.New(http.StatusBadRequest, "invalid_message", "title, description and url are required")
	}

	integration, err := p.console.Integration(ctx, integrationCode)
	if err != nil {
		return SendResult{}, err
	}
	if integration.CurrentCredential == nil || integration.CurrentCredential.SecretRef == "" {
		return SendResult{}, httperror.New(http.StatusBadGateway, "wecom_secret_unconfigured", "WeCom integration credential is not configured")
	}
	secret, err := p.console.ResolveSecret(ctx, integration.CurrentCredential.SecretRef, "notification_runtime_wecom")
	if err != nil {
		return SendResult{}, err
	}

	baseURL := strings.TrimRight(first(integration.BaseURL, stringFromMap(integration.Config, "baseUrl"), DefaultWeComBaseURL), "/")
	corpID := first(
		stringFromMap(integration.Config, "corpid"),
		stringFromMap(integration.Config, "corpId"),
		stringFromMap(integration.Config, "corp_id"),
	)
	agentID := first(
		stringFromMap(integration.Config, "agentid"),
		stringFromMap(integration.Config, "agentId"),
		stringFromMap(integration.Config, "agent_id"),
	)
	if corpID == "" || agentID == "" || secret.Value == "" {
		return SendResult{}, httperror.New(http.StatusBadGateway, "wecom_config_incomplete", "WeCom corpid, agentid or corpsecret is missing")
	}

	accessToken, err := p.accessToken(ctx, baseURL, integrationCode, corpID, secret.Value, secret.VersionNo)
	if err != nil {
		return SendResult{}, err
	}
	response, err := p.sendTextCard(ctx, baseURL, accessToken, touser, agentID, input)
	if err != nil {
		p.evictToken(integrationCode, secret.VersionNo)
		return SendResult{}, err
	}

	return SendResult{
		Provider:        "wecom",
		IntegrationCode: integrationCode,
		ProviderResult:  response,
	}, nil
}

func (p *WeComProvider) accessToken(ctx context.Context, baseURL string, integrationCode string, corpID string, corpSecret string, versionNo int) (string, error) {
	cacheKey := fmt.Sprintf("%s|%d", integrationCode, versionNo)
	p.mutex.Lock()
	cached := p.tokens[cacheKey]
	p.mutex.Unlock()
	if cached.AccessToken != "" && cached.ExpiresAt.After(time.Now().Add(2*time.Minute)) {
		return cached.AccessToken, nil
	}

	endpoint, err := url.Parse(baseURL + "/cgi-bin/gettoken")
	if err != nil {
		return "", err
	}
	query := endpoint.Query()
	query.Set("corpid", corpID)
	query.Set("corpsecret", corpSecret)
	endpoint.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return "", err
	}
	resp, err := p.http.Do(req)
	if err != nil {
		return "", httperror.New(http.StatusBadGateway, "wecom_token_request_failed", err.Error())
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode >= 400 {
		return "", httperror.New(http.StatusBadGateway, "wecom_token_http_error", string(body))
	}
	var tokenResponse wecomTokenResponse
	if err := json.Unmarshal(body, &tokenResponse); err != nil {
		return "", err
	}
	if tokenResponse.ErrCode != 0 || tokenResponse.AccessToken == "" {
		return "", httperror.New(http.StatusBadGateway, "wecom_token_error", first(tokenResponse.ErrMsg, "WeCom gettoken failed"))
	}
	expiresIn := tokenResponse.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 7200
	}

	p.mutex.Lock()
	p.tokens[cacheKey] = wecomToken{
		AccessToken: tokenResponse.AccessToken,
		ExpiresAt:   time.Now().Add(time.Duration(expiresIn) * time.Second),
	}
	p.mutex.Unlock()
	return tokenResponse.AccessToken, nil
}

func (p *WeComProvider) sendTextCard(ctx context.Context, baseURL string, accessToken string, touser string, agentID string, input SendRequest) (map[string]any, error) {
	agentIDNumber, err := strconv.Atoi(agentID)
	if err != nil {
		return nil, httperror.New(http.StatusBadGateway, "invalid_wecom_agentid", "WeCom agentid must be a number")
	}
	endpoint := baseURL + "/cgi-bin/message/send?access_token=" + url.QueryEscape(accessToken)
	body, _ := json.Marshal(map[string]any{
		"touser":  touser,
		"msgtype": "textcard",
		"agentid": agentIDNumber,
		"textcard": map[string]string{
			"title":       input.Title,
			"description": input.Description,
			"url":         input.URL,
			"btntxt":      first(input.ButtonText, "查看详情"),
		},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.http.Do(req)
	if err != nil {
		return nil, httperror.New(http.StatusBadGateway, "wecom_send_request_failed", err.Error())
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, httperror.New(http.StatusBadGateway, "wecom_send_http_error", string(responseBody))
	}
	var decoded map[string]any
	if err := json.Unmarshal(responseBody, &decoded); err != nil {
		return nil, err
	}
	if errCode := number(decoded["errcode"]); errCode != 0 {
		return nil, httperror.New(http.StatusBadGateway, "wecom_send_error", first(fmt.Sprint(decoded["errmsg"]), "WeCom send failed"))
	}
	return decoded, nil
}

func (p *WeComProvider) evictToken(integrationCode string, versionNo int) {
	cacheKey := fmt.Sprintf("%s|%d", integrationCode, versionNo)
	p.mutex.Lock()
	delete(p.tokens, cacheKey)
	p.mutex.Unlock()
}

func normalizeToUser(value any) string {
	switch item := value.(type) {
	case string:
		return strings.TrimSpace(item)
	case []string:
		return strings.Join(item, "|")
	case []any:
		users := make([]string, 0, len(item))
		for _, entry := range item {
			if text := strings.TrimSpace(fmt.Sprint(entry)); text != "" {
				users = append(users, text)
			}
		}
		return strings.Join(users, "|")
	default:
		return strings.TrimSpace(fmt.Sprint(value))
	}
}

func stringFromMap(values map[string]any, key string) string {
	if values == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(values[key]))
}

func first(values ...string) string {
	for _, value := range values {
		normalized := strings.TrimSpace(value)
		if normalized != "" && normalized != "<nil>" {
			return normalized
		}
	}
	return ""
}

func number(value any) int {
	switch item := value.(type) {
	case float64:
		return int(item)
	case int:
		return item
	case json.Number:
		parsed, _ := strconv.Atoi(string(item))
		return parsed
	case string:
		parsed, _ := strconv.Atoi(item)
		return parsed
	default:
		return 0
	}
}
