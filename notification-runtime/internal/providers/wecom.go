package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
	console weComConfigClient
	http    *http.Client
	mutex   sync.Mutex
	tokens  map[string]wecomToken
}

type weComConfigClient interface {
	Integration(context.Context, string) (consoleclient.Integration, error)
	ResolveSecret(context.Context, string) (consoleclient.Secret, error)
}

type SendRequest struct {
	Channel         string `json:"channel"`
	IntegrationCode string `json:"integrationCode"`
	SourceAppCode   string `json:"sourceAppCode"`
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
	Replayed        bool           `json:"replayed"`
}

type IdentityExchangeRequest struct {
	IntegrationCode   string `json:"integrationCode"`
	AuthorizationCode string `json:"authorizationCode"`
}

type IdentityExchangeResult struct {
	Provider        string `json:"provider"`
	IntegrationCode string `json:"integrationCode"`
	Subject         struct {
		ID   string `json:"id"`
		Kind string `json:"kind"`
	} `json:"subject"`
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

type wecomIdentityResponse struct {
	ErrCode int    `json:"errcode"`
	ErrMsg  string `json:"errmsg"`
	UserID  string `json:"userid"`
	OpenID  string `json:"openid"`
}

func NewWeComProvider(console *consoleclient.Client) *WeComProvider {
	return newWeComProvider(console, &http.Client{Timeout: 10 * time.Second})
}

func newWeComProvider(console weComConfigClient, client *http.Client) *WeComProvider {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &WeComProvider{
		console: console,
		http:    client,
		tokens:  make(map[string]wecomToken),
	}
}

func (p *WeComProvider) ExchangeIdentity(ctx context.Context, input IdentityExchangeRequest) (IdentityExchangeResult, error) {
	integrationCode := first(input.IntegrationCode, "wecom.default")
	authorizationCode := strings.TrimSpace(input.AuthorizationCode)
	if len(authorizationCode) < 1 || len(authorizationCode) > 512 {
		return IdentityExchangeResult{}, httperror.New(http.StatusBadRequest, "invalid_authorization_code", "WeCom authorization code is invalid")
	}

	integration, err := p.console.Integration(ctx, integrationCode)
	if err != nil {
		return IdentityExchangeResult{}, err
	}
	if integration.CurrentCredential == nil {
		return IdentityExchangeResult{}, httperror.New(http.StatusBadGateway, "wecom_secret_unconfigured", "WeCom integration credential is not configured")
	}
	secret, err := p.console.ResolveSecret(ctx, integrationCode)
	if err != nil {
		return IdentityExchangeResult{}, err
	}
	baseURL, err := ValidateWeComBaseURL(first(integration.BaseURL, stringFromMap(integration.Config, "baseUrl"), DefaultWeComBaseURL))
	if err != nil {
		return IdentityExchangeResult{}, err
	}
	corpID := first(
		stringFromMap(integration.Config, "corpid"),
		stringFromMap(integration.Config, "corpId"),
		stringFromMap(integration.Config, "corp_id"),
	)
	if corpID == "" || secret.Value == "" {
		return IdentityExchangeResult{}, httperror.New(http.StatusBadGateway, "wecom_config_incomplete", "WeCom corpid or corpsecret is missing")
	}
	accessToken, err := p.accessToken(ctx, baseURL, integrationCode, corpID, secret.Value, secret.VersionNo)
	if err != nil {
		return IdentityExchangeResult{}, err
	}

	endpoint, _ := url.Parse(baseURL + "/cgi-bin/auth/getuserinfo")
	query := endpoint.Query()
	query.Set("access_token", accessToken)
	query.Set("code", authorizationCode)
	endpoint.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return IdentityExchangeResult{}, httperror.New(http.StatusBadGateway, "wecom_identity_request_invalid", "WeCom identity request could not be created")
	}
	resp, err := p.http.Do(req)
	if err != nil {
		return IdentityExchangeResult{}, httperror.New(http.StatusBadGateway, "wecom_identity_request_failed", "WeCom identity request failed")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil || resp.StatusCode >= 400 {
		return IdentityExchangeResult{}, httperror.New(http.StatusBadGateway, "wecom_identity_response_invalid", "WeCom identity response was invalid")
	}
	var decoded wecomIdentityResponse
	if json.Unmarshal(body, &decoded) != nil {
		return IdentityExchangeResult{}, httperror.New(http.StatusBadGateway, "wecom_identity_response_invalid", "WeCom identity response was invalid")
	}
	if decoded.ErrCode != 0 {
		p.evictToken(integrationCode, secret.VersionNo)
		return IdentityExchangeResult{}, httperror.New(http.StatusBadGateway, "wecom_identity_exchange_rejected", "WeCom rejected the authorization code")
	}
	userID := strings.TrimSpace(decoded.UserID)
	if userID == "" {
		return IdentityExchangeResult{}, httperror.New(http.StatusForbidden, "wecom_member_required", "WeCom login requires an enterprise member")
	}
	if len(userID) > 255 || strings.ContainsAny(userID, "\r\n\x00") {
		return IdentityExchangeResult{}, httperror.New(http.StatusBadGateway, "wecom_identity_response_invalid", "WeCom identity response was invalid")
	}
	result := IdentityExchangeResult{Provider: "wecom", IntegrationCode: integrationCode}
	result.Subject.ID = userID
	result.Subject.Kind = "member"
	return result, nil
}

func (p *WeComProvider) Send(ctx context.Context, input SendRequest) (SendResult, error) {
	normalized, err := NormalizeSendRequest(input)
	if err != nil {
		return SendResult{}, err
	}
	if normalized.Channel != "wecom" {
		return SendResult{}, httperror.New(http.StatusBadRequest, "unsupported_channel", "WeCom provider requires channel=wecom")
	}
	input = normalized
	integrationCode := input.IntegrationCode
	touser := normalizeToUser(input.ToUser)

	integration, err := p.console.Integration(ctx, integrationCode)
	if err != nil {
		return SendResult{}, err
	}
	if integration.CurrentCredential == nil {
		return SendResult{}, httperror.New(http.StatusBadGateway, "wecom_secret_unconfigured", "WeCom integration credential is not configured")
	}
	secret, err := p.console.ResolveSecret(ctx, integrationCode)
	if err != nil {
		return SendResult{}, err
	}

	baseURL, err := ValidateWeComBaseURL(first(integration.BaseURL, stringFromMap(integration.Config, "baseUrl"), DefaultWeComBaseURL))
	if err != nil {
		return SendResult{}, err
	}
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

// ValidateWeComBaseURL keeps the provider transport on the compiled WeCom API
// origin. Integration configuration may select credentials, but can never turn
// the runtime into an arbitrary HTTP relay.
func ValidateWeComBaseURL(value string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() != "qyapi.weixin.qq.com" || (parsed.Port() != "" && parsed.Port() != "443") || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.EscapedPath() != "" && parsed.EscapedPath() != "/") {
		return "", httperror.New(http.StatusBadGateway, "wecom_endpoint_not_allowed", "WeCom integration endpoint is not allowed")
	}
	return DefaultWeComBaseURL, nil
}

func NormalizeSendRequest(input SendRequest) (SendRequest, error) {
	input.Channel = strings.ToLower(strings.TrimSpace(input.Channel))
	if input.Channel == "" {
		input.Channel = "wecom"
	}
	if input.Channel != "wecom" && input.Channel != "dingtalk" {
		return SendRequest{}, httperror.New(http.StatusBadRequest, "unsupported_channel", "channel must be wecom or dingtalk")
	}
	defaultIntegration := "wecom.default"
	if input.Channel == "dingtalk" {
		defaultIntegration = "dingtalk.default"
	}
	input.IntegrationCode = first(input.IntegrationCode, defaultIntegration)
	input.ToUser = normalizeToUser(input.ToUser)
	input.Title = strings.TrimSpace(input.Title)
	input.Description = strings.TrimSpace(input.Description)
	input.URL = strings.TrimSpace(input.URL)
	input.ButtonText = first(input.ButtonText, "查看详情")
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.ToUser == "" {
		return SendRequest{}, httperror.New(http.StatusBadRequest, "invalid_touser", "touser is required")
	}
	if input.Title == "" || input.Description == "" || input.URL == "" {
		return SendRequest{}, httperror.New(http.StatusBadRequest, "invalid_message", "title, description and url are required")
	}
	if input.IdempotencyKey == "" || len(input.IdempotencyKey) > 191 {
		return SendRequest{}, httperror.New(http.StatusBadRequest, "invalid_idempotency_key", "idempotencyKey is required and must not exceed 191 characters")
	}
	return input, nil
}

func IsDeliveryOutcomeUnknown(err error) bool {
	var httpError *httperror.Error
	if errors.As(err, &httpError) {
		return httpError.Code == "wecom_send_request_failed" || httpError.Code == "wecom_send_response_invalid"
	}
	return errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled)
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
		return "", httperror.New(http.StatusBadGateway, "wecom_token_request_invalid", "WeCom token request could not be created")
	}
	resp, err := p.http.Do(req)
	if err != nil {
		return "", httperror.New(http.StatusBadGateway, "wecom_token_request_failed", "WeCom token request failed")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", httperror.New(http.StatusBadGateway, "wecom_token_response_invalid", "WeCom token response was invalid")
	}
	if resp.StatusCode >= 400 {
		return "", httperror.New(http.StatusBadGateway, "wecom_token_http_error", "WeCom token endpoint returned an error")
	}
	var tokenResponse wecomTokenResponse
	if err := json.Unmarshal(body, &tokenResponse); err != nil {
		return "", err
	}
	if tokenResponse.ErrCode != 0 || tokenResponse.AccessToken == "" {
		return "", httperror.New(http.StatusBadGateway, "wecom_token_error", "WeCom token request was rejected")
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
		return nil, httperror.New(http.StatusBadGateway, "wecom_send_request_invalid", "WeCom send request could not be created")
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.http.Do(req)
	if err != nil {
		return nil, httperror.New(http.StatusBadGateway, "wecom_send_request_failed", "WeCom send request failed")
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, httperror.New(http.StatusBadGateway, "wecom_send_response_invalid", "WeCom send response was invalid")
	}
	if resp.StatusCode >= 400 {
		return nil, httperror.New(http.StatusBadGateway, "wecom_send_http_error", "WeCom send endpoint returned an error")
	}
	var decoded map[string]any
	if err := json.Unmarshal(responseBody, &decoded); err != nil {
		return nil, httperror.New(http.StatusBadGateway, "wecom_send_response_invalid", "WeCom send response was invalid")
	}
	if errCode := number(decoded["errcode"]); errCode != 0 {
		return nil, httperror.New(http.StatusBadGateway, "wecom_send_error", "WeCom rejected notification request")
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
