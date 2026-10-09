// Package migrationnamespace exposes only the closed W1 installation names.
// Runtime configuration may validate these names; it cannot query the ledger.
package migrationnamespace

func Tables() []string {
	return []string{"mig_batch", "mig_batch_step", "mig_source_row", "mig_object_map", "mig_identity_map", "mig_exception"}
}
