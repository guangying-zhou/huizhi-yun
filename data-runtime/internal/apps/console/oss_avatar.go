package console

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/md5"
	"crypto/sha1"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const maxOSSAvatarBytes = 3 * 1024 * 1024

var ossAvatarSegmentPattern = regexp.MustCompile(`^[A-Za-z0-9._~-]+$`)
var ossBucketPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)
var ossAvatarContentTypes = map[string]bool{
	"image/png": true, "image/jpeg": true, "image/webp": true,
}
var ossAvatarExtensions = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true,
	".webp": true, ".bmp": true, ".avif": true,
}

type ossAvatarCredential struct {
	Bucket          string
	Endpoint        *url.URL
	AccessKeyID     string
	AccessKeySecret string
	SecretID        int64
	VersionID       int64
}

func (a *Adapter) GetOSSAvatar(
	ctx context.Context,
	integrationCode string,
	objectPath string,
	meta VaultAccessMeta,
) (map[string]any, error) {
	objectKey, err := normalizeOSSAvatarObjectPath(objectPath)
	if err != nil {
		return nil, err
	}
	credential, err := a.resolveOSSAvatarCredential(ctx, integrationCode, meta)
	if err != nil {
		return nil, err
	}
	request, err := credential.request(ctx, http.MethodGet, objectKey, "", nil)
	if err != nil {
		return nil, err
	}
	response, err := integrationHTTPClient.Do(request)
	if err != nil {
		return nil, httperror.New(
			http.StatusBadGateway,
			"console_oss_avatar_fetch_failed",
			"Avatar object storage is unavailable",
		)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 32*1024))
		return nil, httperror.New(
			http.StatusNotFound,
			"console_oss_avatar_not_found",
			"Avatar was not found",
		)
	}
	if response.StatusCode/100 != 2 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 32*1024))
		return nil, httperror.New(
			http.StatusBadGateway,
			"console_oss_avatar_fetch_failed",
			"Avatar object storage rejected the request",
		)
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0]))
	if !strings.HasPrefix(contentType, "image/") {
		return nil, httperror.New(
			http.StatusUnsupportedMediaType,
			"console_oss_avatar_content_type_invalid",
			"Avatar object is not an image",
		)
	}
	content, err := io.ReadAll(io.LimitReader(response.Body, maxOSSAvatarBytes+1))
	if err != nil {
		return nil, httperror.New(
			http.StatusBadGateway,
			"console_oss_avatar_fetch_failed",
			"Avatar object could not be read",
		)
	}
	if len(content) > maxOSSAvatarBytes {
		return nil, httperror.New(
			http.StatusRequestEntityTooLarge,
			"console_oss_avatar_too_large",
			"Avatar object exceeds the size limit",
		)
	}
	return map[string]any{
		"contentBase64": base64.StdEncoding.EncodeToString(content),
		"contentType":   contentType,
		"etag":          strings.TrimSpace(response.Header.Get("ETag")),
	}, nil
}

