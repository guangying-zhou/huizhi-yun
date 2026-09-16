package console

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var wecomIdentityPattern = regexp.MustCompile(`^[A-Za-z0-9_.@-]{1,191}$`)

type wecomOperationRuntime struct {
	IntegrationCode string
	CorpID          string
	AgentID         string
	CorpSecret      string
}

func (a *Adapter) ExecuteServiceWeComOperation(
	ctx context.Context,
	integrationCode string,
	operation string,
	body map[string]any,
	actorID string,
	appCode string,
	requestIP string,
	userAgent string,
) (any, error) {
	runtime, err := a.resolveServiceWeComRuntime(
		ctx, integrationCode, "wecom."+operation,
		actorID, appCode, requestIP, userAgent,
	)
	if err != nil {
		return nil, err
	}
	token, err := runtime.accessToken(ctx)
	if err != nil {
		return nil, err
	}
	switch operation {
	case "oauth-user":
		code := strings.TrimSpace(integrationText(body["code"]))
		if code == "" || len(code) > 1024 || strings.ContainsAny(code, "\r\n") {
			return nil, httperror.New(
				http.StatusBadRequest,
				"console_wecom_oauth_code_invalid",
				"WeCom OAuth code is invalid",
			)
		}
		var response struct {
			ErrCode int    `json:"errcode"`
			UserID  string `json:"userid"`
		}
		if err := wecomRequestJSON(ctx, "/cgi-bin/auth/getuserinfo", url.Values{
			"access_token": {token},
			"code":         {code},
		}, &response); err != nil {
			return nil, err
		}
		if response.ErrCode != 0 || !wecomIdentityPattern.MatchString(response.UserID) {
			return nil, httperror.New(
				http.StatusBadGateway,
				"console_wecom_oauth_user_invalid",
				"WeCom did not return a valid user identity",
			)
		}
		return map[string]any{"userid": response.UserID}, nil
	case "user-detail":
		userID := strings.TrimSpace(integrationText(body["userid"]))
		if !wecomIdentityPattern.MatchString(userID) {
			return nil, httperror.New(
				http.StatusBadRequest,
				"console_wecom_userid_invalid",
				"WeCom userid is invalid",
			)
		}
		var response struct {
			ErrCode int    `json:"errcode"`
			UserID  string `json:"userid"`
			Name    string `json:"name"`
			Email   string `json:"email"`
			BizMail string `json:"biz_mail"`
			Mobile  string `json:"mobile"`
			Avatar  string `json:"avatar"`
		}
		if err := wecomRequestJSON(ctx, "/cgi-bin/user/get", url.Values{
			"access_token": {token},
			"userid":       {userID},
		}, &response); err != nil {
			return nil, err
		}
		if response.ErrCode != 0 {
			return nil, httperror.New(
				http.StatusBadGateway,
				"console_wecom_user_lookup_failed",
				"WeCom rejected the user lookup",
			)
		}
		if response.UserID == "" {
			response.UserID = userID
		}
		return map[string]any{
			"userid": response.UserID, "name": response.Name,
			"email": response.Email, "bizMail": response.BizMail,
			"mobile": response.Mobile, "avatar": response.Avatar,
		}, nil
	default:
		return nil, httperror.New(
			http.StatusNotFound,
			"console_wecom_operation_not_found",
			"WeCom operation was not found",
		)
	}
}

