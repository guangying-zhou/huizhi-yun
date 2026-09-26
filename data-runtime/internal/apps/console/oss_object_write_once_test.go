package console

import (
	"context"
	"crypto/hmac"
	"crypto/md5"
	"crypto/sha1"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// fakeWriteOnceOSS checks both signatures (HEAD without, PUT with the
// forbid-overwrite header) and keeps objects in memory.
func fakeWriteOnceOSS(t *testing.T, objects map[string]string, putStatus int) (ossAvatarCredential, *int) {
	t.Helper()
	puts := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.URL.Path, "/")
		canonical := r.Method + "\n\n\n" + r.Header.Get("Date") + "\n/wiz-test/" + key
		body, _ := io.ReadAll(r.Body)
		if r.Method == http.MethodPut {
			sum := md5.Sum(body)
			if r.Header.Get("Content-MD5") != base64.StdEncoding.EncodeToString(sum[:]) || r.Header.Get("x-oss-forbid-overwrite") != "true" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			canonical = "PUT\n" + r.Header.Get("Content-MD5") + "\n" + r.Header.Get("Content-Type") + "\n" + r.Header.Get("Date") + "\nx-oss-forbid-overwrite:true\n/wiz-test/" + key
		}
		mac := hmac.New(sha1.New, []byte("secret"))
		_, _ = mac.Write([]byte(canonical))
		if r.Header.Get("Authorization") != "OSS AKID:"+base64.StdEncoding.EncodeToString(mac.Sum(nil)) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		switch r.Method {
		case http.MethodHead:
			if _, ok := objects[key]; ok {
				w.WriteHeader(http.StatusOK)
				return
			}
			w.WriteHeader(http.StatusNotFound)
		case http.MethodPut:
			puts++
			if putStatus != 0 {
				w.WriteHeader(putStatus)
				return
			}
			objects[key] = string(body)
			w.Header().Set("x-oss-version-id", "CAEQ-v1")
		}
	}))
	t.Cleanup(server.Close)
	original := integrationHTTPClient
	integrationHTTPClient = server.Client()
	t.Cleanup(func() { integrationHTTPClient = original })
	endpoint, _ := url.Parse(server.URL)
	return ossAvatarCredential{Bucket: "wiz-test", Endpoint: endpoint, AccessKeyID: "AKID", AccessKeySecret: "secret"}, &puts
}

func TestOSSWriteOnceUploadsSignedAndReturnsVersion(t *testing.T) {
	objects := map[string]string{}
	credential, _ := fakeWriteOnceOSS(t, objects, 0)
	stored, err := credential.putWriteOnce(context.Background(), "codocs/snapshots/h/a/body.md", "text/markdown; charset=utf-8", []byte("# hi"))
	if err != nil {
		t.Fatal(err)
	}
	if stored.Version != "CAEQ-v1" || stored.Size != 4 || objects["codocs/snapshots/h/a/body.md"] != "# hi" {
		t.Fatalf("unexpected result %+v %v", stored, objects)
	}
}

func TestOSSWriteOnceRefusesExistingKeysAndMissingVersions(t *testing.T) {
	objects := map[string]string{"codocs/k/body.md": "old"}
	credential, puts := fakeWriteOnceOSS(t, objects, 0)
	if _, err := credential.putWriteOnce(context.Background(), "codocs/k/body.md", "text/markdown", []byte("new")); err == nil || !strings.Contains(err.Error(), "exists") {
		t.Fatalf("existing key must be refused, got %v", err)
	}
	if *puts != 0 || objects["codocs/k/body.md"] != "old" {
		t.Fatal("existing key must never be overwritten")
	}
	for status, want := range map[int]string{http.StatusConflict: "exists", http.StatusForbidden: "rejected"} {
		credential, _ := fakeWriteOnceOSS(t, map[string]string{}, status)
		if _, err := credential.putWriteOnce(context.Background(), "codocs/n/body.md", "text/markdown", []byte("x")); err == nil || !strings.Contains(err.Error(), want) {
			t.Fatalf("status %d: got %v", status, err)
		}
	}
	// A bucket without versioning returns no version ID: fail closed.
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	original := integrationHTTPClient
	integrationHTTPClient = server.Client()
	t.Cleanup(func() { integrationHTTPClient = original })
	endpoint, _ := url.Parse(server.URL)
	unversioned := ossAvatarCredential{Bucket: "wiz-test", Endpoint: endpoint, AccessKeyID: "AKID", AccessKeySecret: "secret"}
	if _, err := unversioned.putWriteOnce(context.Background(), "codocs/n/body.md", "text/markdown", []byte("x")); err == nil || !strings.Contains(err.Error(), "no version") {
		t.Fatalf("missing version must fail, got %v", err)
	}
}
