package console

// Write-once object uploads for trusted Runtime consumers (Collab snapshot
// candidates). Not an HTTP route: callers bind the key namespace to their own
// tenant/deployment/candidate before calling in. The OSS credential never
// leaves the Runtime.

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/md5"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// PutOSSObjectWriteOnce refuses an existing key, uploads with
// x-oss-forbid-overwrite and returns the provider version. A missing version
// ID fails: snapshot references are exact versions, never "latest".
//
// On a versioned bucket OSS ignores x-oss-forbid-overwrite. HEAD rejects
// already present keys, and callers must use fresh random keys to minimize
// collisions; a concurrent write to the same key can still pass both HEADs.
func (a *Adapter) PutOSSObjectWriteOnce(ctx context.Context, integrationCode, objectKey, contentType string, content []byte, meta VaultAccessMeta) (OSSObjectVersion, error) {
	if !validOSSObjectKey(objectKey) || contentType == "" || strings.ContainsAny(contentType, "\r\n") {
		return OSSObjectVersion{}, httperror.New(http.StatusBadRequest, "console_oss_object_invalid", "Object reference is invalid")
	}
	credential, err := a.resolveOSSAvatarCredential(ctx, integrationCode, meta)
	if err != nil {
		return OSSObjectVersion{}, err
	}
	return credential.putWriteOnce(ctx, objectKey, contentType, content)
}

func (credential ossAvatarCredential) putWriteOnce(ctx context.Context, objectKey, contentType string, content []byte) (OSSObjectVersion, error) {
	head, err := credential.request(ctx, http.MethodHead, objectKey, "", nil)
	if err != nil {
		return OSSObjectVersion{}, err
	}
	response, err := integrationHTTPClient.Do(head)
	if err != nil {
		return OSSObjectVersion{}, httperror.New(http.StatusBadGateway, "console_oss_object_unavailable", "Object storage is unavailable")
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 32*1024))
	_ = response.Body.Close()
	switch {
	case response.StatusCode == http.StatusNotFound:
	case response.StatusCode/100 == 2:
		return OSSObjectVersion{}, httperror.New(http.StatusConflict, "console_oss_object_exists", "Object already exists")
	default:
		return OSSObjectVersion{}, httperror.New(http.StatusBadGateway, "console_oss_object_unavailable", "Object storage rejected the request")
	}
	request, err := credential.writeOnceRequest(ctx, objectKey, contentType, content)
	if err != nil {
		return OSSObjectVersion{}, err
	}
	response, err = integrationHTTPClient.Do(request)
	if err != nil {
		return OSSObjectVersion{}, httperror.New(http.StatusBadGateway, "console_oss_object_unavailable", "Object storage is unavailable")
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 32*1024))
	if response.StatusCode == http.StatusConflict {
		return OSSObjectVersion{}, httperror.New(http.StatusConflict, "console_oss_object_exists", "Object already exists")
	}
	if response.StatusCode/100 != 2 {
		return OSSObjectVersion{}, httperror.New(http.StatusBadGateway, "console_oss_object_unavailable", "Object storage rejected the upload")
	}
	version := strings.TrimSpace(response.Header.Get("x-oss-version-id"))
	if !validOSSVersionID(version) {
		return OSSObjectVersion{}, httperror.New(http.StatusBadGateway, "console_oss_object_version_missing", "Object storage returned no version")
	}
	return OSSObjectVersion{Key: objectKey, Version: version, Size: int64(len(content))}, nil
}

// writeOnceRequest signs a PUT whose canonical string carries the
// x-oss-forbid-overwrite header (OSS V1 CanonicalizedOSSHeaders).
func (credential ossAvatarCredential) writeOnceRequest(ctx context.Context, objectKey, contentType string, content []byte) (*http.Request, error) {
	target := *credential.Endpoint
	escaped := make([]string, 0)
	for _, segment := range strings.Split(objectKey, "/") {
		escaped = append(escaped, url.PathEscape(segment))
	}
	target.RawPath = "/" + strings.Join(escaped, "/")
	target.Path = "/" + objectKey
	digest := md5.Sum(content)
	contentMD5 := base64.StdEncoding.EncodeToString(digest[:])
	date := time.Now().UTC().Format(http.TimeFormat)
	canonical := fmt.Sprintf("PUT\n%s\n%s\n%s\nx-oss-forbid-overwrite:true\n/%s/%s", contentMD5, contentType, date, credential.Bucket, objectKey)
	mac := hmac.New(sha1.New, []byte(credential.AccessKeySecret))
	_, _ = mac.Write([]byte(canonical))
	request, err := http.NewRequestWithContext(ctx, http.MethodPut, target.String(), bytes.NewReader(content))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Date", date)
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Content-MD5", contentMD5)
	request.Header.Set("x-oss-forbid-overwrite", "true")
	request.Header.Set("Authorization", "OSS "+credential.AccessKeyID+":"+base64.StdEncoding.EncodeToString(mac.Sum(nil)))
	return request, nil
}