func (a *Adapter) PutOSSAvatar(
	ctx context.Context,
	integrationCode string,
	body map[string]any,
	meta VaultAccessMeta,
) (map[string]any, error) {
	objectKey, err := normalizeOSSAvatarObjectPath(integrationText(body["objectPath"]))
	if err != nil {
		return nil, err
	}
	contentType := strings.ToLower(strings.TrimSpace(integrationText(body["contentType"])))
	if !ossAvatarContentTypes[contentType] {
		return nil, httperror.New(
			http.StatusUnsupportedMediaType,
			"console_oss_avatar_content_type_invalid",
			"Avatar content type is not supported",
		)
	}
	encoded := strings.TrimSpace(integrationText(body["contentBase64"]))
	if encoded == "" || len(encoded) > base64.StdEncoding.EncodedLen(maxOSSAvatarBytes) {
		return nil, httperror.New(
			http.StatusRequestEntityTooLarge,
			"console_oss_avatar_too_large",
			"Avatar object exceeds the size limit",
		)
	}
	content, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(content) == 0 {
		return nil, httperror.New(
			http.StatusBadRequest,
			"console_oss_avatar_content_invalid",
			"Avatar content is invalid",
		)
	}
	if len(content) > maxOSSAvatarBytes {
		return nil, httperror.New(
			http.StatusRequestEntityTooLarge,
			"console_oss_avatar_too_large",
			"Avatar object exceeds the size limit",
		)
	}
	credential, err := a.resolveOSSAvatarCredential(ctx, integrationCode, meta)
	if err != nil {
		return nil, err
	}
	request, err := credential.request(ctx, http.MethodPut, objectKey, contentType, content)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Cache-Control", "public, max-age=31536000, immutable")
	response, err := integrationHTTPClient.Do(request)
	if err != nil {
		return nil, httperror.New(
			http.StatusBadGateway,
			"console_oss_avatar_upload_failed",
			"Avatar object storage is unavailable",
		)
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 32*1024))
	if response.StatusCode/100 != 2 {
		return nil, httperror.New(
			http.StatusBadGateway,
			"console_oss_avatar_upload_failed",
			"Avatar object storage rejected the request",
		)
	}
	return map[string]any{
		"objectPath": objectKey,
		"etag":       strings.TrimSpace(response.Header.Get("ETag")),
	}, nil
}

