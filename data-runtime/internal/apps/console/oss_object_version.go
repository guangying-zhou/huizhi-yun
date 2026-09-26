package console

// Exact provider-version reads and bucket retention facts for trusted Runtime
// consumers (the Codocs snapshot verifier). Not an HTTP route: callers bind
// the integration to their own tenant/deployment before calling in.

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const maxOSSObjectVersionBytes = 128 * 1024 * 1024

type OSSObjectVersion struct {
	Body         io.ReadCloser
	Key, Version string
	Size         int64
}

// OSSLifecycleRule keeps only the fields that decide whether a version can
// disappear; IDs and tags are intentionally dropped.
type OSSLifecycleRule struct {
	Prefix         string
	Enabled        bool
	ExpirationDays int
	ExpirationDate bool
	NoncurrentDays int
}

type OSSBucketRetention struct {
	Versioning string
	Rules      []OSSLifecycleRule
}

// RetainsVersionsUnder fails closed unless versioning is enabled and no
// enabled lifecycle rule overlapping the prefix can expire a referenced
// version. Keys that are overwritten in place (v1 history) keep old data only
// as noncurrent versions, so any noncurrent expiry breaks them. Write-once keys
// (v2 snapshots) stay current while referenced, so only current-object expiry
// matters; their writers must then never overwrite or delete a referenced key.
func (r OSSBucketRetention) RetainsVersionsUnder(prefix string, writeOnce bool) error {
	if r.Versioning != "Enabled" {
		return fmt.Errorf("bucket versioning is %s", r.Versioning)
	}
	for _, rule := range r.Rules {
		if !rule.Enabled || !(strings.HasPrefix(prefix, rule.Prefix) || strings.HasPrefix(rule.Prefix, prefix)) {
			continue
		}
		if rule.ExpirationDays > 0 || rule.ExpirationDate {
			return fmt.Errorf("lifecycle rule for prefix %q expires current objects", rule.Prefix)
		}
		if rule.NoncurrentDays > 0 && !writeOnce {
			return fmt.Errorf("lifecycle rule for prefix %q expires noncurrent versions after %d days", rule.Prefix, rule.NoncurrentDays)
		}
	}
	return nil
}

func (a *Adapter) OpenOSSObjectVersion(
	ctx context.Context,
	integrationCode string,
	objectKey string,
	version string,
	meta VaultAccessMeta,
) (OSSObjectVersion, error) {
	if !validOSSObjectKey(objectKey) || !validOSSVersionID(version) {
		return OSSObjectVersion{}, httperror.New(http.StatusBadRequest, "console_oss_object_version_invalid", "Object version reference is invalid")
	}
	credential, err := a.resolveOSSAvatarCredential(ctx, integrationCode, meta)
	if err != nil {
		return OSSObjectVersion{}, err
	}
	return credential.openVersion(ctx, objectKey, version)
}

func (credential ossAvatarCredential) openVersion(ctx context.Context, objectKey, version string) (OSSObjectVersion, error) {
	request, err := credential.subresourceRequest(ctx, objectKey, "versionId", version)
	if err != nil {
		return OSSObjectVersion{}, err
	}
	response, err := integrationHTTPClient.Do(request)
	if err != nil {
		return OSSObjectVersion{}, httperror.New(http.StatusBadGateway, "console_oss_object_version_unavailable", "Object storage is unavailable")
	}
	fail := func(status int, code, message string) (OSSObjectVersion, error) {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 32*1024))
		_ = response.Body.Close()
		return OSSObjectVersion{}, httperror.New(status, code, message)
	}
	if response.StatusCode == http.StatusNotFound {
		return fail(http.StatusNotFound, "console_oss_object_version_not_found", "Object version was not found")
	}
	if response.StatusCode/100 != 2 {
		return fail(http.StatusBadGateway, "console_oss_object_version_unavailable", "Object storage rejected the request")
	}
	if strings.TrimSpace(response.Header.Get("x-oss-version-id")) != version {
		return fail(http.StatusBadGateway, "console_oss_object_version_mismatch", "Object storage returned a different version")
	}
	if response.ContentLength > maxOSSObjectVersionBytes {
		return fail(http.StatusRequestEntityTooLarge, "console_oss_object_version_too_large", "Object version exceeds the size limit")
	}
	return OSSObjectVersion{
		Body:    limitedReadCloser{Reader: io.LimitReader(response.Body, maxOSSObjectVersionBytes+1), Closer: response.Body},
		Key:     objectKey,
		Version: version,
		Size:    response.ContentLength,
	}, nil
}

