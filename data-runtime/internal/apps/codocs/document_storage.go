package codocs

// Document storage classification (document asset design DOC-06b).
//
// "git-project" rows are OSS copies of repository documents kept in the
// project-documents bucket. They belong to the project family for filtering
// and are excluded from personal document statistics. Every such decision
// goes through this file so that DOC-06d can move the discriminator from
// doc_type to documents.storage_locator in one place. Until that migration is
// confirmed applied, nothing here may reference the new columns.

const (
	docTypeProject        = "project"
	docTypeRepositoryCopy = "git-project"
)

// isProjectFamilyDocType reports whether a document is a project document,
// including repository copies.
func isProjectFamilyDocType(docType string) bool {
	return docType == docTypeProject || docType == docTypeRepositoryCopy
}

// projectFamilyCondition is the SQL predicate for the project family.
// column is a trusted literal chosen by the caller (for example "d.doc_type").
func projectFamilyCondition(column string) string {
	return column + ` IN ('` + docTypeProject + `', '` + docTypeRepositoryCopy + `')`
}

// notRepositoryCopyCondition excludes repository copies, which are mirrors of
// GitLab content and not documents authored in the platform.
func notRepositoryCopyCondition(column string) string {
	return column + ` <> '` + docTypeRepositoryCopy + `'`
}