func (a *Adapter) resolveOSSAvatarCredential(
	ctx context.Context,
	integrationCode string,
	meta VaultAccessMeta,
) (ossAvatarCredential, error) {
	code, err := normalizeIntegrationCode(integrationCode, "integrationCode")
	if err != nil {
		return ossAvatarCredential{}, err
	}
	row, err := scanIntegrationProjection(a.db.QueryRowContext(
		ctx,
		integrationProjectionSelect+" WHERE i.integration_code=? LIMIT 1",
		code,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return ossAvatarCredential{}, httperror.New(
			http.StatusServiceUnavailable,
			"console_oss_integration_unavailable",
			"OSS integration is unavailable",
		)
	}
	if err != nil {
		return ossAvatarCredential{}, err
	}
	if row.Status != "active" || row.IntegrationType != "oss" ||
		!row.SecretCode.Valid || !row.SecretVersionNo.Valid {
		return ossAvatarCredential{}, httperror.New(
			http.StatusServiceUnavailable,
			"console_oss_integration_unavailable",
			"OSS integration is unavailable",
		)
	}
	config := map[string]any{}
	if len(row.ConfigJSON) > 0 {
		_ = json.Unmarshal(row.ConfigJSON, &config)
	}
	accessKeyID := integrationConfigText(config, "accessKeyId")
	bucket := integrationConfigText(config, "bucketName", "bucket")
	endpoint, endpointErr := normalizeOSSEndpoint(
		firstIntegrationText(integrationConfigText(config, "endpoint"), row.BaseURL.String),
		bucket,
	)
	if accessKeyID == "" || endpointErr != nil {
		return ossAvatarCredential{}, httperror.New(
			http.StatusServiceUnavailable,
			"console_oss_integration_incomplete",
			"OSS integration is incomplete",
		)
	}
	secret, err := queryVaultSecret(ctx, a.db, row.SecretCode.String, row.SecretVersionNo.Int64, false)
	if err != nil {
		return ossAvatarCredential{}, err
	}
	if secret.UsageType != "integration" || secret.OwnerType != "integration" ||
		!secret.OwnerKey.Valid || secret.OwnerKey.String != code {
		_ = insertVaultAccessLog(
			ctx, a.db, int64(secret.ID), secret.VersionID.Int64, "resolve", meta, "denied",
		)
		return ossAvatarCredential{}, httperror.New(
			http.StatusForbidden,
			"console_oss_credential_binding_invalid",
			"OSS credential binding is invalid",
		)
	}
	value, resolveErr := a.resolveVaultMaterial(
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
		return ossAvatarCredential{}, httperror.New(
			http.StatusServiceUnavailable,
			"console_oss_credential_unavailable",
			"OSS credential is unavailable",
		)
	}
	if logErr != nil {
		return ossAvatarCredential{}, logErr
	}
	return ossAvatarCredential{
		Bucket:          bucket,
		Endpoint:        endpoint,
		AccessKeyID:     accessKeyID,
		AccessKeySecret: value,
		SecretID:        int64(secret.ID),
		VersionID:       secret.VersionID.Int64,
	}, nil
}

func normalizeOSSAvatarObjectPath(value string) (string, error) {
	objectKey := strings.TrimSpace(value)
	if len(objectKey) < len("avatars/x") || len(objectKey) > 256 ||
		!strings.HasPrefix(objectKey, "avatars/") ||
		strings.HasPrefix(objectKey, "/") || strings.Contains(objectKey, `\`) {
		return "", httperror.New(
			http.StatusBadRequest,
			"console_oss_avatar_path_invalid",
			"Avatar object path is invalid",
		)
	}
	segments := strings.Split(objectKey, "/")
	for _, segment := range segments {
		if segment == "" || segment == "." || segment == ".." ||
			!ossAvatarSegmentPattern.MatchString(segment) {
			return "", httperror.New(
				http.StatusBadRequest,
				"console_oss_avatar_path_invalid",
				"Avatar object path is invalid",
			)
		}
	}
	if !ossAvatarExtensions[strings.ToLower(path.Ext(objectKey))] {
		return "", httperror.New(
			http.StatusBadRequest,
			"console_oss_avatar_path_invalid",
			"Avatar object extension is invalid",
		)
	}
	return objectKey, nil
}

func normalizeOSSEndpoint(value string, bucket string) (*url.URL, error) {
	if !ossBucketPattern.MatchString(strings.TrimSpace(bucket)) {
		return nil, errors.New("invalid OSS bucket")
	}
	rawEndpoint := strings.TrimSpace(value)
	if !strings.Contains(rawEndpoint, "://") {
		rawEndpoint = "https://" + rawEndpoint
	}
	endpoint, err := url.Parse(rawEndpoint)
	if err != nil || endpoint.Scheme != "https" || endpoint.Hostname() == "" ||
		endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" ||
		(endpoint.Path != "" && endpoint.Path != "/") {
		return nil, errors.New("invalid OSS endpoint")
	}
	hostname := strings.ToLower(strings.TrimSuffix(endpoint.Hostname(), "."))
	if hostname != "aliyuncs.com" && !strings.HasSuffix(hostname, ".aliyuncs.com") &&
		hostname != "aliyuncs.com.cn" && !strings.HasSuffix(hostname, ".aliyuncs.com.cn") {
		return nil, errors.New("untrusted OSS endpoint")
	}
	endpoint.Host = bucket + "." + endpoint.Host
	endpoint.Path = ""
	return endpoint, nil
}

func (credential ossAvatarCredential) request(
	ctx context.Context,
	method string,
	objectKey string,
	contentType string,
	content []byte,
) (*http.Request, error) {
	target := *credential.Endpoint
	escapedSegments := make([]string, 0)
	for _, segment := range strings.Split(objectKey, "/") {
		escapedSegments = append(escapedSegments, url.PathEscape(segment))
	}
	target.RawPath = "/" + strings.Join(escapedSegments, "/")
	target.Path = "/" + objectKey
	date := time.Now().UTC().Format(http.TimeFormat)
	contentMD5 := ""
	var body io.Reader
	if method == http.MethodPut {
		digest := md5.Sum(content)
		contentMD5 = base64.StdEncoding.EncodeToString(digest[:])
		body = bytes.NewReader(content)
	}
	canonical := fmt.Sprintf(
		"%s\n%s\n%s\n%s\n/%s/%s",
		method,
		contentMD5,
		contentType,
		date,
		credential.Bucket,
		objectKey,
	)
	mac := hmac.New(sha1.New, []byte(credential.AccessKeySecret))
	_, _ = mac.Write([]byte(canonical))
	request, err := http.NewRequestWithContext(ctx, method, target.String(), body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Date", date)
	request.Header.Set(
		"Authorization",
		"OSS "+credential.AccessKeyID+":"+base64.StdEncoding.EncodeToString(mac.Sum(nil)),
	)
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	if contentMD5 != "" {
		request.Header.Set("Content-MD5", contentMD5)
	}
	return request, nil
}
