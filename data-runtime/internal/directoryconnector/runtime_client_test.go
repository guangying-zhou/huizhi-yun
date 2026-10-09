package directoryconnector

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRuntimeClientSignsLocalLeaseRequest(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/runtime/internal/directory-connector/commands/lease" {
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "" {
			t.Fatal("local runtime request must not use the Console bearer token")
		}
		if request.Header.Get("X-HZY-Directory-Connector-ID") != "connector-1" {
			t.Fatal("connector id header is missing")
		}
		content, readErr := io.ReadAll(request.Body)
		if readErr != nil {
			t.Fatal(readErr)
		}
		bodyDigest := sha256.Sum256(content)
		bodySHA := hex.EncodeToString(bodyDigest[:])
		if request.Header.Get("X-HZY-Directory-Body-SHA256") != bodySHA {
			t.Fatal("body digest header does not match the transmitted JSON")
		}
		canonical := runtimeCanonicalRequest(
			request.Method,
			request.URL.EscapedPath(),
			request.Header.Get("X-HZY-Directory-Timestamp"),
			request.Header.Get("X-HZY-Directory-Nonce"),
			bodySHA,
		)
		digest := sha256.Sum256([]byte(canonical))
		signature, decodeErr := base64.RawURLEncoding.DecodeString(request.Header.Get("X-HZY-Directory-Signature"))
		if decodeErr != nil {
			t.Fatal(decodeErr)
		}
		if verifyErr := rsa.VerifyPSS(&key.PublicKey, crypto.SHA256, digest[:], signature, nil); verifyErr != nil {
			t.Fatalf("invalid request signature: %v", verifyErr)
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"command":null}`))
	}))
	defer server.Close()

	client := NewRuntimeClient(Config{RuntimeURL: server.URL, HTTPTimeout: 2 * time.Second}, "connector-1", key)
	command, err := client.Lease(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if command != nil {
		t.Fatalf("expected no leased command, got %#v", command)
	}
}

func TestRuntimeClientLoadsConnectorConfigurationFromLoopbackRuntime(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/runtime/internal/directory-connector/configuration" {
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "" {
			t.Fatal("local configuration request must not use a Console bearer token")
		}
		if request.Header.Get("X-HZY-Directory-Connector-ID") != "connector-1" {
			t.Fatal("connector signature identity is missing")
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{
			"host":"ldap.internal",
			"port":636,
			"transport":"ldaps",
			"baseDN":"dc=example,dc=com",
			"userBase":"ou=people,dc=example,dc=com",
			"bindDN":"cn=service,dc=example,dc=com",
			"bindPasswordCiphertext":"ciphertext"
		}`))
	}))
	defer server.Close()

	client := NewRuntimeClient(
		Config{RuntimeURL: server.URL, HTTPTimeout: 2 * time.Second},
		"connector-1",
		key,
	)
	configuration, err := client.Configuration(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if configuration.Host != "ldap.internal" ||
		configuration.BindDN != "cn=service,dc=example,dc=com" ||
		configuration.BindPasswordCiphertext != "ciphertext" {
		t.Fatalf("unexpected configuration: %#v", configuration)
	}
}
