package migration

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed connector-runtime.v1.json
var connectorRuntimeV1 []byte

type Product struct {
	Product        string `json:"product"`
	ServiceName    string `json:"serviceName"`
	Executable     string `json:"executable"`
	MinimumVersion string `json:"minimumVersion,omitempty"`
}

type CompatibilityRoute struct {
	Method      string `json:"method"`
	Path        string `json:"path"`
	SourceScope string `json:"sourceScope"`
	TargetScope string `json:"targetScope"`
}

type State struct {
	SourceSQLitePath        string `json:"sourceSQLitePath"`
	TargetSQLitePath        string `json:"targetSQLitePath"`
	PreserveDeliveryLedger  bool   `json:"preserveDeliveryLedger"`
	ContainsProviderSecrets bool   `json:"containsProviderSecrets"`
}

type Rollback struct {
	Enabled                            bool `json:"enabled"`
	KeepSourceInstalled                bool `json:"keepSourceInstalled"`
	DisableSourceUpdaterAfterCutover   bool `json:"disableSourceUpdaterAfterCutover"`
	RestoreSourceOnTargetHealthFailure bool `json:"restoreSourceOnTargetHealthFailure"`
}

type Security struct {
	ArbitraryHTTPProxy        bool   `json:"arbitraryHttpProxy"`
	ProviderSecretsInState    bool   `json:"providerSecretsInState"`
	ProviderCredentialsSource string `json:"providerCredentialsSource"`
}

type Contract struct {
	SchemaVersion        string               `json:"schemaVersion"`
	Source               Product              `json:"source"`
	Target               Product              `json:"target"`
	Activation           string               `json:"activation"`
	Compatibility        []CompatibilityRoute `json:"compatibility"`
	State                State                `json:"state"`
	CutoverPreconditions []string             `json:"cutoverPreconditions"`
	Rollback             Rollback             `json:"rollback"`
	Security             Security             `json:"security"`
}

func LoadConnectorRuntimeV1() (Contract, error) {
	var contract Contract
	if err := json.Unmarshal(connectorRuntimeV1, &contract); err != nil {
		return Contract{}, fmt.Errorf("decode connector runtime migration contract: %w", err)
	}
	return contract, nil
}
