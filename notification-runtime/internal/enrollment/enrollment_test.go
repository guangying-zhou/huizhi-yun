package enrollment

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunRedeemsOnceAndPersistsOnlyEnrolledCredential(t *testing.T) {
	const enrollmentCode = "hzy_cre_single_use_code"
	const clientSecret = "hzy_cr_test_secret_material_at_least_32_bytes"
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/api/v1/console/connector-runtime/enroll" {
			t.Fatalf("unexpected enrollment request %s %s", request.Method, request.URL.Path)
		}
		var body struct {
			EnrollmentCode string `json:"enrollmentCode"`
			PublicKeyPEM   string `json:"publicKeyPem"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil || body.EnrollmentCode != enrollmentCode {
			t.Fatalf("invalid enrollment request: %+v err=%v", body, err)
		}
		block, _ := pem.Decode([]byte(body.PublicKeyPEM))
		parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
		publicKey, ok := parsed.(*rsa.PublicKey)
		if err != nil || !ok || publicKey.N.BitLen() < 3072 {
			t.Fatalf("invalid connector public key: %v", err)
		}
		ciphertext, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, publicKey, []byte(clientSecret), []byte("hzy-connector-runtime-enrollment.v1"))
		if err != nil {
			t.Fatal(err)
		}
		_ = json.NewEncoder(response).Encode(map[string]string{
			"clientId": "conn_client_1", "encryptedClientSecret": base64.StdEncoding.EncodeToString(ciphertext),
			"connectorId": "connector-runtime.C000001-console", "tenantCode": "C000001", "deploymentCode": "C000001-console",
		})
	}))
	defer server.Close()

	directory := t.TempDir()
	privateKey := filepath.Join(directory, "connector-private.pem")
	output := filepath.Join(directory, "enrollment.env")
	if err := Run([]string{"--console-url", server.URL, "--code", enrollmentCode, "--private-key-file", privateKey, "--output-env", output}); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	text := string(content)
	for _, expected := range []string{"HZY_CONNECTOR_RUNTIME_CLIENT_ID=\"conn_client_1\"", "HZY_CONNECTOR_RUNTIME_CLIENT_SECRET=\"" + clientSecret + "\"", "HZY_CONNECTOR_RUNTIME_TENANT=\"C000001\""} {
		if !strings.Contains(text, expected) {
			t.Fatalf("missing %q in %s", expected, text)
		}
	}
	if strings.Contains(text, enrollmentCode) {
		t.Fatalf("single-use enrollment code was persisted: %s", text)
	}
	info, err := os.Stat(privateKey)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("private key mode=%v", info.Mode().Perm())
	}
}
