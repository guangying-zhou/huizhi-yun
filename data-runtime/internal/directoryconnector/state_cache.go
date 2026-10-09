package directoryconnector

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const connectorStateCacheVersion = 1

type connectorStateCache struct {
	Version       int                `json:"version"`
	ConnectorID   string             `json:"connectorId"`
	Configuration *LDAPConfiguration `json:"configuration,omitempty"`
}

func loadConnectorState(path string) (connectorStateCache, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return connectorStateCache{}, err
	}
	var state connectorStateCache
	if err := json.Unmarshal(content, &state); err != nil {
		return connectorStateCache{}, fmt.Errorf("decode Directory Connector state cache: %w", err)
	}
	if state.Version != connectorStateCacheVersion {
		return connectorStateCache{}, errors.New("Directory Connector state cache version is unsupported")
	}
	state.ConnectorID = strings.TrimSpace(state.ConnectorID)
	return state, nil
}

func saveConnectorState(path string, state connectorStateCache) error {
	if strings.TrimSpace(path) == "" {
		return errors.New("Directory Connector state cache path is empty")
	}
	state.Version = connectorStateCacheVersion
	encoded, err := json.Marshal(state)
	if err != nil {
		return err
	}
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0700); err != nil {
		return fmt.Errorf("create Directory Connector state directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".state-cache-*")
	if err != nil {
		return fmt.Errorf("create Directory Connector state cache: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(append(encoded, '\n')); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("replace Directory Connector state cache: %w", err)
	}
	return os.Chmod(path, 0600)
}
