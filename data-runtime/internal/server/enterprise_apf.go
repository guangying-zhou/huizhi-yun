package server

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseapf"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type apfRoute struct{ domain, operation, channel string }

var enterpriseAPFPaths = map[string]apfRoute{
	"/v1/enterprise/altoc/receivables:page":                   {"altoc", "receivables-page", "user"},
	"/v1/enterprise/altoc/receivables:detail":                 {"altoc", "receivables-detail", "user"},
	"/v1/enterprise/altoc/receivables:aging-summary":          {"altoc", "receivables-aging-summary", "user"},
	"/v1/enterprise/altoc/receivables:set-collection-owner":   {"altoc", "receivables-set-collection-owner", "user"},
	"/v1/enterprise/altoc/receivables:set-due-date":           {"altoc", "receivables-set-due-date", "user"},
	"/v1/enterprise/altoc/receivables:followup-create":        {"altoc", "collection-followup-create", "user"},
	"/v1/enterprise/altoc/pending-dead-letter-actionables":    {"altoc", "pending-dead-letter-actionables", "system"},
	"/v1/enterprise/altoc/dead-letter-actionable-published":   {"altoc", "dead-letter-actionable-published", "system"},
	"/v1/enterprise/altoc/pending-dead-letter-closures":       {"altoc", "pending-dead-letter-closures", "system"},
	"/v1/enterprise/altoc/dead-letter-closure-acknowledged":   {"altoc", "dead-letter-closure-acknowledged", "system"},
	"/v1/enterprise/finance/pending-dead-letter-actionables":  {"finance", "pending-dead-letter-actionables", "system"},
	"/v1/enterprise/finance/dead-letter-actionable-published": {"finance", "dead-letter-actionable-published", "system"},
	"/v1/enterprise/finance/pending-dead-letter-closures":     {"finance", "pending-dead-letter-closures", "system"},
	"/v1/enterprise/finance/dead-letter-closure-acknowledged": {"finance", "dead-letter-closure-acknowledged", "system"},
	"/v1/enterprise/people/pending-dead-letter-actionables":   {"people", "pending-dead-letter-actionables", "system"},
	"/v1/enterprise/people/dead-letter-actionable-published":  {"people", "dead-letter-actionable-published", "system"},
	"/v1/enterprise/people/pending-dead-letter-closures":      {"people", "pending-dead-letter-closures", "system"},
	"/v1/enterprise/people/dead-letter-closure-acknowledged":  {"people", "dead-letter-closure-acknowledged", "system"},
	"/v1/enterprise/altoc/sales-due:scan-due":                 {"altoc", "sales-due:scan-due", "system"},
	"/v1/enterprise/altoc/sales-due:published":                {"altoc", "sales-due:published", "system"},
	"/v1/enterprise/altoc/sales-due:closure-ack":              {"altoc", "sales-due:closure-ack", "system"},
	"/v1/enterprise/altoc/billing-due:scan-due":               {"altoc", "billing-due:scan-due", "system"},
	"/v1/enterprise/altoc/billing-due:published":              {"altoc", "billing-due:published", "system"},
	"/v1/enterprise/altoc/billing-due:closure-ack":            {"altoc", "billing-due:closure-ack", "system"},
	"/v1/enterprise/finance/issuance-due:scan-due":            {"finance", "issuance-due:scan-due", "system"},
	"/v1/enterprise/finance/issuance-due:published":           {"finance", "issuance-due:published", "system"},
	"/v1/enterprise/finance/issuance-due:closure-ack":         {"finance", "issuance-due:closure-ack", "system"},
	"/v1/enterprise/finance/reconciliation-due:scan-due":      {"finance", "reconciliation-due:scan-due", "system"},
	"/v1/enterprise/finance/reconciliation-due:published":     {"finance", "reconciliation-due:published", "system"},
	"/v1/enterprise/finance/reconciliation-due:closure-ack":   {"finance", "reconciliation-due:closure-ack", "system"},
	"/v1/enterprise/people/handover-due:scan-due":             {"people", "handover-due:scan-due", "system"},
	"/v1/enterprise/people/handover-due:published":            {"people", "handover-due:published", "system"},
	"/v1/enterprise/people/handover-due:closure-ack":          {"people", "handover-due:closure-ack", "system"},
	"/v1/enterprise/people/asset-recovery-due:scan-due":       {"people", "asset-recovery-due:scan-due", "system"},
	"/v1/enterprise/people/asset-recovery-due:published":      {"people", "asset-recovery-due:published", "system"},
	"/v1/enterprise/people/asset-recovery-due:closure-ack":    {"people", "asset-recovery-due:closure-ack", "system"},

	"/v1/enterprise/altoc/customer-service-finance-summary": {"altoc", "customer-service-finance-summary", "user"},
	"/v1/enterprise/altoc/service-cost-summary-view":        {"altoc", "service-cost-summary-view", "user"},
	"/v1/enterprise/altoc/product-feedback-view":            {"altoc", "product-feedback-view", "user"},
	"/v1/enterprise/altoc/product-feedback-submit":          {"altoc", "product-feedback-submit", "user"},
	"/v1/enterprise/altoc/product-feedback-resume":          {"altoc", "product-feedback-resume", "user"},
	"/v1/enterprise/altoc/product-feedback-status":          {"altoc", "product-feedback-status", "system"},
	"/v1/enterprise/altoc/product-feedback-progress":        {"altoc", "product-feedback-progress", "system"},

	"/v1/enterprise/altoc/customer-assets-summary":         {"altoc", "customer-assets-summary", "user"},
	"/v1/enterprise/altoc/customer-documents-page":         {"altoc", "customer-documents-page", "user"},
	"/v1/enterprise/altoc/service-ticket-knowledge-link":   {"altoc", "service-ticket-knowledge-link", "user"},
	"/v1/enterprise/altoc/service-ticket-knowledge-resume": {"altoc", "service-ticket-knowledge-resume", "user"},
	"/v1/enterprise/altoc/service-ticket-knowledge-view":   {"altoc", "service-ticket-knowledge-view", "user"},

	"/v1/enterprise/finance/project-accounting:page":          {"finance", "project-accounting-page", "user"},
	"/v1/enterprise/finance/project-accounting:view":          {"finance", "project-accounting-view", "user"},
	"/v1/enterprise/finance/project-labor:preview":            {"finance", "project-labor-preview", "user"},
	"/v1/enterprise/finance/project-labor:recalculate":        {"finance", "project-labor-recalculate", "user"},
	"/v1/enterprise/finance/project-labor:history-page":       {"finance", "project-labor-history-page", "user"},
	"/v1/enterprise/finance/project-labor:history-view":       {"finance", "project-labor-history-view", "user"},
	"/v1/enterprise/finance/project-cost-allocations:page":    {"finance", "project-cost-allocations-page", "user"},
	"/v1/enterprise/finance/project-cost-allocations:view":    {"finance", "project-cost-allocations-view", "user"},
	"/v1/enterprise/finance/employee-costs:page":              {"finance", "employee-costs-page", "user"},
	"/v1/enterprise/finance/employee-costs:view":              {"finance", "employee-costs-view", "user"},
	"/v1/enterprise/finance/project-cost-period:view":         {"finance", "project-cost-period-view", "user"},
	"/v1/enterprise/finance/project-cost-period:confirm-zero": {"finance", "project-cost-period-confirm-zero", "user"},
	"/v1/enterprise/finance/project-cost-period:close":        {"finance", "project-cost-period-close", "user"},

	"/v1/enterprise/altoc/renewals:page":                  {"altoc", "renewals-page", "user"},
	"/v1/enterprise/altoc/renewals:view":                  {"altoc", "renewals-view", "user"},
	"/v1/enterprise/altoc/renewals:create":                {"altoc", "renewals-create", "user"},
	"/v1/enterprise/altoc/renewals:update":                {"altoc", "renewals-update", "user"},
	"/v1/enterprise/altoc/service-tickets:page":           {"altoc", "service-tickets-page", "user"},
	"/v1/enterprise/altoc/service-tickets:view":           {"altoc", "service-tickets-view", "user"},
	"/v1/enterprise/altoc/service-tickets:create":         {"altoc", "service-tickets-create", "user"},
	"/v1/enterprise/altoc/service-tickets:update":         {"altoc", "service-tickets-update", "user"},
	"/v1/enterprise/altoc/service-tickets:close":          {"altoc", "service-tickets-close", "user"},
	"/v1/enterprise/altoc/service-tickets:reopen":         {"altoc", "service-tickets-reopen", "user"},
	"/v1/enterprise/altoc/service-ticket:dispatch":        {"altoc", "service-ticket-dispatch", "user"},
	"/v1/enterprise/altoc/service-ticket:dispatch-resume": {"altoc", "service-ticket-dispatch-resume", "user"},
	"/v1/enterprise/altoc/service-ticket:dispatch-view":   {"altoc", "service-ticket-dispatch-view", "user"},

	"/v1/enterprise/altoc/service-agreements:page":      {"altoc", "service-agreements-page", "user"},
	"/v1/enterprise/altoc/service-agreements:view":      {"altoc", "service-agreements-view", "user"},
	"/v1/enterprise/altoc/service-agreements:create":    {"altoc", "service-agreements-create", "user"},
	"/v1/enterprise/altoc/service-agreements:update":    {"altoc", "service-agreements-update", "user"},
	"/v1/enterprise/altoc/service-coverages:page":       {"altoc", "service-coverages-page", "user"},
	"/v1/enterprise/altoc/service-coverages:create":     {"altoc", "service-coverages-create", "user"},
	"/v1/enterprise/altoc/service-coverages:resolve":    {"altoc", "service-coverages-resolve", "user"},
	"/v1/enterprise/altoc/service-coverages:suspend":    {"altoc", "service-coverages-suspend", "user"},
	"/v1/enterprise/altoc/service-coverages:end":        {"altoc", "service-coverages-end", "user"},
	"/v1/enterprise/altoc/service-projects:page":        {"altoc", "service-projects-page", "user"},
	"/v1/enterprise/altoc/service-projects:bind":        {"altoc", "service-projects-bind", "user"},
	"/v1/enterprise/altoc/service-projects:set-default": {"altoc", "service-projects-set-default", "user"},
	"/v1/enterprise/altoc/service-projects:suspend":     {"altoc", "service-projects-suspend", "user"},
	"/v1/enterprise/altoc/service-projects:end":         {"altoc", "service-projects-end", "user"},

	"/v1/enterprise/altoc/tenders:page":             {"altoc", "tenders-page", "user"},
	"/v1/enterprise/altoc/tenders:view":             {"altoc", "tenders-view", "user"},
	"/v1/enterprise/altoc/tenders:create":           {"altoc", "tenders-create", "user"},
	"/v1/enterprise/altoc/tenders:update":           {"altoc", "tenders-update", "user"},
	"/v1/enterprise/altoc/tender-agencies:page":     {"altoc", "tender-agencies-page", "user"},
	"/v1/enterprise/altoc/tender-agencies:create":   {"altoc", "tender-agencies-create", "user"},
	"/v1/enterprise/altoc/tender-members:add":       {"altoc", "tender-members-add", "user"},
	"/v1/enterprise/altoc/tender-members:remove":    {"altoc", "tender-members-remove", "user"},
	"/v1/enterprise/altoc/tender-milestones:create": {"altoc", "tender-milestones-create", "user"},
	"/v1/enterprise/altoc/tender-milestones:update": {"altoc", "tender-milestones-update", "user"},

	"/v1/enterprise/people/assignment-approval:pending":     {"people", "assignment-approval-pending", "system"},
	"/v1/enterprise/people/assignment-approval:bind":        {"people", "assignment-approval-bind", "system"},
	"/v1/enterprise/altoc/lead-activities:list":             {"altoc", "lead-activities-list", "user"},
	"/v1/enterprise/altoc/opportunity-activities:list":      {"altoc", "opportunity-activities-list", "user"},
	"/v1/enterprise/altoc/opportunity-contact-roles:list":   {"altoc", "opportunity-contact-roles-list", "user"},
	"/v1/enterprise/altoc/opportunity-contact-roles:create": {"altoc", "opportunity-contact-roles-create", "user"},
	"/v1/enterprise/altoc/opportunity-contact-roles:update": {"altoc", "opportunity-contact-roles-update", "user"},
	"/v1/enterprise/altoc/opportunity-contact-roles:delete": {"altoc", "opportunity-contact-roles-delete", "user"},
	"/v1/enterprise/altoc/opportunity-stages:list":          {"altoc", "opportunity-stages-list", "user"},
	"/v1/enterprise/altoc/opportunity-stage-history:list":   {"altoc", "opportunity-stage-history-list", "user"},
	"/v1/enterprise/altoc/lead-documents:list":              {"altoc", "lead-documents-list", "user"},
	"/v1/enterprise/altoc/lead-documents:create":            {"altoc", "lead-documents-create", "user"},
	"/v1/enterprise/altoc/lead-documents:delete":            {"altoc", "lead-documents-delete", "user"},
	"/v1/enterprise/altoc/opportunity-documents:list":       {"altoc", "opportunity-documents-list", "user"},
	"/v1/enterprise/altoc/opportunity-documents:create":     {"altoc", "opportunity-documents-create", "user"},
	"/v1/enterprise/altoc/opportunity-documents:delete":     {"altoc", "opportunity-documents-delete", "user"},

	"/v1/enterprise/finance/payment-requests:page":     {"finance", "payment-requests-page", "user"},
	"/v1/enterprise/finance/payment-requests:detail":   {"finance", "payment-requests-detail", "user"},
	"/v1/enterprise/finance/payment-requests:create":   {"finance", "payment-requests-create", "user"},
	"/v1/enterprise/finance/payment-requests:update":   {"finance", "payment-requests-update", "user"},
	"/v1/enterprise/finance/payment-requests:cancel":   {"finance", "payment-requests-cancel", "user"},
	"/v1/enterprise/finance/payment-requests:submit":   {"finance", "payment-requests-submit", "user"},
	"/v1/enterprise/finance/payment-requests:confirm":  {"finance", "payment-requests-confirm", "user"},
	"/v1/enterprise/finance/expense-types:page":        {"finance", "expense-types-page", "user"},
	"/v1/enterprise/finance/expense-types:create":      {"finance", "expense-types-create", "user"},
	"/v1/enterprise/finance/expense-types:update":      {"finance", "expense-types-update", "user"},
	"/v1/enterprise/finance/income-types:page":         {"finance", "income-types-page", "user"},
	"/v1/enterprise/finance/income-types:create":       {"finance", "income-types-create", "user"},
	"/v1/enterprise/finance/income-types:update":       {"finance", "income-types-update", "user"},
	"/v1/enterprise/finance/subjects:page":             {"finance", "subjects-page", "user"},
	"/v1/enterprise/finance/subjects:create":           {"finance", "subjects-create", "user"},
	"/v1/enterprise/finance/subjects:update":           {"finance", "subjects-update", "user"},
	"/v1/enterprise/finance/subject-mappings:page":     {"finance", "subject-mappings-page", "user"},
	"/v1/enterprise/finance/subject-mappings:create":   {"finance", "subject-mappings-create", "user"},
	"/v1/enterprise/finance/subject-mappings:update":   {"finance", "subject-mappings-update", "user"},
	"/v1/enterprise/finance/accounting-objects:page":   {"finance", "accounting-objects-page", "user"},
	"/v1/enterprise/finance/accounting-objects:create": {"finance", "accounting-objects-create", "user"},
	"/v1/enterprise/finance/accounting-objects:update": {"finance", "accounting-objects-update", "user"},
	"/v1/enterprise/finance/audit-logs:page":           {"finance", "audit-logs-page", "user"},
	"/v1/enterprise/finance/approval-instances:page":   {"finance", "approval-instances-page", "user"},

	"/v1/enterprise/altoc/leads:create":                  {"altoc", "leads-create", "user"},
	"/v1/enterprise/altoc/leads:update":                  {"altoc", "leads-update", "user"},
	"/v1/enterprise/altoc/leads:assign":                  {"altoc", "leads-assign", "user"},
	"/v1/enterprise/altoc/leads:disqualify":              {"altoc", "leads-disqualify", "user"},
	"/v1/enterprise/altoc/leads:convert":                 {"altoc", "leads-convert", "user"},
	"/v1/enterprise/altoc/lead-activities:create":        {"altoc", "lead-activities-create", "user"},
	"/v1/enterprise/altoc/opportunities:create":          {"altoc", "opportunities-create", "user"},
	"/v1/enterprise/altoc/opportunities:update":          {"altoc", "opportunities-update", "user"},
	"/v1/enterprise/altoc/opportunities:assign":          {"altoc", "opportunities-assign", "user"},
	"/v1/enterprise/altoc/opportunities:transition":      {"altoc", "opportunities-transition", "user"},
	"/v1/enterprise/altoc/opportunities:close-won":       {"altoc", "opportunities-close-won", "user"},
	"/v1/enterprise/altoc/opportunities:close-lost":      {"altoc", "opportunities-close-lost", "user"},
	"/v1/enterprise/altoc/opportunities:pause":           {"altoc", "opportunities-pause", "user"},
	"/v1/enterprise/altoc/opportunities:reopen":          {"altoc", "opportunities-reopen", "user"},
	"/v1/enterprise/altoc/opportunity-activities:create": {"altoc", "opportunity-activities-create", "user"},

	"/v1/enterprise/finance/expenses:page":                {"finance", "expenses-page", "user"},
	"/v1/enterprise/finance/expenses:detail":              {"finance", "expenses-detail", "user"},
	"/v1/enterprise/finance/expenses:create":              {"finance", "expenses-create", "user"},
	"/v1/enterprise/finance/expenses:update":              {"finance", "expenses-update", "user"},
	"/v1/enterprise/finance/expenses:delete":              {"finance", "expenses-delete", "user"},
	"/v1/enterprise/finance/expenses:confirm":             {"finance", "expenses-confirm", "user"},
	"/v1/enterprise/finance/claims:page":                  {"finance", "claims-page", "user"},
	"/v1/enterprise/finance/claims:detail":                {"finance", "claims-detail", "user"},
	"/v1/enterprise/finance/claims:create":                {"finance", "claims-create", "user"},
	"/v1/enterprise/finance/claims:update":                {"finance", "claims-update", "user"},
	"/v1/enterprise/finance/claims:cancel":                {"finance", "claims-cancel", "user"},
	"/v1/enterprise/finance/claims:submit":                {"finance", "claims-submit", "user"},
	"/v1/enterprise/finance/claims:confirm":               {"finance", "claims-confirm", "user"},
	"/v1/enterprise/finance/project-requests:page":        {"finance", "project-requests-page", "user"},
	"/v1/enterprise/finance/project-requests:detail":      {"finance", "project-requests-detail", "user"},
	"/v1/enterprise/finance/project-requests:create":      {"finance", "project-requests-create", "user"},
	"/v1/enterprise/finance/project-requests:update":      {"finance", "project-requests-update", "user"},
	"/v1/enterprise/finance/project-requests:cancel":      {"finance", "project-requests-cancel", "user"},
	"/v1/enterprise/finance/project-requests:submit":      {"finance", "project-requests-submit", "user"},
	"/v1/enterprise/finance/project-requests:confirm":     {"finance", "project-requests-confirm", "user"},
	"/v1/enterprise/finance/invoice-approval:request":     {"finance", "invoice-approval-request", "user"},
	"/v1/enterprise/finance/invoice-approval:bind":        {"finance", "invoice-approval-bind", "user"},
	"/v1/enterprise/finance/invoice-approval:callback":    {"finance", "invoice-approval-callback", "system"},
	"/v1/enterprise/finance/invoice-approval:pending":     {"finance", "invoice-approval-pending", "system"},
	"/v1/enterprise/finance/invoice-approval:bind-system": {"finance", "invoice-approval-bind-system", "system"},
	"/v1/enterprise/finance/invoice-requests:from-altoc":  {"finance", "invoice-requests-from-altoc", "user"},

	"/v1/enterprise/finance/invoice-requests:page":            {"finance", "invoice-requests-page", "user"},
	"/v1/enterprise/finance/invoice-requests:detail":          {"finance", "invoice-requests-detail", "user"},
	"/v1/enterprise/finance/invoice-requests:create":          {"finance", "invoice-requests-create", "user"},
	"/v1/enterprise/finance/invoice-requests:update":          {"finance", "invoice-requests-update", "user"},
	"/v1/enterprise/finance/invoice-requests:assign-issuance": {"finance", "invoice-requests-assign-issuance", "user"},
	"/v1/enterprise/finance/invoice-requests:issue":           {"finance", "invoice-requests-issue", "user"},
	"/v1/enterprise/finance/invoices:page":                    {"finance", "invoices-page", "user"},
	"/v1/enterprise/finance/invoices:detail":                  {"finance", "invoices-detail", "user"},
	"/v1/enterprise/finance/invoices:update":                  {"finance", "invoices-update", "user"},
	"/v1/enterprise/finance/invoices:void":                    {"finance", "invoices-void", "user"},
	"/v1/enterprise/finance/invoices:red-reverse":             {"finance", "invoices-red-reverse", "user"},
	"/v1/enterprise/finance/receipts:page":                    {"finance", "receipts-page", "user"},
	"/v1/enterprise/finance/receipts:detail":                  {"finance", "receipts-detail", "user"},
	"/v1/enterprise/finance/receipts:create":                  {"finance", "receipts-create", "user"},
	"/v1/enterprise/finance/receipts:update":                  {"finance", "receipts-update", "user"},
	"/v1/enterprise/finance/receipts:confirm":                 {"finance", "receipts-confirm", "user"},
	"/v1/enterprise/finance/receipts:classify":                {"finance", "receipts-classify", "user"},
	"/v1/enterprise/finance/receipts:delete":                  {"finance", "receipts-delete", "user"},
	"/v1/enterprise/finance/reconciliation:page":              {"finance", "reconciliation-page", "user"},
	"/v1/enterprise/finance/historical-finance:page":          {"finance", "historical-finance-page", "user"},
	"/v1/enterprise/finance/historical-finance:preview":       {"finance", "historical-finance-preview", "user"},
	"/v1/enterprise/finance/historical-finance:activate":      {"finance", "historical-finance-activate", "user"},
	"/v1/enterprise/finance/historical-finance:history-page":  {"finance", "historical-finance-history-page", "user"},
	"/v1/enterprise/finance/allocation:candidates":            {"finance", "allocation-candidates", "user"},
	"/v1/enterprise/finance/allocation-batches:page":          {"finance", "allocation-batches-page", "user"},
	"/v1/enterprise/finance/allocation-batches:detail":        {"finance", "allocation-batches-detail", "user"},
	"/v1/enterprise/finance/reconciliation:allocate-batch":    {"finance", "reconciliation-allocate-batch", "user"},
	"/v1/enterprise/finance/allocation-batches:reverse":       {"finance", "allocation-batches-reverse", "user"},
	"/v1/enterprise/finance/receivable-adjustments:page":      {"finance", "receivable-adjustments-page", "user"},
	"/v1/enterprise/finance/receivable-adjustments:detail":    {"finance", "receivable-adjustments-detail", "user"},
	"/v1/enterprise/finance/receivable-adjustments:create":    {"finance", "receivable-adjustments-create", "user"},
	"/v1/enterprise/finance/receivable-adjustments:confirm":   {"finance", "receivable-adjustments-confirm", "user"},
	"/v1/enterprise/finance/receivable-adjustments:reverse":   {"finance", "receivable-adjustments-reverse", "user"},
	"/v1/enterprise/finance/reconciliation:create":            {"finance", "reconciliation-create", "user"},
	"/v1/enterprise/finance/reconciliation:void":              {"finance", "reconciliation-void", "user"},
	"/v1/enterprise/finance/invoice-files:attach":             {"finance", "invoice-files-attach", "user"},
	"/v1/enterprise/finance/invoice-files:read":               {"finance", "invoice-files-read", "user"},

	"/v1/enterprise/altoc/quotation-approval:request": {"altoc", "quotation-approval-request", "user"},
	"/v1/enterprise/altoc/quotation-approval:bind":    {"altoc", "quotation-approval-bind", "user"},
	"/v1/enterprise/altoc/contract-approval:request":  {"altoc", "contract-approval-request", "user"},
	"/v1/enterprise/altoc/contract-approval:bind":     {"altoc", "contract-approval-bind", "user"},
	"/v1/enterprise/altoc/approval:callback":          {"altoc", "approval-callback", "system"},
	"/v1/enterprise/altoc/approval:pending":           {"altoc", "approval-pending", "system"},
	"/v1/enterprise/altoc/approval:bind":              {"altoc", "approval-bind", "system"},
	"/v1/enterprise/altoc/contracts:create":           {"altoc", "contracts-create", "user"},
	"/v1/enterprise/altoc/contracts-from:quotation":   {"altoc", "contracts-from-quotation", "user"},
	"/v1/enterprise/altoc/contracts:update":           {"altoc", "contracts-update", "user"},
	"/v1/enterprise/altoc/contract-lines:replace":     {"altoc", "contract-lines-replace", "user"},
	"/v1/enterprise/altoc/payment-terms:replace":      {"altoc", "payment-terms-replace", "user"},
	"/v1/enterprise/altoc/obligations:replace":        {"altoc", "obligations-replace", "user"},
	"/v1/enterprise/altoc/obligations:transition":     {"altoc", "obligations-transition", "user"},
	"/v1/enterprise/altoc/billing-schedules:list":     {"altoc", "billing-schedules-list", "user"},
	"/v1/enterprise/altoc/contracts:sign":             {"altoc", "contracts-sign", "user"},
	"/v1/enterprise/altoc/contracts:annotate":         {"altoc", "contracts-annotate", "user"},
	"/v1/enterprise/altoc/contracts:set-owner":        {"altoc", "contracts-set-owner", "user"},
	"/v1/enterprise/altoc/contracts:complete":         {"altoc", "contracts-complete", "user"},
	"/v1/enterprise/altoc/contracts:terminate":        {"altoc", "contracts-terminate", "user"},
	"/v1/enterprise/altoc/contracts:activate":         {"altoc", "contracts-activate", "user"},
	"/v1/enterprise/altoc/contract-projects:bind":     {"altoc", "contract-projects-bind", "user"},
	"/v1/enterprise/altoc/contract-projects:list":     {"altoc", "contract-projects-list", "user"},

	"/v1/enterprise/altoc/quotations:create":       {"altoc", "quotations-create", "user"},
	"/v1/enterprise/altoc/quotations:update":       {"altoc", "quotations-update", "user"},
	"/v1/enterprise/altoc/quotation-items:replace": {"altoc", "quotation-items-replace", "user"},
	"/v1/enterprise/altoc/quotation-versions:list": {"altoc", "quotation-versions-list", "user"},
	"/v1/enterprise/altoc/quotation-versions:view": {"altoc", "quotation-versions-view", "user"},
	"/v1/enterprise/altoc/quotations:transition":   {"altoc", "quotations-transition", "user"},

	"/v1/enterprise/altoc/customers:create":                   {"altoc", "customers-create", "user"},
	"/v1/enterprise/altoc/customers:update":                   {"altoc", "customers-update", "user"},
	"/v1/enterprise/altoc/customers:set-owner":                {"altoc", "customers-set-owner", "user"},
	"/v1/enterprise/altoc/customers:set-parent":               {"altoc", "customers-set-parent", "user"},
	"/v1/enterprise/altoc/customers:set-primary-contact":      {"altoc", "customers-set-primary-contact", "user"},
	"/v1/enterprise/altoc/contacts:create":                    {"altoc", "contacts-create", "user"},
	"/v1/enterprise/altoc/contacts:update":                    {"altoc", "contacts-update", "user"},
	"/v1/enterprise/altoc/contacts:delete":                    {"altoc", "contacts-delete", "user"},
	"/v1/enterprise/altoc/invoice-profiles:create":            {"altoc", "invoice-profiles-create", "user"},
	"/v1/enterprise/altoc/invoice-profiles:update":            {"altoc", "invoice-profiles-update", "user"},
	"/v1/enterprise/altoc/invoice-profiles:delete":            {"altoc", "invoice-profiles-delete", "user"},
	"/v1/enterprise/altoc/invoice-profiles:set-default":       {"altoc", "invoice-profiles-set-default", "user"},
	"/v1/enterprise/finance/bank-accounts:page":               {"finance", "accounts-list", "user"},
	"/v1/enterprise/finance/bank-accounts:detail":             {"finance", "accounts-view", "user"},
	"/v1/enterprise/finance/bank-accounts:create":             {"finance", "accounts-create", "user"},
	"/v1/enterprise/finance/bank-accounts:update":             {"finance", "accounts-update", "user"},
	"/v1/enterprise/finance/bank-accounts:reveal-account-no":  {"finance", "accounts-reveal-account-no", "user"},
	"/v1/enterprise/finance/balance-entries:list":             {"finance", "balance-entries-list", "user"},
	"/v1/enterprise/finance/balance-entries:create":           {"finance", "balance-entries-create", "user"},
	"/v1/enterprise/finance/balance-snapshots:list":           {"finance", "balances-list", "user"},
	"/v1/enterprise/altoc/migration-exceptions:page":          {"altoc", "migration-exceptions-page", "user"},
	"/v1/enterprise/altoc/migration-identities:page":          {"altoc", "migration-identities-page", "user"},
	"/v1/enterprise/altoc/migration-exceptions:resolve":       {"altoc", "migration-exceptions-resolve", "user"},
	"/v1/enterprise/altoc/migration-identities:confirm":       {"altoc", "migration-identities-confirm", "user"},
	"/v1/enterprise/altoc/migration-identities:reject":        {"altoc", "migration-identities-reject", "user"},
	"/v1/enterprise/altoc/migration-identities:apply":         {"altoc", "migration-identities-apply", "user"},
	"/v1/enterprise/finance/migration-exceptions:resolve":     {"finance", "migration-exceptions-resolve", "user"},
	"/v1/enterprise/finance/migration-exceptions:page":        {"finance", "migration-exceptions-page", "user"},
	"/v1/enterprise/finance/legal-entities:list":              {"finance", "legal-entities-list", "user"},
	"/v1/enterprise/finance/legal-entities:view":              {"finance", "legal-entities-view", "user"},
	"/v1/enterprise/finance/legal-entities:create":            {"finance", "legal-entities-create", "user"},
	"/v1/enterprise/finance/legal-entities:update":            {"finance", "legal-entities-update", "user"},
	"/v1/enterprise/finance/people-cost-parameters:list":      {"finance", "parameters-list", "user"},
	"/v1/enterprise/finance/people-cost-parameters:view":      {"finance", "parameters-view", "user"},
	"/v1/enterprise/finance/people-cost-parameters:create":    {"finance", "parameters-create", "user"},
	"/v1/enterprise/finance/people-cost-parameters:update":    {"finance", "parameters-update", "user"},
	"/v1/enterprise/finance/people-cost-parameters:history":   {"finance", "parameters-history", "user"},
	"/v1/enterprise/altoc/apf-customers:list":                 {"altoc", "list", "user"},
	"/v1/enterprise/altoc/apf-customers:view":                 {"altoc", "view", "user"},
	"/v1/enterprise/altoc/apf-customers:save":                 {"altoc", "save", "user"},
	"/v1/enterprise/finance/bank-accounts:list":               {"finance", "list", "user"},
	"/v1/enterprise/finance/bank-accounts:view":               {"finance", "view", "user"},
	"/v1/enterprise/finance/bank-accounts:save":               {"finance", "save", "user"},
	"/v1/enterprise/people/employees-private-profiles:view":   {"people", "employees-private-view", "user"},
	"/v1/enterprise/people/employees-private-profiles:update": {"people", "employees-private-update", "user"},
	"/v1/enterprise/people/positions:create":                  {"people", "positions-create", "user"},
	"/v1/enterprise/people/positions:update":                  {"people", "positions-update", "user"},
	"/v1/enterprise/people/positions:delete":                  {"people", "positions-delete", "user"},
	"/v1/enterprise/people/ranks:list":                        {"people", "ranks-list", "user"},
	"/v1/enterprise/people/ranks:view":                        {"people", "ranks-view", "user"},
	"/v1/enterprise/people/ranks:create":                      {"people", "ranks-create", "user"},
	"/v1/enterprise/people/ranks:update":                      {"people", "ranks-update", "user"},
	"/v1/enterprise/people/ranks:delete":                      {"people", "ranks-delete", "user"},
	"/v1/enterprise/people/standard-costs:list":               {"people", "standard-costs-list", "user"},
	"/v1/enterprise/people/standard-costs:view":               {"people", "standard-costs-view", "user"},
	"/v1/enterprise/people/standard-costs:create":             {"people", "standard-costs-create", "user"},
	"/v1/enterprise/people/standard-costs:update":             {"people", "standard-costs-update", "user"},
	"/v1/enterprise/people/employees:search":                  {"people", "employees-search", "user"},
	"/v1/enterprise/people/employees:profile":                 {"people", "employees-profile", "user"},
	"/v1/enterprise/people/assignments:list":                  {"people", "assignments-list", "user"},
	"/v1/enterprise/people/assignments:view":                  {"people", "assignments-view", "user"},
	"/v1/enterprise/people/positions:list":                    {"people", "list", "user"},
	"/v1/enterprise/people/positions:view":                    {"people", "view", "user"},
	"/v1/enterprise/altoc/scheduler:inspect":                  {"altoc", "inspect", "system"},
	"/v1/enterprise/finance/scheduler:inspect":                {"finance", "inspect", "system"},
	"/v1/enterprise/people/scheduler:inspect":                 {"people", "inspect", "system"},
	"/v1/altoc/notification-details/authorize":                {"altoc", "view", "purpose"},
	"/v1/finance/notification-details/authorize":              {"finance", "view", "purpose"},
	"/v1/people/notification-details/authorize":               {"people", "view", "purpose"},
}