func (a *Adapter) resolveServiceWeComRuntime(
	ctx context.Context,
	integrationCode string,
	operation string,
	actorID string,
	appCode string,
	requestIP string,
	userAgent string,
) (wecomOperationRuntime, error) {
	code, err := a.requireAuthorizedIntegrationOperation(
		ctx, integrationCode, operation, actorID, appCode,
	)
	if err != nil {
		return wecomOperationRuntime{}, err
	}
	row, err := scanIntegrationProjection(a.db.QueryRowContext(
		ctx,
		integrationProjectionSelect+" WHERE i.integration_code=? LIMIT 1",
		code,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return wecomOperationRuntime{}, httperror.New(
			http.StatusNotFound,
			"console_integration_not_found",
			"Integration was not found",
		)
	}
	if err != nil {
		return wecomOperationRuntime{}, err
	}
	if row.Status != "active" || row.IntegrationType != "wecom" ||
		!row.SecretCode.Valid || !row.SecretVersionNo.Valid {
		return wecomOperationRuntime{}, httperror.New(
			http.StatusServiceUnavailable,
			"console_wecom_integration_unavailable",
			"WeCom integration is unavailable",
		)
	}
	config := map[string]any{}
	if len(row.ConfigJSON) > 0 {
		_ = json.Unmarshal(row.ConfigJSON, &config)
	}
	corpID := integrationConfigText(config, "corpid", "corpId")
	agentID := integrationConfigText(config, "agentid", "agentId")
	if corpID == "" || agentID == "" {
		return wecomOperationRuntime{}, httperror.New(
			http.StatusServiceUnavailable,
			"console_wecom_integration_incomplete",
			"WeCom integration is incomplete",
		)
	}
	secret, err := queryVaultSecret(ctx, a.db, row.SecretCode.String, row.SecretVersionNo.Int64, false)
	if err != nil {
		return wecomOperationRuntime{}, err
	}
	meta := VaultAccessMeta{
		ActorType: "service",
		ActorID:   actorID,
		AppCode:   appCode,
		RequestIP: requestIP,
		UserAgent: userAgent,
		Reason:    "wecom_fixed_operation:" + code,
	}
	if secret.UsageType != "integration" || secret.OwnerType != "integration" ||
		!secret.OwnerKey.Valid || secret.OwnerKey.String != code {
		_ = insertVaultAccessLog(
			ctx, a.db, int64(secret.ID), secret.VersionID.Int64, "resolve", meta, "denied",
		)
		return wecomOperationRuntime{}, httperror.New(
			http.StatusForbidden,
			"console_wecom_credential_binding_invalid",
			"WeCom credential binding is invalid",
		)
	}
	corpSecret, resolveErr := a.resolveVaultMaterial(
		secret.StorageBackend,
		secret.CiphertextBlob,
		secret.BackendSecretRef.String,
		secret.ContentHash.String,
	)
	status := "success"
	if resolveErr != nil {
		status = "failed"
	}
	logErr := insertVaultAccessLog(
		ctx, a.db, int64(secret.ID), secret.VersionID.Int64, "resolve", meta, status,
	)
	if resolveErr != nil {
		return wecomOperationRuntime{}, httperror.New(
			http.StatusServiceUnavailable,
			"console_wecom_credential_unavailable",
			"WeCom credential is unavailable",
		)
	}
	if logErr != nil {
		return wecomOperationRuntime{}, logErr
	}
	return wecomOperationRuntime{
		IntegrationCode: code,
		CorpID:          corpID,
		AgentID:         agentID,
		CorpSecret:      corpSecret,
	}, nil
}

func (runtime wecomOperationRuntime) accessToken(ctx context.Context) (string, error) {
	var response struct {
		ErrCode     int    `json:"errcode"`
		AccessToken string `json:"access_token"`
	}
	if err := wecomRequestJSON(ctx, "/cgi-bin/gettoken", url.Values{
		"corpid":     {runtime.CorpID},
		"corpsecret": {runtime.CorpSecret},
	}, &response); err != nil {
		return "", err
	}
	if response.ErrCode != 0 || response.AccessToken == "" {
		return "", httperror.New(
			http.StatusBadGateway,
			"console_wecom_token_failed",
			"WeCom rejected the configured credential",
		)
	}
	return response.AccessToken, nil
}

func wecomRequestJSON(
	ctx context.Context,
	requestPath string,
	query url.Values,
	target any,
) error {
	if !strings.HasPrefix(requestPath, "/cgi-bin/") {
		return httperror.New(
			http.StatusBadRequest,
			"console_wecom_operation_invalid",
			"WeCom operation is invalid",
		)
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		"https://qyapi.weixin.qq.com"+requestPath+"?"+query.Encode(),
		nil,
	)
	if err != nil {
		return err
	}
	response, err := integrationHTTPClient.Do(request)
	if err != nil {
		return httperror.New(
			http.StatusBadGateway,
			"console_wecom_unavailable",
			"WeCom is unavailable",
		)
	}
	defer response.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(response.Body, 1024*1024+1))
	if readErr != nil || len(body) > 1024*1024 || response.StatusCode/100 != 2 ||
		json.Unmarshal(body, target) != nil {
		return httperror.New(
			http.StatusBadGateway,
			"console_wecom_response_invalid",
			"WeCom response is invalid",
		)
	}
	return nil
}