func (a *Adapter) GetOSSBucketRetention(ctx context.Context, integrationCode string, meta VaultAccessMeta) (OSSBucketRetention, error) {
	credential, err := a.resolveOSSAvatarCredential(ctx, integrationCode, meta)
	if err != nil {
		return OSSBucketRetention{}, err
	}
	return credential.retention(ctx)
}

func (credential ossAvatarCredential) retention(ctx context.Context) (OSSBucketRetention, error) {
	var versioning struct {
		Status string `xml:"Status"`
	}
	if found, err := credential.bucketConfig(ctx, "versioning", &versioning); err != nil {
		return OSSBucketRetention{}, err
	} else if !found {
		return OSSBucketRetention{}, httperror.New(http.StatusBadGateway, "console_oss_bucket_config_unavailable", "Bucket versioning is unavailable")
	}
	retention := OSSBucketRetention{Versioning: strings.TrimSpace(versioning.Status)}
	if retention.Versioning == "" {
		retention.Versioning = "Disabled"
	}
	var lifecycle struct {
		Rules []struct {
			Prefix       string `xml:"Prefix"`
			FilterPrefix string `xml:"Filter>Prefix"`
			Status       string `xml:"Status"`
			Expiration   *struct {
				Days int    `xml:"Days"`
				Date string `xml:"Date"`
			} `xml:"Expiration"`
			Noncurrent *struct {
				Days int `xml:"NoncurrentDays"`
			} `xml:"NoncurrentVersionExpiration"`
		} `xml:"Rule"`
	}
	found, err := credential.bucketConfig(ctx, "lifecycle", &lifecycle)
	if err != nil {
		return OSSBucketRetention{}, err
	}
	if !found {
		return retention, nil
	}
	for _, raw := range lifecycle.Rules {
		rule := OSSLifecycleRule{Prefix: raw.Prefix + raw.FilterPrefix, Enabled: strings.EqualFold(strings.TrimSpace(raw.Status), "Enabled")}
		if raw.Expiration != nil {
			rule.ExpirationDays = raw.Expiration.Days
			rule.ExpirationDate = strings.TrimSpace(raw.Expiration.Date) != ""
		}
		if raw.Noncurrent != nil {
			rule.NoncurrentDays = raw.Noncurrent.Days
		}
		retention.Rules = append(retention.Rules, rule)
	}
	return retention, nil
}

// bucketConfig reports found=false only for the provider's "not configured"
// 404 (e.g. NoSuchLifecycle); any other failure is an error.
func (credential ossAvatarCredential) bucketConfig(ctx context.Context, subresource string, target any) (bool, error) {
	request, err := credential.subresourceRequest(ctx, "", subresource, "")
	if err != nil {
		return false, err
	}
	response, err := integrationHTTPClient.Do(request)
	if err != nil {
		return false, httperror.New(http.StatusBadGateway, "console_oss_bucket_config_unavailable", "Object storage is unavailable")
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 256*1024))
	if err != nil {
		return false, httperror.New(http.StatusBadGateway, "console_oss_bucket_config_unavailable", "Bucket configuration could not be read")
	}
	if response.StatusCode == http.StatusNotFound && subresource == "lifecycle" && strings.Contains(string(body), "<Code>NoSuchLifecycle</Code>") {
		return false, nil
	}
	if response.StatusCode/100 != 2 {
		return false, httperror.New(http.StatusBadGateway, "console_oss_bucket_config_unavailable", "Object storage rejected the bucket configuration request")
	}
	if err := xml.Unmarshal(body, target); err != nil {
		return false, httperror.New(http.StatusBadGateway, "console_oss_bucket_config_unavailable", "Bucket configuration is malformed")
	}
	return true, nil
}

