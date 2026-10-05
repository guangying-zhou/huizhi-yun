package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/version"
)

var platformSigningKID = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

type controlPlatformSigningKey struct {
	KID       string `json:"kid"`
	Algorithm string `json:"alg"`
	PublicKey string `json:"publicKey"`
}

func startControlHeartbeat(
	ctx context.Context,
	cfg config.Config,
	snapshot func(context.Context) map[string]any,
	requestUpdate func(string) error,
	requestRestart func(),
) {
	if cfg.Control.PlatformURL == "" || cfg.Control.RuntimeCode == "" || cfg.Control.Token == "" {
		return
	}
	go func() {
		timer := time.NewTimer(5 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				response, err := sendControlHeartbeat(ctx, cfg, snapshot)
				if err != nil {
					log.Printf("[hzy-data-runtime] control heartbeat failed: %v", err)
				} else {
					restartRequired := false
					if platformSigningKeyChanged(cfg.Control, response.PlatformSigningKey) {
						if err := writePlatformSigningKey(cfg.Control.PlatformURL, response.PlatformSigningKey); err != nil {
							log.Printf("[hzy-data-runtime] persist Platform signing key failed: %v", err)
						} else {
							log.Printf("[hzy-data-runtime] persisted current Platform signing public key")
							restartRequired = true
						}
					}
					if bindingsChanged(cfg.DeploymentBindings, response.DeploymentBindings, os.Getenv("HZY_LOCAL_WORKFLOW_DEPLOYMENT")) {
						if err := writeDeploymentBindings(response.DeploymentBindings); err != nil {
							log.Printf("[hzy-data-runtime] persist Platform deployment bindings failed: %v", err)
						} else {
							log.Printf("[hzy-data-runtime] persisted Platform deployment bindings")
							restartRequired = true
						}
					}
					if restartRequired {
						log.Printf("[hzy-data-runtime] control-plane trust or binding changed; restarting Runtime")
						requestRestart()
						return
					}
					if response.DesiredVersion != "" && response.DesiredVersion != version.Version {
						if err := requestUpdate(response.DesiredVersion); err != nil {
							log.Printf("[hzy-data-runtime] control-plane update request failed: %v", err)
						} else {
							log.Printf("[hzy-data-runtime] queued control-plane approved update: %s -> %s", version.Version, response.DesiredVersion)
						}
					}
				}
				timer.Reset(5 * time.Minute)
			}
		}
	}()
}

type controlHeartbeatResponse struct {
	DesiredVersion     string
	DeploymentBindings map[string]string
	PlatformSigningKey controlPlatformSigningKey
}

func sendControlHeartbeat(parent context.Context, cfg config.Config, snapshot func(context.Context) map[string]any) (controlHeartbeatResponse, error) {
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	readiness := snapshot(ctx)
	payload := map[string]any{
		"runtimeCode":         cfg.Control.RuntimeCode,
		"runtimeVersion":      version.Version,
		"releaseSigningKeyId": cfg.Control.ReleaseSigningKeyID,
		"runtimeEndpoint":     cfg.Control.RuntimeEndpoint,
		"databaseStatus":      readiness["databaseStatus"],
		"apps":                readiness["apps"],
	}
	content, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.Control.PlatformURL+"/api/v1/runtime/agent-heartbeat", bytes.NewReader(content))
	if err != nil {
		return controlHeartbeatResponse{}, err
	}
	req.Header.Set("authorization", "Bearer "+cfg.Control.Token)
	req.Header.Set("content-type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return controlHeartbeatResponse{}, err
	}
	defer resp.Body.Close()
	responseBody, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if readErr != nil {
		return controlHeartbeatResponse{}, readErr
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return controlHeartbeatResponse{}, fmt.Errorf("Platform heartbeat returned HTTP %d", resp.StatusCode)
	}
	var result struct {
		Data struct {
			DesiredVersion     string                    `json:"desiredVersion"`
			DeploymentBindings map[string]string         `json:"deploymentBindings"`
			PlatformSigningKey controlPlatformSigningKey `json:"platformSigningKey"`
		} `json:"data"`
	}
	if err := json.Unmarshal(responseBody, &result); err != nil {
		return controlHeartbeatResponse{}, fmt.Errorf("decode Platform heartbeat response: %w", err)
	}
	return controlHeartbeatResponse{
		DesiredVersion:     result.Data.DesiredVersion,
		DeploymentBindings: normalizeDeploymentBindings(result.Data.DeploymentBindings),
		PlatformSigningKey: normalizePlatformSigningKey(result.Data.PlatformSigningKey),
	}, nil
}

