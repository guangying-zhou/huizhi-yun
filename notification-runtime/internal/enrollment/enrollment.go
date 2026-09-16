package enrollment

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/huizhi-yun/notification-runtime/internal/version"
)

type response struct {
	ClientID              string `json:"clientId"`
	EncryptedClientSecret string `json:"encryptedClientSecret"`
	ConnectorID           string `json:"connectorId"`
	TenantCode            string `json:"tenantCode"`
	DeploymentCode        string `json:"deploymentCode"`
}

func Run(args []string) error {
	consoleURL := strings.TrimRight(strings.TrimSpace(os.Getenv("HZY_CONNECTOR_RUNTIME_CONSOLE_URL")), "/")
	code := strings.TrimSpace(os.Getenv("HZY_CONNECTOR_RUNTIME_ENROLLMENT_CODE"))
	privateKeyFile := envDefault("HZY_CONNECTOR_RUNTIME_PRIVATE_KEY_FILE", "/etc/hzy-connector-runtime/connector-private.pem")
	output := ""
	flags := flag.NewFlagSet("connector-runtime-enroll", flag.ContinueOnError)
	flags.StringVar(&consoleURL, "console-url", consoleURL, "tenant Console base URL")
	flags.StringVar(&code, "code", code, "single-use Connector Runtime enrollment code")
	flags.StringVar(&privateKeyFile, "private-key-file", privateKeyFile, "workload RSA private key file")
	flags.StringVar(&output, "output-env", output, "write enrolled connector credentials to this env file")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if consoleURL == "" || code == "" || output == "" {
		return errors.New("console-url, code and output-env are required")
	}
	parsedURL, err := url.Parse(consoleURL)
	if err != nil || (parsedURL.Scheme != "https" && !(parsedURL.Scheme == "http" && isLoopback(parsedURL.Hostname()))) {
		return errors.New("Console URL must use HTTPS (loopback HTTP is allowed for development)")
	}

	key, err := loadOrCreateKey(privateKeyFile)
	if err != nil {
		return err
	}
	publicDER, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(map[string]any{
		"enrollmentCode": code,
		"publicKeyPem":   string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER})),
		"version":        version.Version,
		"capabilities":   []string{"notifications.send@v1", "deliveries.read@v1", "deliveries.reconcile@v1", "identity.wecom.exchange@v1", "identity.wecom.browser-login@v1", "identity.dingtalk.exchange@v1", "people.dingtalk.sync@v1", "people.sync.jobs.read@v1", "runtime.diagnostics.read@v1"},
	})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, consoleURL+"/api/v1/console/connector-runtime/enroll", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("content-type", "application/json")
	request.Header.Set("user-agent", "hzy-connector-runtime/"+version.Version)
	result, err := http.DefaultClient.Do(request)
	if err != nil {
		return fmt.Errorf("redeem Connector Runtime enrollment: %w", err)
	}
	defer result.Body.Close()
	content, err := io.ReadAll(io.LimitReader(result.Body, 1<<20))
	if err != nil {
		return err
	}
	if result.StatusCode < 200 || result.StatusCode >= 300 {
		return fmt.Errorf("Connector Runtime enrollment returned HTTP %d", result.StatusCode)
	}
	var enrolled response
	if err := json.Unmarshal(content, &enrolled); err != nil || enrolled.ClientID == "" || enrolled.EncryptedClientSecret == "" || enrolled.ConnectorID == "" || enrolled.TenantCode == "" || enrolled.DeploymentCode == "" {
		return errors.New("Connector Runtime enrollment response is invalid")
	}
	ciphertext, err := base64.StdEncoding.DecodeString(enrolled.EncryptedClientSecret)
	if err != nil {
		return errors.New("Connector Runtime enrollment secret is invalid")
	}
	clientSecret, err := rsa.DecryptOAEP(sha256.New(), rand.Reader, key, ciphertext, []byte("hzy-connector-runtime-enrollment.v1"))
	if err != nil || len(clientSecret) < 32 {
		return errors.New("Connector Runtime enrollment secret could not be decrypted")
	}
	lines := []string{
		envLine("HZY_CONNECTOR_RUNTIME_CLIENT_ID", enrolled.ClientID),
		envLine("HZY_CONNECTOR_RUNTIME_CLIENT_SECRET", string(clientSecret)),
		envLine("HZY_CONNECTOR_RUNTIME_ID", enrolled.ConnectorID),
		envLine("HZY_CONNECTOR_RUNTIME_TENANT", enrolled.TenantCode),
		envLine("HZY_CONNECTOR_RUNTIME_DEPLOYMENT", enrolled.DeploymentCode),
		envLine("HZY_CONNECTOR_RUNTIME_PRIVATE_KEY_FILE", privateKeyFile),
	}
	if err := os.WriteFile(output, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		return fmt.Errorf("write Connector Runtime enrollment environment: %w", err)
	}
	return nil
}

func loadOrCreateKey(path string) (*rsa.PrivateKey, error) {
	content, err := os.ReadFile(path)
	if err == nil {
		block, _ := pem.Decode(content)
		if block == nil {
			return nil, errors.New("Connector Runtime private key PEM is invalid")
		}
		parsed, parseErr := x509.ParsePKCS8PrivateKey(block.Bytes)
		key, ok := parsed.(*rsa.PrivateKey)
		if parseErr != nil || !ok || key.N.BitLen() < 3072 {
			return nil, errors.New("Connector Runtime private key must be RSA 3072 bits or stronger")
		}
		return key, nil
	}
	if !os.IsNotExist(err) {
		return nil, err
	}
	key, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		return nil, err
	}
	encoded, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded}), 0o600); err != nil {
		return nil, err
	}
	return key, nil
}

func envLine(key string, value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "\"", "\\\"")
	value = strings.ReplaceAll(value, "\n", "")
	return key + "=\"" + value + "\""
}

func envDefault(key string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func isLoopback(host string) bool {
	return host == "127.0.0.1" || host == "localhost" || host == "::1"
}