type apfPermit struct {
	CostScope      *enterpriseapf.CostScope `json:"costScope,omitempty"`
	ActorUID       string                   `json:"actorUid"`
	Tenant         string                   `json:"tenant"`
	Deployment     string                   `json:"deployment"`
	Resource       string                   `json:"resource"`
	Action         string                   `json:"action"`
	Operation      string                   `json:"operation"`
	ObjectID       string                   `json:"objectId"`
	Allowed        bool                     `json:"allowed"`
	ExpiresAt      int64                    `json:"expiresAt"`
	BundleVersion  string                   `json:"bundleVersion"`
	BundleHash     string                   `json:"bundleHash"`
	PolicyRevision *int64                   `json:"policyRevision"`
	Scope          altoc.BasicReadScope     `json:"scope"`
}
type apfInput struct {
	Cost     *enterpriseapf.CostInput     `json:"cost,omitempty"`
	Sales    *enterpriseapf.SalesInput    `json:"sales,omitempty"`
	People   *enterpriseapf.PeopleInput   `json:"people,omitempty"`
	Contract *enterpriseapf.ContractInput `json:"contract,omitempty"`
	enterpriseapf.Input
	Authorization apfPermit                     `json:"authorization"`
	Quotation     *enterpriseapf.QuotationInput `json:"quotation,omitempty"`
	Customer      *enterpriseapf.CustomerInput  `json:"customer,omitempty"`
	Finance       *enterpriseapf.FinanceInput   `json:"finance,omitempty"`
	// Migration queue writes (W3).
	MigrationResolve  *enterpriseapf.MigrationResolveInput  `json:"migrationResolve,omitempty"`
	MigrationIdentity *enterpriseapf.MigrationIdentityInput `json:"migrationIdentity,omitempty"`
	MigrationApply    *enterpriseapf.MigrationApplyInput    `json:"migrationApply,omitempty"`
}

