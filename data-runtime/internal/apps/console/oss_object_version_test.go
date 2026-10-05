package console

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// fakeOSS verifies the V1 signature for the canonical resource it expects and
// answers from the handler; a wrong canonical string fails with 403.
func fakeOSS(t *testing.T, handle func(w http.ResponseWriter, r *http.Request, resource string)) ossAvatarCredential {
	t.Helper()
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resource := "/wiz-test/" + strings.TrimPrefix(r.URL.Path, "/")
		if r.URL.RawQuery != "" {
			query, _ := url.QueryUnescape(r.URL.RawQuery)
			resource += "?" + query
		}
		mac := hmac.New(sha1.New, []byte("secret"))
		_, _ = mac.Write([]byte("GET\n\n\n" + r.Header.Get("Date") + "\n" + resource))
		if r.Header.Get("Authorization") != "OSS AKID:"+base64.StdEncoding.EncodeToString(mac.Sum(nil)) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		handle(w, r, resource)
	}))
	t.Cleanup(server.Close)
	original := integrationHTTPClient
	integrationHTTPClient = server.Client()
	t.Cleanup(func() { integrationHTTPClient = original })
	endpoint, _ := url.Parse(server.URL)
	return ossAvatarCredential{Bucket: "wiz-test", Endpoint: endpoint, AccessKeyID: "AKID", AccessKeySecret: "secret"}
}

func TestOSSObjectVersionReadsExactSignedVersion(t *testing.T) {
	credential := fakeOSS(t, func(w http.ResponseWriter, r *http.Request, resource string) {
		if resource != "/wiz-test/codocs/snapshots/a b/body.md?versionId=CAEQ+/=" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		w.Header().Set("x-oss-version-id", "CAEQ+/=")
		_, _ = w.Write([]byte("hello"))
	})
	read, err := credential.openVersion(context.Background(), "codocs/snapshots/a b/body.md", "CAEQ+/=")
	if err != nil {
		t.Fatal(err)
	}
	defer read.Body.Close()
	body, _ := io.ReadAll(read.Body)
	if string(body) != "hello" || read.Version != "CAEQ+/=" || read.Key != "codocs/snapshots/a b/body.md" {
		t.Fatalf("unexpected read %q %+v", body, read)
	}
}

func TestOSSObjectVersionFailsClosed(t *testing.T) {
	for name, handle := range map[string]func(http.ResponseWriter){
		"other version": func(w http.ResponseWriter) { w.Header().Set("x-oss-version-id", "LATEST"); _, _ = w.Write([]byte("x")) },
		"no version":    func(w http.ResponseWriter) { _, _ = w.Write([]byte("x")) },
		"not found":     func(w http.ResponseWriter) { w.WriteHeader(http.StatusNotFound) },
		"denied":        func(w http.ResponseWriter) { w.WriteHeader(http.StatusForbidden) },
	} {
		credential := fakeOSS(t, func(w http.ResponseWriter, _ *http.Request, _ string) { handle(w) })
		if _, err := credential.openVersion(context.Background(), "codocs/a.md", "V1"); err == nil {
			t.Fatalf("%s: expected failure", name)
		}
	}
	for _, key := range []string{"", "/abs", "a//b", "a/../b", "a\\b"} {
		if validOSSObjectKey(key) {
			t.Fatalf("key %q accepted", key)
		}
	}
	for _, version := range []string{"", "null", "a b", `a"b`, strings.Repeat("v", 257)} {
		if validOSSVersionID(version) {
			t.Fatalf("version %q accepted", version)
		}
	}
}