func normalizeDeploymentBindings(input map[string]string) map[string]string {
	bindings := map[string]string{}
	for appCode, deploymentCode := range input {
		appCode = strings.ToLower(strings.TrimSpace(appCode))
		deploymentCode = strings.TrimSpace(deploymentCode)
		if appCode != "" && deploymentCode != "" {
			bindings[appCode] = deploymentCode
		}
	}
	return bindings
}

func bindingsChanged(current map[string]string, next map[string]string, localWorkflowDeployment string) bool {
	if len(next) == 0 {
		return false
	}
	current = normalizeDeploymentBindings(current)
	next = normalizeDeploymentBindings(next)
	// The exact local Workflow receiver is added after loading the Platform
	// overlay. It is not a Platform binding and must not trigger a restart on
	// every heartbeat. A real Platform Workflow binding still wins comparison.
	if localWorkflowDeployment == "C000001-test-workflow-local" &&
		current["workflow"] == localWorkflowDeployment && next["workflow"] == "" {
		delete(current, "workflow")
	}
	return !reflect.DeepEqual(current, next)
}

func normalizePlatformSigningKey(input controlPlatformSigningKey) controlPlatformSigningKey {
	return controlPlatformSigningKey{
		KID:       strings.TrimSpace(input.KID),
		Algorithm: strings.TrimSpace(input.Algorithm),
		PublicKey: strings.TrimSpace(strings.ReplaceAll(input.PublicKey, `\n`, "\n")),
	}
}

func platformSigningKeyChanged(current config.ControlConfig, next controlPlatformSigningKey) bool {
	next = normalizePlatformSigningKey(next)
	if next.KID == "" {
		return false
	}
	return strings.TrimSpace(current.PlatformSigningKeyID) != next.KID ||
		strings.TrimSpace(current.PlatformSigningPublicKey) != next.PublicKey
}

func writePlatformSigningKey(platformURL string, signingKey controlPlatformSigningKey) error {
	signingKey = normalizePlatformSigningKey(signingKey)
	endpoint, err := url.Parse(strings.TrimSpace(platformURL))
	if err != nil || endpoint.Scheme != "https" || endpoint.Host == "" || endpoint.User != nil {
		return fmt.Errorf("Platform signing key sync requires an authenticated HTTPS Platform URL")
	}
	if !platformSigningKID.MatchString(signingKey.KID) || signingKey.Algorithm != "Ed25519" {
		return fmt.Errorf("Platform signing key metadata is invalid")
	}
	block, _ := pem.Decode([]byte(signingKey.PublicKey))
	if block == nil {
		return fmt.Errorf("Platform signing public key PEM is invalid")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return fmt.Errorf("parse Platform signing public key: %w", err)
	}
	if _, ok := parsed.(ed25519.PublicKey); !ok {
		return fmt.Errorf("Platform signing public key must be Ed25519")
	}
	configDir := envDefault("HZY_DATA_RUNTIME_CONFIG_DIR", "/etc/hzy-data-runtime")
	return writeProtectedJSON(filepath.Join(configDir, "platform-signing-key.json"), signingKey)
}

func writeDeploymentBindings(bindings map[string]string) error {
	bindings = normalizeDeploymentBindings(bindings)
	if len(bindings) == 0 {
		return fmt.Errorf("Platform returned empty deployment bindings")
	}
	configDir := envDefault("HZY_DATA_RUNTIME_CONFIG_DIR", "/etc/hzy-data-runtime")
	return writeProtectedJSON(filepath.Join(configDir, "deployment-bindings.json"), bindings)
}

func writeProtectedJSON(path string, value any) error {
	configDir := filepath.Dir(path)
	if err := os.MkdirAll(configDir, 0750); err != nil {
		return err
	}
	content, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	content = append(content, '\n')
	temporary, err := os.CreateTemp(configDir, "."+filepath.Base(path)+"-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0600); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(content); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return err
	}
	if err := os.Chmod(path, 0600); err != nil {
		return err
	}
	return nil
}