// subresourceRequest signs a GET with one OSS sub-resource in the canonical
// resource (unescaped there, escaped in the URL), e.g. /bucket/key?versionId=v
// or /bucket/?lifecycle.
func (credential ossAvatarCredential) subresourceRequest(ctx context.Context, objectKey, name, value string) (*http.Request, error) {
	target := *credential.Endpoint
	escaped := make([]string, 0)
	for _, segment := range strings.Split(objectKey, "/") {
		escaped = append(escaped, url.PathEscape(segment))
	}
	target.RawPath = "/" + strings.Join(escaped, "/")
	target.Path = "/" + objectKey
	resource := name
	target.RawQuery = name
	if value != "" {
		resource = name + "=" + value
		target.RawQuery = name + "=" + url.QueryEscape(value)
	}
	date := time.Now().UTC().Format(http.TimeFormat)
	canonical := fmt.Sprintf("GET\n\n\n%s\n/%s/%s?%s", date, credential.Bucket, objectKey, resource)
	mac := hmac.New(sha1.New, []byte(credential.AccessKeySecret))
	_, _ = mac.Write([]byte(canonical))
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Date", date)
	request.Header.Set("Authorization", "OSS "+credential.AccessKeyID+":"+base64.StdEncoding.EncodeToString(mac.Sum(nil)))
	return request, nil
}

type limitedReadCloser struct {
	io.Reader
	io.Closer
}

func validOSSObjectKey(key string) bool {
	if key == "" || len(key) > 1024 || strings.HasPrefix(key, "/") || strings.ContainsAny(key, "\\\x00\r\n") {
		return false
	}
	for _, segment := range strings.Split(key, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return false
		}
	}
	return true
}

func validOSSVersionID(version string) bool {
	if version == "" || version == "null" || len(version) > 256 {
		return false
	}
	for _, r := range version {
		if r <= ' ' || r > '~' || r == '"' {
			return false
		}
	}
	return true
}

// ReadOSSObjectLatest reads the current object and its user metadata, bounded.
// Operator verification only (derived copies of v2 snapshots); not a route.
func (a *Adapter) ReadOSSObjectLatest(ctx context.Context, integrationCode, objectKey string, meta VaultAccessMeta) ([]byte, map[string]string, error) {
	if !validOSSObjectKey(objectKey) {
		return nil, nil, httperror.New(http.StatusBadRequest, "console_oss_object_invalid", "Object key is invalid")
	}
	credential, err := a.resolveOSSAvatarCredential(ctx, integrationCode, meta)
	if err != nil {
		return nil, nil, err
	}
	request, err := credential.request(ctx, http.MethodGet, objectKey, "", nil)
	if err != nil {
		return nil, nil, err
	}
	response, err := integrationHTTPClient.Do(request)
	if err != nil {
		return nil, nil, httperror.New(http.StatusBadGateway, "console_oss_object_unavailable", "Object storage is unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return nil, nil, httperror.New(response.StatusCode, "console_oss_object_unavailable", "Object storage rejected the request")
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxOSSObjectVersionBytes))
	if err != nil {
		return nil, nil, err
	}
	userMeta := map[string]string{}
	for name, values := range response.Header {
		if lower := strings.ToLower(name); strings.HasPrefix(lower, "x-oss-meta-") && len(values) > 0 {
			userMeta[strings.TrimPrefix(lower, "x-oss-meta-")] = values[0]
		}
	}
	return body, userMeta, nil
}
