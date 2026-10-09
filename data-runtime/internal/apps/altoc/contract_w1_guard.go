package altoc

import (
	"net/http"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// W1 guards read the already locked row map. Before the W1 columns exist the
// keys are absent, so every guard is inert and the previous behavior remains.

func ensureContractLinesUnlocked(contract map[string]any) error {
	if altocMapText(contract, "amount_basis") == "header" {
		return httperror.New(http.StatusConflict, "altoc_contract_header_lines_locked", "contract amount is recorded on the header; lines cannot be changed")
	}
	return nil
}

func ensureContractNotHistorical(contract map[string]any) error {
	if altocMapText(contract, "origin_type") == "historical_import" {
		return httperror.New(http.StatusConflict, "altoc_contract_historical_operation_denied", "operation is not available for an imported historical contract")
	}
	return nil
}
