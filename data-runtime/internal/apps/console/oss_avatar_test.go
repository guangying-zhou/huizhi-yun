package console

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestNormalizeOSSAvatarObjectPath(t *testing.T) {
	valid := "avatars/C000001/zhou_guangying/0123456789abcdef0123456789abcdef.png"
	normalized, err := normalizeOSSAvatarObjectPath(valid)
	if err != nil || normalized != valid {
		t.Fatalf("valid path result=%q error=%v", normalized, err)
	}
	for _, value := range []string{
		"documents/private.md",
		"avatars/../private.png",
		"/avatars/user.png",
		"avatars/user.svg",
		"avatars/user name.png",
	} {
		if _, err := normalizeOSSAvatarObjectPath(value); err == nil {
			t.Fatalf("expected invalid avatar object path %q", value)
		}
	}
}

func TestNormalizeOSSEndpointAllowsOnlyAliyunOSS(t *testing.T) {
	endpoint, err := normalizeOSSEndpoint("https://oss-cn-hangzhou.aliyuncs.com", "tenant-avatar")
	if err != nil {
		t.Fatal(err)
	}
	if endpoint.Host != "tenant-avatar.oss-cn-hangzhou.aliyuncs.com" {
		t.Fatalf("unexpected virtual-host endpoint %q", endpoint.Host)
	}
	for _, value := range []string{
		"http://oss-cn-hangzhou.aliyuncs.com",
		"https://127.0.0.1",
		"https://oss.example.com",
		"https://oss-cn-hangzhou.aliyuncs.com/private",
	} {
		if _, err := normalizeOSSEndpoint(value, "tenant-avatar"); err == nil {
			t.Fatalf("expected unsafe endpoint %q to be rejected", value)
		}
	}
}

func TestOSSAvatarRequestUsesFixedObjectAndSignedHeader(t *testing.T) {
	endpoint, err := normalizeOSSEndpoint("https://oss-cn-hangzhou.aliyuncs.com", "tenant-avatar")
	if err != nil {
		t.Fatal(err)
	}
	credential := ossAvatarCredential{
		Bucket:          "tenant-avatar",
		Endpoint:        endpoint,
		AccessKeyID:     "test-access-key",
		AccessKeySecret: "never-return-this-secret",
	}
	request, err := credential.request(
		context.Background(),
		http.MethodPut,
		"avatars/C000001/user/digest.png",
		"image/png",
		[]byte("png"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if request.URL.String() != "https://tenant-avatar.oss-cn-hangzhou.aliyuncs.com/avatars/C000001/user/digest.png" {
		t.Fatalf("unexpected request URL %q", request.URL.String())
	}
	if !strings.HasPrefix(request.Header.Get("Authorization"), "OSS test-access-key:") {
		t.Fatalf("missing OSS authorization header: %q", request.Header.Get("Authorization"))
	}
	if strings.Contains(request.URL.String(), credential.AccessKeySecret) ||
		strings.Contains(request.Header.Get("Authorization"), credential.AccessKeySecret) {
		t.Fatal("OSS access key secret leaked into request metadata")
	}
	if request.Header.Get("Content-MD5") == "" {
		t.Fatal("PUT request must bind Content-MD5 into the signature")
	}
}
