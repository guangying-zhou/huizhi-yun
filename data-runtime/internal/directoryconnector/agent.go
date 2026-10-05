package directoryconnector

import (
	"context"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"time"
)

type Agent struct {
	cfg             Config
	runtime         *RuntimeClient
	privateKey      *rsa.PrivateKey
	ldapConfig      ldapRuntimeConfig
	configured      bool
	nextConfigFetch time.Time
	cachedState     connectorStateCache
}

func New(cfg Config) (*Agent, error) {
	key, err := loadOrCreatePrivateKey(cfg.PrivateKeyFile)
	if err != nil {
		return nil, err
	}
	agent := &Agent{cfg: cfg, privateKey: key}
	state, stateErr := loadConnectorState(cfg.StateCacheFile)
	if stateErr == nil {
		agent.cachedState = state
		if cfg.ConnectorID == "" {
			cfg.ConnectorID = state.ConnectorID
			agent.cfg.ConnectorID = state.ConnectorID
		}
		if state.Configuration != nil {
			if err := agent.applyConfiguration(*state.Configuration); err != nil {
				log.Printf("[directory-connector] ignored unusable cached configuration: %v", err)
			}
		}
	} else if !os.IsNotExist(stateErr) {
		log.Printf("[directory-connector] ignored unreadable state cache: %v", stateErr)
	}
	if cfg.ConnectorID != "" {
		agent.runtime = NewRuntimeClient(cfg, cfg.ConnectorID, key)
	}
	if agent.runtime == nil {
		return nil, errors.New("Directory Connector identity is missing; redeem an enrollment token before starting the agent")
	}
	return agent, nil
}

func (a *Agent) Run(ctx context.Context) error {
	if err := a.refreshConfiguration(ctx); err != nil {
		if !a.configured {
			a.nextConfigFetch = time.Now().Add(a.cfg.RefreshBackoff)
			log.Printf("[directory-connector] Tenant Runtime configuration unavailable; retrying in %s: %v", a.cfg.RefreshBackoff, err)
		} else {
			log.Printf("[directory-connector] Tenant Runtime configuration refresh failed; using encrypted local cache: %v", err)
		}
	}
	ticker := time.NewTicker(a.cfg.PollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if err := a.tick(ctx); err != nil {
				log.Printf("[directory-connector] tick failed: %v", err)
			}
		}
	}
}

func (a *Agent) tick(ctx context.Context) error {
	now := time.Now()
	if !now.Before(a.nextConfigFetch) {
		if err := a.refreshConfiguration(ctx); err != nil {
			a.nextConfigFetch = now.Add(a.cfg.RefreshBackoff)
			if !a.configured {
				return err
			}
			log.Printf("[directory-connector] Tenant Runtime configuration refresh failed; continuing with encrypted local cache: %v", err)
		}
	}
	if !a.configured {
		return nil
	}
	command, err := a.runtime.Lease(ctx)
	if err != nil || command == nil {
		return err
	}
	return a.execute(ctx, command)
}

func (a *Agent) refreshConfiguration(ctx context.Context) error {
	if a.runtime == nil {
		return errors.New("Tenant Runtime connector identity is not initialized")
	}
	configuration, err := a.runtime.Configuration(ctx)
	if err != nil {
		return err
	}
	if err := a.applyConfiguration(configuration); err != nil {
		return err
	}
	a.cachedState.ConnectorID = a.cfg.ConnectorID
	a.cachedState.Configuration = &configuration
	if err := saveConnectorState(a.cfg.StateCacheFile, a.cachedState); err != nil {
		return fmt.Errorf("persist encrypted Directory Connector configuration: %w", err)
	}
	a.nextConfigFetch = time.Now().Add(a.configurationRefreshInterval())
	return nil
}

func (a *Agent) applyConfiguration(configuration LDAPConfiguration) error {
	password, err := decryptSecret(a.privateKey, configuration.BindPasswordCiphertext)
	if err != nil {
		return err
	}
	a.ldapConfig = ldapRuntimeConfig{LDAPConfiguration: configuration, BindPassword: password}
	a.configured = true
	return nil
}

func (a *Agent) configurationRefreshInterval() time.Duration {
	seconds := a.ldapConfig.SyncIntervalSeconds
	if seconds <= 0 {
		seconds = 300
	}
	return time.Duration(seconds) * time.Second
}

func (a *Agent) sync(ctx context.Context) error {
	users, err := listLDAPUsers(ctx, a.ldapConfig)
	if err != nil {
		return err
	}
	if err := a.runtime.PushSync(ctx, users, true); err != nil {
		return err
	}
	log.Printf("[directory-connector] LDAP sync completed: users=%d", len(users))
	return nil
}