func apfPermitCanonical(r *http.Request, i apfInput) string {
	p := i.Authorization
	deps := p.Scope.DepartmentCodes
	if deps == nil {
		deps = []string{}
	}
	fields := []any{"hzy-enterprise-apf-permit.v1", r.Method, r.URL.RequestURI(), p.ActorUID, p.Tenant, p.Deployment, p.Resource, p.Action, p.Operation, p.ObjectID, p.Allowed, p.ExpiresAt, p.BundleVersion, p.BundleHash, p.PolicyRevision, p.Scope.Access, deps, i.ID, i.Code, i.Name, i.RowVersion, i.Page, i.PageSize, i.Search}
	if i.Cost != nil {
		fields = append(fields, enterpriseapf.CostIntent(*i.Cost))
		if p.CostScope != nil {
			c := p.CostScope
			fields = append(fields, []any{c.Access, c.ProjectCodes, c.Salary.Access, c.Salary.DepartmentCodes})
		}
	}
	if i.People != nil {
		fields = append(fields, enterpriseapf.PeopleIntent(*i.People))
	}
	if i.Finance != nil {
		fields = append(fields, enterpriseapf.FinanceIntent(*i.Finance))
	}
	if i.Customer != nil {
		fields = append(fields, enterpriseapf.CustomerIntent(*i.Customer))
	}
	if i.MigrationResolve != nil {
		fields = append(fields, enterpriseapf.MigrationResolveIntent(*i.MigrationResolve))
	}
	if i.MigrationIdentity != nil {
		fields = append(fields, enterpriseapf.MigrationIdentityIntent(*i.MigrationIdentity))
	}
	if i.MigrationApply != nil {
		fields = append(fields, enterpriseapf.MigrationApplyIntent(*i.MigrationApply))
	}
	if i.Quotation != nil {
		fields = append(fields, enterpriseapf.QuotationIntent(*i.Quotation))
	}
	if i.Contract != nil {
		fields = append(fields, enterpriseapf.ContractIntent(*i.Contract))
	}
	if i.Sales != nil {
		fields = append(fields, enterpriseapf.SalesIntent(*i.Sales))
	}
	if i.MigrationQuery != nil {
		fields = append(fields, enterpriseapf.MigrationQueryIntent(i.MigrationQuery))
	}
	return enterpriseAltocPermitFieldsCanonical(fields)
}
func validateAPFPermit(r *http.Request, i apfInput, spec apfRoute, v enterpriseRequestContext, now time.Time) error {
	if i.MigrationQuery != nil && spec.operation != "migration-exceptions-page" {
		return httperror.New(400, "migration_queue_input_invalid", "Query is not applicable")
	}
	p := i.Authorization
	resource, write, _ := enterpriseapf.Resource(spec.domain)
	action := "view"
	if i.Cost != nil {
		resource, action, _ = enterpriseapf.CostPermission(spec.operation)
	}
	if i.Sales != nil {
		resource, action, _ = enterpriseapf.SalesPermission(spec.operation)
		if enterpriseapf.IsSalesSupport(spec.operation) {
			resource, action, _ = enterpriseapf.SalesSupportPermission(spec.operation, *i.Sales)
		}
	}
	if i.Contract != nil {
		resource, action, _ = enterpriseapf.ContractPermission(spec.operation)
	}
	if i.Quotation != nil {
		resource, action, _ = enterpriseapf.QuotationPermission(spec.operation)
	}
	if i.Customer != nil {
		resource, action, _ = enterpriseapf.CustomerPermission(spec.operation)
	}
	if i.Finance != nil {
		resource, action, _ = enterpriseapf.FinanceLedgerInputPermission(spec.operation, *i.Finance)
	}
	if i.People != nil {
		resource, action, _ = enterpriseapf.PeoplePermission(spec.operation)
	}
	if ar, aa, ok := enterpriseapf.ApprovalPermission(spec.operation); ok {
		resource, action = ar, aa
	}
	if mr, ma, ok := enterpriseapf.MigrationQueuePermission(spec.operation); ok {
		resource, action = mr, ma
	}
	if mr, ma, ok := enterpriseapf.MigrationQueueWritePermission(spec.operation); ok {
		resource, action = mr, ma
	}
	if spec.operation == "save" {
		action = write
	}
	if i.Cost == nil && p.CostScope != nil {
		return httperror.New(403, "finance_project_cost_permit_invalid", "Unexpected cost scope")
	}
	if p.ActorUID != v.ActorUID || p.Tenant != v.Route.Binding.Tenant || p.Deployment != v.Route.HostDeployment || p.Resource != resource || p.Action != action || p.Operation != spec.operation || p.ObjectID != func() string {
		if i.Cost != nil {
			return i.Cost.ProjectCode + "|" + i.Cost.PeriodMonth + "|" + i.Cost.Code
		}
		if i.Sales != nil {
			return i.Sales.ID
		}
		if i.People != nil {
			return i.People.ID
		}
		if i.Contract != nil {
			return i.Contract.ID + "|" + i.Contract.CustomerID + "|" + i.Contract.QuotationID
		}
		if i.Quotation != nil {
			return i.Quotation.ID + "|" + i.Quotation.CustomerID + "|" + strconv.Itoa(i.Quotation.Version)
		}
		if i.Customer != nil {
			return i.Customer.CustomerID + "|" + i.Customer.ChildCode
		}
		if i.Finance != nil {
			return i.Finance.Code
		}
		if i.MigrationResolve != nil {
			return i.MigrationResolve.ID
		}
		if i.MigrationIdentity != nil {
			return i.MigrationIdentity.SourceUserID
		}
		if i.MigrationApply != nil {
			return i.MigrationApply.SourceUserID
		}
		return i.ID
	}() || !p.Allowed || p.BundleVersion == "" || p.BundleHash == "" || p.PolicyRevision == nil || *p.PolicyRevision < 0 || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(403, "apf_permit_invalid", "A fresh object permit is required")
	}
	if err := p.Scope.Validate(); err != nil {
		return err
	}
	token, signature := runtimeBearerToken(r), r.Header.Get("X-HZY-Enterprise-APF-Permit-Signature")
	mac := hmac.New(sha256.New, []byte(token))
	mac.Write([]byte(apfPermitCanonical(r, i)))
	if token == "" || signature == "" || !hmac.Equal([]byte(signature), []byte(base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))) {
		return httperror.New(403, "apf_permit_signature_invalid", "Invalid object permit")
	}
	if i.Cost != nil {
		if spec.domain != "finance" || p.CostScope == nil || i.Sales != nil || i.People != nil || i.Contract != nil || i.Quotation != nil || i.Customer != nil || i.Finance != nil || i.ID != "" || i.Code != "" || i.Name != "" || i.RowVersion != 0 || i.Page != 0 || i.PageSize != 0 || i.Search != "" {
			return httperror.New(403, "finance_project_cost_permit_invalid", "Invalid cost permit")
		}
		if e := p.CostScope.Validate(i.Cost.ProjectCode, spec.operation); e != nil {
			return e
		}
		return enterpriseapf.ValidateCostInput(spec.operation, *i.Cost)
	}
	if _, _, ok := enterpriseapf.CostPermission(spec.operation); ok {
		return httperror.New(400, "finance_project_cost_input_invalid", "Cost input required")
	}

	if i.Sales != nil {
		if i.People != nil || i.Contract != nil || i.Customer != nil || i.Quotation != nil || i.Finance != nil || spec.domain != "altoc" || i.ID != "" || i.Code != "" || i.Name != "" || i.RowVersion != 0 || i.Page != 0 || i.PageSize != 0 || i.Search != "" {
			return httperror.New(403, "altoc_sales_permit_invalid", "Invalid sales permit")
		}
		return enterpriseapf.ValidateSalesInput(spec.operation, *i.Sales)
	}
	if _, _, ok := enterpriseapf.SalesPermission(spec.operation); ok {
		return httperror.New(400, "altoc_sales_input_required", "Sales input required")
	}
	if i.People != nil {
		if spec.domain != "people" || i.Contract != nil || i.Customer != nil || i.Quotation != nil || i.Finance != nil || i.ID != "" || i.Code != "" || i.Name != "" || i.RowVersion != 0 || i.Page != 0 || i.PageSize != 0 || i.Search != "" {
			return httperror.New(403, "people_permit_invalid", "Invalid People permit")
		}
		return enterpriseapf.ValidatePeopleInput(spec.operation, *i.People)
	}
	if _, _, ok := enterpriseapf.PeoplePermission(spec.operation); ok {
		return httperror.New(400, "people_input_required", "People input required")
	}
	if i.Contract != nil {
		if i.Customer != nil || i.Quotation != nil || i.Finance != nil || spec.domain != "altoc" || i.ID != "" || i.Code != "" || i.Name != "" || i.RowVersion != 0 || i.Page != 0 || i.PageSize != 0 || i.Search != "" {
			return httperror.New(403, "altoc_contract_permit_invalid", "Invalid contract permit")
		}
		for _, a := range i.Contract.AimsPermits {
			if a.ActorUID != p.ActorUID || a.Tenant != p.Tenant || a.Deployment != p.Deployment || a.BundleVersion != p.BundleVersion || a.BundleHash != p.BundleHash || a.PolicyRevision == nil || *a.PolicyRevision != *p.PolicyRevision {
				return httperror.New(403, "contract_project_permit_invalid", "Invalid project policy facts")
			}
		}
		return enterpriseapf.ValidateContractInput(spec.operation, *i.Contract)
	}
	if _, _, ok := enterpriseapf.ContractPermission(spec.operation); ok {
		return httperror.New(400, "altoc_contract_input_invalid", "Contract input required")
	}
	if i.Quotation != nil {
		if i.Customer != nil || i.Finance != nil || spec.domain != "altoc" || i.ID != "" || i.Code != "" || i.Name != "" || i.RowVersion != 0 || i.Page != 0 || i.PageSize != 0 || i.Search != "" {
			return httperror.New(403, "altoc_quotation_permit_invalid", "Invalid quotation permit")
		}
		return enterpriseapf.ValidateQuotationInput(spec.operation, *i.Quotation)
	}
	if _, _, ok := enterpriseapf.QuotationPermission(spec.operation); ok {
		return httperror.New(400, "altoc_quotation_input_invalid", "Quotation input required")
	}
	if i.Customer != nil {
		if i.Finance != nil || spec.domain != "altoc" || i.ID != "" || i.Code != "" || i.Name != "" || i.RowVersion != 0 || i.Page != 0 || i.PageSize != 0 || i.Search != "" {
			return httperror.New(403, "altoc_customer_permit_invalid", "Invalid customer permit")
		}
		return enterpriseapf.ValidateCustomerInput(spec.operation, *i.Customer)
	}
	if _, _, ok := enterpriseapf.CustomerPermission(spec.operation); ok {
		return httperror.New(400, "altoc_customer_input_invalid", "Customer input required")
	}
	if i.Finance != nil {
		if spec.domain != "finance" || i.ID != "" || i.Code != "" || i.Name != "" || i.RowVersion != 0 || i.Page != 0 || i.PageSize != 0 || i.Search != "" || (p.Scope.Access != "all" && (p.Scope.Access != "self" || !func() bool {
			_, _, ok := enterpriseapf.FinanceLedgerPermission(spec.operation)
			_, _, approval := enterpriseapf.FinanceApprovalPermission(spec.operation)
			return ok || approval
		}())) || len(p.Scope.DepartmentCodes) != 0 {
			return httperror.New(403, "finance_permit_invalid", "Invalid Finance permit")
		}
		return enterpriseapf.ValidateFinanceInput(spec.operation, *i.Finance)
	}
	if strings.HasPrefix(spec.operation, "accounts-") || strings.HasPrefix(spec.operation, "parameters-") || spec.operation == "balances-list" {
		return httperror.New(400, "finance_input_invalid", "Finance input required")
	}
	if _, _, ok := enterpriseapf.ApprovalPermission(spec.operation); ok {
		return enterpriseapf.ValidateApprovalInput(spec.operation, i.Input)
	}
	if _, _, ok := enterpriseapf.MigrationQueueWritePermission(spec.operation); ok {
		// Exactly one queue command, nothing else, and an unrestricted scope.
		if i.Cost != nil || i.Sales != nil || i.People != nil || i.Contract != nil || i.Quotation != nil || i.Customer != nil || i.Finance != nil || i.ID != "" || i.Code != "" || i.Name != "" || i.RowVersion != 0 || i.Page != 0 || i.PageSize != 0 || i.Search != "" || p.Scope.Access != "all" || len(p.Scope.DepartmentCodes) != 0 {
			return httperror.New(403, "migration_queue_permit_invalid", "Invalid migration queue permit")
		}
		if spec.operation == "migration-exceptions-resolve" {
			if i.MigrationResolve == nil || i.MigrationIdentity != nil || i.MigrationApply != nil {
				return httperror.New(400, "migration_queue_input_invalid", "Queue command required")
			}
			return enterpriseapf.ValidateMigrationResolveInput(spec.domain, *i.MigrationResolve)
		}
		if spec.operation == "migration-identities-apply" {
			if i.MigrationApply == nil || i.MigrationResolve != nil || i.MigrationIdentity != nil || spec.domain != "altoc" {
				return httperror.New(400, "migration_queue_input_invalid", "Queue command required")
			}
			return enterpriseapf.ValidateMigrationApplyInput(*i.MigrationApply)
		}
		if i.MigrationIdentity == nil || i.MigrationResolve != nil || i.MigrationApply != nil || spec.domain != "altoc" {
			return httperror.New(400, "migration_queue_input_invalid", "Queue command required")
		}
		return enterpriseapf.ValidateMigrationIdentityInput(spec.operation, *i.MigrationIdentity)
	}
	if i.MigrationResolve != nil || i.MigrationIdentity != nil || i.MigrationApply != nil {
		return httperror.New(400, "migration_queue_input_invalid", "Unexpected queue command")
	}
	if _, _, ok := enterpriseapf.MigrationQueuePermission(spec.operation); ok {
		// The queue spans objects no single owner or department holds, so only
		// an unrestricted scope may read it. The query rides in the signed
		// generic fields: code = kind, name = status.
		if i.RowVersion != 0 || p.Scope.Access != "all" || len(p.Scope.DepartmentCodes) != 0 {
			return httperror.New(403, "migration_queue_permit_invalid", "Invalid migration queue permit")
		}
		return enterpriseapf.ValidateMigrationQueueInput(spec.domain, spec.operation, migrationQueueInput(i.Input))
	}
	return enterpriseapf.ValidateInput(spec.domain, spec.operation, i.Input)
}
func (s *Server) routeEnterpriseAPF(r *http.Request, spec apfRoute) (routeResult, error) {
	result := routeResult{Operation: "enterprise." + spec.domain + ".apf." + spec.operation}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: spec.domain, LogicalTarget: spec.domain}
	var v enterpriseRequestContext
	var err error
	switch spec.channel {
	case "system":
		identity, e := s.authenticateEnterpriseSystem(r, spec.domain, "")
		result.Auth = &identity
		err = e
	case "purpose":
		identity, e := authenticateEnterpriseNotificationDetail(r, s.cfg, s.auth, s.verifyEnterpriseCredential, spec.domain)
		result.Auth = &identity
		err = e
		if err == nil {
			uid, deps, e := notificationDetailViewer(r, identity)
			err = e
			v = enterpriseRequestContext{Service: identity, Route: route, ActorUID: uid, DepartmentCodes: deps}
		}
	default:
		v, err = authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
		result.Auth = &v.Service
	}
	if err != nil {
		return result, err
	}
	if !s.cfg.Enterprise.Enabled || s.enterpriseAPF == nil {
		return result, httperror.New(503, "apf_unavailable", "APF domain is not installed")
	}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "apf_input_invalid", "Query is not supported")
	}
	if spec.channel == "system" {
		if spec.operation != "product-feedback-status" && spec.operation != "product-feedback-progress" && spec.operation != "approval-callback" && spec.operation != "invoice-approval-callback" {
			if err = validateEnterpriseSchedulerGeneration(r, s.cfg.Enterprise.Generation); err != nil {
				return result, err
			}
		}
		body, e := readJSONBody(r)
		if e != nil {
			return result, e
		}
		who := enterpriseapf.Identity{Tenant: route.Binding.Tenant, Deployment: route.HostDeployment, Client: "enterprise.runtime", RequestID: requestID(r)}
		if enterpriseapf.DeadLetterOperation(spec.operation) {
			if strings.HasPrefix(spec.operation, "pending-") && len(body) != 0 {
				return result, httperror.New(400, "apf_dead_letter_input_invalid", "Empty scan required")
			}
			raw, _ := json.Marshal(body)
			var in enterpriseapf.DeadLetterInput
			dec := json.NewDecoder(bytes.NewReader(raw))
			dec.DisallowUnknownFields()
			if dec.Decode(&in) != nil {
				return result, httperror.New(400, "apf_dead_letter_input_invalid", "Fixed input required")
			}
			owner := s.cfg.Enterprise.DeadLetterNotifications[spec.domain]
			data, e := s.enterpriseAPF.DeadLetter(r.Context(), spec.domain, spec.operation, in, who, enterpriseapf.DueOwner{Enabled: owner.Enabled, LegacyOwnerDisabled: owner.LegacyOwnerDisabled})
			result.Body = map[string]any{"code": 0, "data": data}
			return result, apfError(e)
		}
		if family, _, ok := enterpriseapf.DueOperation(spec.operation); ok {
			raw, _ := json.Marshal(body)
			var in enterpriseapf.DueInput
			dec := json.NewDecoder(bytes.NewReader(raw))
			dec.DisallowUnknownFields()
			if dec.Decode(&in) != nil {
				return result, httperror.New(400, "apf_due_input_invalid", "Invalid fixed input")
			}
			owner := s.cfg.Enterprise.DueNotifications[family]
			data, e := s.enterpriseAPF.Due(r.Context(), spec.domain, spec.operation, in, who, enterpriseapf.DueOwner{Enabled: owner.Enabled, LegacyOwnerDisabled: owner.LegacyOwnerDisabled})
			result.Body = map[string]any{"code": 0, "data": data}
			return result, apfError(e)
		}

		if strings.HasPrefix(spec.operation, "assignment-approval-") {
			b, e := s.cfg.EnterpriseBinding()
			if e != nil {
				return result, e
			}
			svc := enterpriseapf.PeopleFactsService{Registry: s.enterpriseRegistry, Binding: b, ApprovalReader: s.workflow}
			var data any
			if spec.operation == "assignment-approval-pending" {
				if len(body) != 0 {
					return result, httperror.New(400, "people_approval_input_invalid", "Empty body required")
				}
				data, e = svc.PendingAssignmentApprovals(r.Context(), who)
			} else {
				key, ok := body["operationKey"].(string)
				instance, valid := body["workflowInstanceId"].(string)
				if !ok || !valid || len(body) != 2 {
					return result, httperror.New(400, "people_approval_input_invalid", "Fixed binding fields required")
				}
				data, e = svc.BindAssignmentApproval(r.Context(), key, instance, who)
			}
			result.Body = map[string]any{"code": 0, "data": data}
			return result, apfError(e)
		}

		if spec.operation == "product-feedback-status" || spec.operation == "product-feedback-progress" {
			b, _ := json.Marshal(body)
			var input integrationoperation.ReceiptCommandInput
			decoder := json.NewDecoder(bytes.NewReader(b))
			decoder.DisallowUnknownFields()
			if e := decoder.Decode(&input); e != nil {
				return result, httperror.New(400, "feedback_projection_input_invalid", "固定投影字段无效")
			}
			if input.SourceDeploymentCode != s.cfg.DeploymentBindings["aims"] || input.TrustedContext.DeploymentCode != input.SourceDeploymentCode || input.TargetDeploymentCode != s.cfg.DeploymentBindings["altoc"] {
				return result, httperror.New(403, "feedback_projection_deployment_invalid", "投影部署绑定无效")
			}
			data, e := s.enterpriseAPF.FeedbackProjection(r.Context(), strings.TrimPrefix(spec.operation, "product-feedback-"), input, who)
			result.Body = map[string]any{"code": 0, "data": data}
			return result, apfError(e)
		}
		if spec.operation == "invoice-approval-callback" {
			data, e := s.enterpriseAPF.FinanceApprovalCallback(r.Context(), body, who)
			result.Body = map[string]any{"code": 0, "data": data}
			return result, apfError(e)
		}
		if spec.operation == "invoice-approval-bind-system" {
			no, ok := body["requestNo"].(string)
			if !ok || len(body) != 1 || !strings.HasPrefix(no, "APF-FIN-") {
				return result, httperror.New(400, "finance_approval_input_invalid", "Invalid request")
			}
			data, e := s.enterpriseAPF.BindFinanceApprovalSystem(r.Context(), no)
			result.Body = map[string]any{"code": 0, "data": data}
			return result, apfError(e)
		}
		if spec.operation == "approval-callback" {
			data, e := s.enterpriseAPF.AltocApprovalCallback(r.Context(), body, who)
			result.Body = map[string]any{"code": 0, "data": data}
			return result, apfError(e)
		}
		if spec.operation == "approval-bind" {
			no, ok := body["requestNo"].(string)
			if !ok || len(body) != 1 || !strings.HasPrefix(no, "APF-") {
				return result, httperror.New(400, "altoc_approval_input_invalid", "Invalid request")
			}
			data, e := s.enterpriseAPF.BindAltocApprovalSystem(r.Context(), no)
			result.Body = map[string]any{"code": 0, "data": data}
			return result, apfError(e)
		}
		if len(body) != 0 {
			return result, httperror.New(400, "apf_input_invalid", "System input must be empty")
		}
		if spec.operation == "invoice-approval-pending" {
			data, e := s.enterpriseAPF.PendingFinanceApprovals(r.Context())
			result.Body = map[string]any{"code": 0, "data": data}
			return result, apfError(e)
		}
		if spec.operation == "approval-pending" {
			data, e := s.enterpriseAPF.PendingAltocApprovals(r.Context())
			result.Body = map[string]any{"code": 0, "data": data}
			return result, apfError(e)
		}
		data, e := s.enterpriseAPF.Inspect(r.Context(), spec.domain)
		result.Body = map[string]any{"code": 0, "data": data}
		return result, apfError(e)
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	if spec.channel == "purpose" && body["deadLetterOperationId"] != nil {
		if len(body) != 2 {
			return result, httperror.New(400, "apf_dead_letter_descriptor_invalid", "Fixed descriptor required")
		}
		id, ok := body["deadLetterOperationId"].(string)
		notification, ok2 := body["notificationId"].(string)
		if !ok || !ok2 {
			return result, httperror.New(400, "apf_dead_letter_descriptor_invalid", "Fixed descriptor required")
		}
		data, e := s.enterpriseAPF.AuthorizeDeadLetter(r.Context(), spec.domain, v.ActorUID, id, notification)
		result.Body = map[string]any{"code": 0, "data": data}
		return result, apfError(e)
	}
	if spec.channel == "purpose" && body["eventKey"] != nil {
		if len(body) != 1 {
			return result, httperror.New(400, "apf_due_descriptor_invalid", "Fixed descriptor required")
		}
		key, ok := body["eventKey"].(string)
		if !ok {
			return result, httperror.New(400, "apf_due_descriptor_invalid", "Fixed descriptor required")
		}
		data, e := s.enterpriseAPF.AuthorizeDue(r.Context(), spec.domain, v.ActorUID, key)
		result.Body = map[string]any{"code": 0, "data": data}
		return result, apfError(e)
	}
	raw, _ := json.Marshal(body)
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var input apfInput
	if err = decoder.Decode(&input); err != nil {
		return result, httperror.New(400, "apf_input_invalid", "Invalid APF input")
	}
	if err = validateAPFPermit(r, input, spec, v, time.Now()); err != nil {
		return result, err
	}
	var data any
	if input.Cost != nil {
		key := r.Header.Get("Idempotency-Key")
		if enterpriseapf.CostWrite(spec.operation) && !validAPFKey(key) {
			return result, httperror.New(400, "finance_project_cost_key_required", "Key required")
		}
		data, err = s.enterpriseAPF.ProjectCost(r.Context(), spec.operation, *input.Cost, enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID, RequestID: requestID(r), Key: key}, *input.Authorization.CostScope)
	} else if _, _, ok := enterpriseapf.ApprovalPermission(spec.operation); ok {
		key := r.Header.Get("Idempotency-Key")
		if !validAPFKey(key) {
			return result, httperror.New(400, "altoc_idempotency_key_required", "Key required")
		}
		data, err = s.enterpriseAPF.AltocApproval(r.Context(), spec.operation, input.Input, enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID, RequestID: requestID(r), Key: key}, input.Authorization.Scope)
	} else if input.People != nil {
		key := r.Header.Get("Idempotency-Key")
		_, action, _ := enterpriseapf.PeoplePermission(spec.operation)
		if action == "admin" && !validAPFKey(key) {
			return result, httperror.New(400, "people_key_required", "Key required")
		}
		data, err = s.enterpriseAPF.People(r.Context(), spec.operation, *input.People, enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID, RequestID: requestID(r), Key: key}, input.Authorization.Scope)
	} else if input.Sales != nil {
		key := r.Header.Get("Idempotency-Key")
		_, salesAction, _ := enterpriseapf.SalesPermission(spec.operation)
		if !(enterpriseapf.IsFeedbackOperation(spec.operation) && spec.operation == "product-feedback-view") && !enterpriseapf.IsServiceSummary(spec.operation) && !enterpriseapf.IsKnowledgeOperation(spec.operation) && !validAPFKey(key) && !((enterpriseapf.IsReceivableOperation(spec.operation) || enterpriseapf.IsTenderOperation(spec.operation) || enterpriseapf.IsServiceAgreementOperation(spec.operation) || enterpriseapf.IsTicketOperation(spec.operation) || enterpriseapf.IsRenewalOperation(spec.operation)) && salesAction == "view") && (!enterpriseapf.IsSalesSupport(spec.operation) || strings.HasSuffix(spec.operation, "-create") || strings.HasSuffix(spec.operation, "-update") || strings.HasSuffix(spec.operation, "-delete")) {
			return result, httperror.New(400, "altoc_idempotency_key_required", "Key required")
		}
		if enterpriseapf.IsServiceSummary(spec.operation) {
			data, err = s.enterpriseAPF.ServiceSummary(r.Context(), spec.operation, *input.Sales, enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID}, input.Authorization.Scope)
		} else if enterpriseapf.IsFeedbackOperation(spec.operation) {
			data, err = s.enterpriseAPF.Feedback(r.Context(), spec.operation, *input.Sales, enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID, RequestID: requestID(r), Key: key}, input.Authorization.Scope)
		} else if enterpriseapf.IsKnowledgeOperation(spec.operation) {
			ports := enterpriseapf.KnowledgePorts{}
			if s.codocs != nil {
				ports.Document = func(ctx context.Context, u, actor string) (map[string]any, error) {
					return s.codocs.ReadProductDocumentForEnterprise(ctx, u, actor, false)
				}
			}
			if s.assets != nil {
				ports.Assets = func(ctx context.Context, c, a, e, actor, authorization, action string) (map[string]any, error) {
					return s.assets.EnterpriseCustomerKnowledgeRead(ctx, c, a, e, actor, authorization, action)
				}
			}
			data, err = s.enterpriseAPF.Knowledge(r.Context(), spec.operation, *input.Sales, enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID, RequestID: requestID(r), Key: key}, input.Authorization.Scope, ports)
		} else if enterpriseapf.IsSalesSupport(spec.operation) {
			var read enterpriseapf.SalesDocumentRead
			if s.codocs != nil {
				read = func(ctx context.Context, u, actor string) (map[string]any, error) {
					return s.codocs.ReadProductDocumentForEnterprise(ctx, u, actor, false)
				}
			}
			data, err = s.enterpriseAPF.SalesSupport(r.Context(), spec.operation, *input.Sales, enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID, RequestID: requestID(r), Key: key}, input.Authorization.Scope, read)
		} else {
			data, err = s.enterpriseAPF.Sales(r.Context(), spec.operation, *input.Sales, enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID, RequestID: requestID(r), Key: key}, input.Authorization.Scope)
		}
	} else if input.Contract != nil {
		key := r.Header.Get("Idempotency-Key")
		_, action, _ := enterpriseapf.ContractPermission(spec.operation)
		if action != "view" && !validAPFKey(key) {
			return result, httperror.New(400, "altoc_idempotency_key_required", "Key required")
		}
		roots := []string{}
		for _, p := range input.Contract.AimsPermits {
			if p.Scope == nil {
				return result, httperror.New(403, "contract_project_permit_invalid", "Scope required")
			}
			roots = append(roots, p.Scope.DepartmentTreeRoots...)
		}
		if len(roots) > 0 {
			if s.directory == nil {
				return result, httperror.New(503, "contract_project_scope_unavailable", "Directory required")
			}
			input.Contract.Descendants, err = s.directory.EnterpriseProjectScopeDepartmentDescendants(r.Context(), roots)
			if err != nil {
				return result, err
			}
		}
		data, err = s.enterpriseAPF.Contract(r.Context(), spec.operation, *input.Contract, enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID, RequestID: requestID(r), Key: key}, input.Authorization.Scope)
	} else if input.Quotation != nil {
		key := r.Header.Get("Idempotency-Key")
		_, action, _ := enterpriseapf.QuotationPermission(spec.operation)
		if action == "edit" && !validAPFKey(key) {
			return result, httperror.New(400, "altoc_idempotency_key_required", "Key required")
		}
		data, err = s.enterpriseAPF.Quotation(r.Context(), spec.operation, *input.Quotation, enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID, RequestID: requestID(r), Key: key}, input.Authorization.Scope)
	} else if input.Customer != nil {
		key := r.Header.Get("Idempotency-Key")
		if !validAPFKey(key) {
			return result, httperror.New(400, "altoc_idempotency_key_required", "Idempotency key required")
		}
		data, err = s.enterpriseAPF.Customer(r.Context(), spec.operation, *input.Customer, enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID, RequestID: requestID(r), Key: key}, input.Authorization.Scope)
	} else if input.Finance != nil {
		key := r.Header.Get("Idempotency-Key")
		if (strings.HasSuffix(spec.operation, "-create") || strings.HasSuffix(spec.operation, "-update") || (enterpriseapf.FinanceLedgerWrite(spec.operation) || func() bool { _, _, ok := enterpriseapf.FinanceApprovalPermission(spec.operation); return ok }())) && !validAPFKey(key) {
			return result, httperror.New(400, "finance_idempotency_key_required", "Idempotency key required")
		}
		if _, _, ok := enterpriseapf.FinanceApprovalPermission(spec.operation); ok {
			data, err = s.enterpriseAPF.FinanceApproval(r.Context(), spec.operation, *input.Finance, enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID, RequestID: requestID(r), Key: key}, input.Authorization.Scope)
		} else if _, _, ok := enterpriseapf.FinanceLedgerPermission(spec.operation); ok {
			data, err = s.enterpriseAPF.FinanceLedger(r.Context(), spec.operation, *input.Finance, enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID, RequestID: requestID(r), Key: key}, input.Authorization.Scope)
		} else if spec.operation == "balance-entries-list" {
			data, err = s.enterpriseAPF.FinanceBalanceEntries(r.Context(), *input.Finance, enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID, RequestID: requestID(r)})
		} else if spec.operation == "balance-entries-create" {
			data, err = s.enterpriseAPF.FinanceBalanceEntryCreate(r.Context(), *input.Finance, enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID, RequestID: requestID(r), Key: key})
		} else if spec.operation == "accounts-reveal-account-no" {
			data, err = s.enterpriseAPF.FinanceRevealAccountNo(r.Context(), *input.Finance, enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID, RequestID: requestID(r)})
		} else {
			data, err = s.enterpriseAPF.Finance(r.Context(), spec.operation, *input.Finance, enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID, RequestID: requestID(r), Key: key})
		}
	} else if spec.channel == "purpose" {
		data, err = s.enterpriseAPF.Authorize(r.Context(), spec.domain, input.Input, v.ActorUID, input.Authorization.Scope)
	} else if _, _, ok := enterpriseapf.MigrationQueueWritePermission(spec.operation); ok {
		key := r.Header.Get("Idempotency-Key")
		if !validAPFKey(key) {
			return result, httperror.New(400, "migration_queue_key_required", "Idempotency key required")
		}
		who := enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID, RequestID: requestID(r), Key: key}
		if spec.operation == "migration-exceptions-resolve" {
			data, err = s.enterpriseAPF.MigrationResolve(r.Context(), spec.domain, *input.MigrationResolve, who)
		} else if spec.operation == "migration-identities-apply" {
			data, err = s.enterpriseAPF.MigrationApply(r.Context(), *input.MigrationApply, who)
		} else {
			data, err = s.enterpriseAPF.MigrationIdentityDecision(r.Context(), spec.operation, *input.MigrationIdentity, who)
		}
	} else if _, _, ok := enterpriseapf.MigrationQueuePermission(spec.operation); ok {
		who := enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID, RequestID: requestID(r)}
		if spec.operation == "migration-identities-page" {
			data, err = s.enterpriseAPF.MigrationIdentities(r.Context(), migrationQueueInput(input.Input), who)
		} else {
			data, err = s.enterpriseAPF.MigrationExceptions(r.Context(), spec.domain, migrationQueueInput(input.Input), who)
		}
	} else if spec.operation == "save" {
		key := r.Header.Get("Idempotency-Key")
		if !validAPFKey(key) {
			return result, httperror.New(400, "apf_idempotency_key_required", "A valid idempotency key is required")
		}
		data, err = s.enterpriseAPF.Save(r.Context(), spec.domain, input.Input, enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID, RequestID: requestID(r), Key: key}, input.Authorization.Scope)
	} else {
		data, err = s.enterpriseAPF.Read(r.Context(), spec.domain, spec.operation, input.Input, v.ActorUID, input.Authorization.Scope)
	}
	result.Body = map[string]any{"code": 0, "data": data}
	return result, apfError(err)
}
func migrationQueueInput(i enterpriseapf.Input) enterpriseapf.MigrationQueueInput {
	return enterpriseapf.MigrationQueueInput{Options: i.MigrationQuery, ExceptionID: i.ID, Kind: i.Code, Status: i.Name, Search: i.Search, Page: i.Page, PageSize: i.PageSize}
}
func validAPFKey(key string) bool {
	if key == "" || len(key) > 100 || strings.TrimSpace(key) != key {
		return false
	}
	for _, r := range key {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("._:-", r)) {
			return false
		}
	}
	return true
}
func apfError(err error) error {
	if err == nil {
		return nil
	}
	var known httperror.Error
	if errors.As(err, &known) {
		return err
	}
	if errors.Is(err, enterprise.ErrPathDisabled) {
		return httperror.New(503, "apf_mode_disabled", "Domain mode is disabled")
	}
	return httperror.New(503, "apf_dependency_unavailable", "APF dependency is unavailable")
}
