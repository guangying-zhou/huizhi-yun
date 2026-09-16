package peoplejobs

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func connectorTestKey(t *testing.T) (*rsa.PrivateKey, string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "connector-private.pem")
	content := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	if err = os.WriteFile(path, content, 0o600); err != nil {
		t.Fatal(err)
	}
	return key, path
}

func TestDataRuntimeSinkRequiresSecureFixedOrigin(t *testing.T) {
	_, keyFile := connectorTestKey(t)
	for _, accepted := range []string{
		"https://wiztek-data-runtime.huizhi.yun",
		"https://runtime.example.com:8443/",
		"http://127.0.0.1:8080",
		"http://[::1]:8080/",
		"http://localhost:8080",
	} {
		if _, err := NewDataRuntimeSink(accepted, "connector-runtime.C000001-console", keyFile); err != nil {
			t.Errorf("NewDataRuntimeSink(%q) returned %v", accepted, err)
		}
	}
	for _, rejected := range []string{
		"",
		"http://runtime.example.com",
		"https://user:pass@runtime.example.com",
		"https://runtime.example.com/base",
		"https://runtime.example.com?target=other",
		"https://runtime.example.com#fragment",
		"file:///var/run/data-runtime.sock",
	} {
		if _, err := NewDataRuntimeSink(rejected, "connector-runtime.C000001-console", keyFile); err == nil {
			t.Errorf("NewDataRuntimeSink(%q) unexpectedly succeeded", rejected)
		}
	}
}

func TestDataRuntimeSinkSignsExactPeopleBatchRequest(t *testing.T) {
	key, keyFile := connectorTestKey(t)
	connectorID := "connector-runtime.C000001-console"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != peopleBatchPath {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		bodySum := sha256.Sum256(body)
		bodySHA := hex.EncodeToString(bodySum[:])
		if got := r.Header.Get("X-HZY-Connector-Runtime-ID"); got != connectorID {
			t.Errorf("connector ID = %q", got)
		}
		if got := r.Header.Get("X-HZY-Connector-Body-SHA256"); got != bodySHA {
			t.Errorf("body SHA = %q, want %q", got, bodySHA)
		}
		canonical := strings.Join([]string{
			http.MethodPost,
			peopleBatchPath,
			r.Header.Get("X-HZY-Connector-Timestamp"),
			r.Header.Get("X-HZY-Connector-Nonce"),
			bodySHA,
		}, "\n")
		digest := sha256.Sum256([]byte(canonical))
		signature, err := base64.RawURLEncoding.DecodeString(r.Header.Get("X-HZY-Connector-Signature"))
		if err != nil {
			t.Fatal(err)
		}
		if err = rsa.VerifyPSS(&key.PublicKey, crypto.SHA256, digest[:], signature, nil); err != nil {
			t.Errorf("signature verification failed: %v", err)
		}
		w.Header().Set("content-type", "application/json")
		fmt.Fprint(w, `{"applied":1,"skipped":0,"replayed":false,"final":true}`)
	}))
	defer server.Close()

	sink, err := NewDataRuntimeSink(server.URL, connectorID, keyFile)
	if err != nil {
		t.Fatal(err)
	}
	counts, err := sink.Apply(context.Background(), Batch{
		JobID: "crj_test", BatchNumber: 1, Final: true, Provider: "dingtalk",
		IntegrationCode: "dingtalk.default", Watermark: "2026-07-14T00:00:00Z",
		Departments: []Department{{ProviderID: "1", Name: "Engineering"}},
		Users:       []User{{ProviderSubject: "u1", Name: "User One", Active: true}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if counts.Applied != 1 || counts.Skipped != 0 {
		t.Fatalf("unexpected counts: %+v", counts)
	}
}

func TestDecodeDataRuntimeCountsSupportsLegacyEnvelope(t *testing.T) {
	counts, err := decodeDataRuntimeCounts([]byte(`{"data":{"applied":2,"skipped":3}}`))
	if err != nil {
		t.Fatal(err)
	}
	if counts.Applied != 2 || counts.Skipped != 3 {
		t.Fatalf("unexpected counts: %+v", counts)
	}
}

func TestDecodeDataRuntimeCountsRejectsMissingReceiptCounts(t *testing.T) {
	if _, err := decodeDataRuntimeCounts([]byte(`{"replayed":false,"final":true}`)); err == nil {
		t.Fatal("expected missing receipt counts to fail")
	}
}

func TestDataRuntimeSinkDoesNotFollowRedirects(t *testing.T) {
	_, keyFile := connectorTestKey(t)
	var redirectedRequests atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		redirectedRequests.Add(1)
	}))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer source.Close()

	sink, err := NewDataRuntimeSink(source.URL, "connector-runtime.C000001-console", keyFile)
	if err != nil {
		t.Fatal(err)
	}
	_, err = sink.Apply(context.Background(), Batch{JobID: "crj_redirect", Provider: "dingtalk"})
	if err == nil || !strings.Contains(err.Error(), "HTTP 307") {
		t.Fatalf("Apply error = %v, want HTTP 307", err)
	}
	if redirectedRequests.Load() != 0 {
		t.Fatalf("redirect target received %d requests", redirectedRequests.Load())
	}
}

func TestDataRuntimeSinkRejectsInvalidResponse(t *testing.T) {
	_, keyFile := connectorTestKey(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"data": "invalid"})
	}))
	defer server.Close()
	sink, err := NewDataRuntimeSink(server.URL, "connector-runtime.C000001-console", keyFile)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = sink.Apply(context.Background(), Batch{JobID: "crj_invalid"}); err == nil {
		t.Fatal("Apply unexpectedly accepted an invalid response")
	}
}