func (a *Agent) execute(ctx context.Context, command *LeasedCommand) error {
	encoded, err := json.Marshal(command.Command)
	if err != nil {
		return a.fail(ctx, command, "invalid_command", err, false)
	}
	hash := sha256.Sum256(encoded)
	if hex.EncodeToString(hash[:]) != strings.ToLower(command.CommandSHA256) {
		return a.fail(ctx, command, "command_hash_mismatch", errors.New("directory command hash mismatch"), false)
	}
	var result map[string]any
	switch command.OperationCode {
	case "console.directory-connector.create-user.v1":
		password, decryptErr := decryptSecret(a.privateKey, stringField(command.Command, "initialPasswordCiphertext"))
		if decryptErr != nil {
			return a.fail(ctx, command, "secret_decrypt_failed", decryptErr, false)
		}
		user, operationErr := createLDAPUser(ctx, a.ldapConfig, command.Command, password)
		if operationErr != nil {
			return a.fail(ctx, command, classifyLDAPError(operationErr), operationErr, retryableLDAPError(operationErr))
		}
		result = map[string]any{"user": user}
	case "console.directory-connector.change-password.v1":
		currentPassword, currentErr := decryptSecret(a.privateKey, stringField(command.Command, "currentPasswordCiphertext"))
		newPassword, newErr := decryptSecret(a.privateKey, stringField(command.Command, "newPasswordCiphertext"))
		if currentErr != nil || newErr != nil {
			return a.fail(ctx, command, "secret_decrypt_failed", errors.Join(currentErr, newErr), false)
		}
		if operationErr := changeLDAPPassword(ctx, a.ldapConfig, stringField(command.Command, "dn"), currentPassword, newPassword); operationErr != nil {
			return a.fail(ctx, command, classifyLDAPError(operationErr), operationErr, retryableLDAPError(operationErr))
		}
		result = map[string]any{"uid": stringField(command.Command, "uid"), "passwordChanged": true}
	case "console.directory-connector.reset-password.v1":
		newPassword, decryptErr := decryptSecret(a.privateKey, stringField(command.Command, "newPasswordCiphertext"))
		if decryptErr != nil {
			return a.fail(ctx, command, "secret_decrypt_failed", decryptErr, false)
		}
		if operationErr := resetLDAPPassword(ctx, a.ldapConfig, stringField(command.Command, "dn"), newPassword); operationErr != nil {
			return a.fail(ctx, command, classifyLDAPError(operationErr), operationErr, retryableLDAPError(operationErr))
		}
		result = map[string]any{"uid": stringField(command.Command, "uid"), "passwordReset": true}
	case "console.directory-connector.sync-now.v1":
		if operationErr := a.sync(ctx); operationErr != nil {
			return a.fail(ctx, command, classifyLDAPError(operationErr), operationErr, retryableLDAPError(operationErr))
		}
		result = map[string]any{"fullSync": true, "syncedAt": time.Now().UTC().Format(time.RFC3339)}
	case "console.directory-connector.test-connection.v1":
		// Refresh immediately so a test performed after saving a new Vault secret
		// never uses the connector's previous in-memory bind password.
		if operationErr := a.refreshConfiguration(ctx); operationErr != nil {
			return a.fail(ctx, command, "ldap_configuration_unavailable", operationErr, false)
		}
		testResult, errorCode, operationErr := testLDAPConnection(ctx, a.ldapConfig)
		if operationErr != nil {
			return a.fail(ctx, command, errorCode, operationErr, false)
		}
		result = map[string]any{
			"connected":     testResult.Connected,
			"authenticated": testResult.Authenticated,
			"baseReadable":  testResult.BaseReadable,
			"elapsedMs":     testResult.ElapsedMS,
			"checkedAt":     time.Now().UTC().Format(time.RFC3339),
		}
	default:
		return a.fail(ctx, command, "unsupported_operation", errors.New("unsupported directory connector operation"), false)
	}
	return a.runtime.Complete(ctx, command, map[string]any{"status": "succeeded", "result": result})
}

func (a *Agent) fail(ctx context.Context, command *LeasedCommand, code string, err error, retryable bool) error {
	message := "directory operation failed"
	if err != nil {
		message = strings.ReplaceAll(strings.ReplaceAll(err.Error(), "\n", " "), "\r", " ")
		if len(message) > 500 {
			message = message[:500]
		}
	}
	completeErr := a.runtime.Complete(ctx, command, map[string]any{
		"status": "failed", "errorCode": code, "errorMessage": message, "retryable": retryable,
	})
	return errors.Join(err, completeErr)
}

func classifyLDAPError(err error) string {
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "invalid credentials"):
		return "ldap_invalid_credentials"
	case strings.Contains(message, "already exists"):
		return "ldap_entry_exists"
	case strings.Contains(message, "constraint"):
		return "ldap_constraint_violation"
	case strings.Contains(message, "timeout") || strings.Contains(message, "connection"):
		return "ldap_unavailable"
	default:
		return "ldap_operation_failed"
	}
}

func retryableLDAPError(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "timeout") || strings.Contains(message, "connection") || strings.Contains(message, "unavailable")
}