func TestOSSBucketRetentionParsesVersioningAndLifecycle(t *testing.T) {
	credential := fakeOSS(t, func(w http.ResponseWriter, _ *http.Request, resource string) {
		switch resource {
		case "/wiz-test/?versioning":
			_, _ = w.Write([]byte(`<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>`))
		case "/wiz-test/?lifecycle":
			_, _ = w.Write([]byte(`<LifecycleConfiguration>
<Rule><ID>logs</ID><Prefix>logs/</Prefix><Status>Enabled</Status><Expiration><Days>30</Days></Expiration></Rule>
<Rule><ID>old</ID><Prefix></Prefix><Status>Disabled</Status><NoncurrentVersionExpiration><NoncurrentDays>7</NoncurrentDays></NoncurrentVersionExpiration></Rule>
</LifecycleConfiguration>`))
		default:
			w.WriteHeader(http.StatusForbidden)
		}
	})
	retention, err := credential.retention(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if retention.Versioning != "Enabled" || len(retention.Rules) != 2 || retention.Rules[0].ExpirationDays != 30 || retention.Rules[1].NoncurrentDays != 7 || retention.Rules[1].Enabled {
		t.Fatalf("unexpected retention %+v", retention)
	}
	if err := retention.RetainsVersionsUnder("codocs/snapshots/", false); err != nil {
		t.Fatalf("unrelated or disabled rules must not block: %v", err)
	}
	if retention.RetainsVersionsUnder("logs/app/", true) == nil {
		t.Fatal("expiring rule over the prefix must block")
	}
}

func TestOSSBucketRetentionPolicy(t *testing.T) {
	enabled := func(rules ...OSSLifecycleRule) OSSBucketRetention {
		return OSSBucketRetention{Versioning: "Enabled", Rules: rules}
	}
	cases := []struct {
		name      string
		retention OSSBucketRetention
		ok        bool
	}{
		{"never enabled", OSSBucketRetention{Versioning: "Disabled"}, false},
		{"suspended", OSSBucketRetention{Versioning: "Suspended"}, false},
		{"no lifecycle", enabled(), true},
		{"bucket-wide noncurrent expiry", enabled(OSSLifecycleRule{Enabled: true, NoncurrentDays: 90}), false},
		{"parent prefix expiry", enabled(OSSLifecycleRule{Prefix: "codocs/", Enabled: true, ExpirationDays: 1}), false},
		{"child prefix date expiry", enabled(OSSLifecycleRule{Prefix: "codocs/snapshots/x/", Enabled: true, ExpirationDate: true}), false},
		{"sibling prefix expiry", enabled(OSSLifecycleRule{Prefix: "codocs/tmp/", Enabled: true, ExpirationDays: 1}), true},
	}
	for _, c := range cases {
		if err := c.retention.RetainsVersionsUnder("codocs/snapshots/", false); (err == nil) != c.ok {
			t.Fatalf("%s: got %v", c.name, err)
		}
	}
	// The real test bucket shape: noncurrent expiry on codocs/ breaks
	// overwritten history but not write-once snapshot keys.
	real := enabled(OSSLifecycleRule{Prefix: "codocs/", Enabled: true, NoncurrentDays: 30}, OSSLifecycleRule{Prefix: "recycle.bin", Enabled: true, ExpirationDays: 30})
	if real.RetainsVersionsUnder("codocs/", false) == nil {
		t.Fatal("overwritten history under a noncurrent expiry must fail")
	}
	if err := real.RetainsVersionsUnder("codocs/snapshots/", true); err != nil {
		t.Fatalf("write-once snapshots must pass: %v", err)
	}
	if enabled(OSSLifecycleRule{Prefix: "codocs/", Enabled: true, ExpirationDays: 30}).RetainsVersionsUnder("codocs/snapshots/", true) == nil {
		t.Fatal("current-object expiry must fail even for write-once keys")
	}
}

func TestOSSBucketRetentionTreatsMissingLifecycleAsNone(t *testing.T) {
	credential := fakeOSS(t, func(w http.ResponseWriter, _ *http.Request, resource string) {
		if resource == "/wiz-test/?versioning" {
			_, _ = w.Write([]byte(`<VersioningConfiguration/>`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`<Error><Code>NoSuchLifecycle</Code></Error>`))
	})
	retention, err := credential.retention(context.Background())
	if err != nil || retention.Versioning != "Disabled" || len(retention.Rules) != 0 {
		t.Fatalf("unexpected %+v %v", retention, err)
	}
}
