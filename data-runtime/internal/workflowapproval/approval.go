// Package workflowapproval defines a read-only owning port; no trusted flags,
// database handles or network locations cross this interface.
package workflowapproval

import "context"

const CallbackPath = "/api/v1/service/workflow/callback"

func Registered(app, resource, action string) bool {
	return app == "altoc" && (resource == "quotation" || resource == "contract") && action == "approve"
}

type Instance struct {
	ID, No, App, Resource, Action, BizID, Initiator, Status, CallbackPath, Operator string
	Form                                                                            map[string]any
	NonSelf                                                                         []string
}
type Reader interface {
	ReadAltocApprovalInstance(context.Context, string, string, string) (*Instance, error)
}

// Finance callbacks are a separate closed business tuple, never an app wildcard.
func FinanceRegistered(app, resource, action string) bool {
	return app == "finance" && (resource == "invoices" && action == "request" || resource == "expenses" && (action == "claim" || action == "project_expense" || action == "payment"))
}
func FinanceCallbackPath(path string) bool {
	return path == "/api/v1/finance/workflow/callback" || path == "/finance/api/v1/finance/workflow/callback"
}
func CallbackRegistered(app, resource, action string) bool {
	return Registered(app, resource, action) || FinanceRegistered(app, resource, action)
}

type FinanceReader interface {
	ReadFinanceApprovalInstance(context.Context, string, string) (*Instance, error)
}

func PeopleRegistered(app, resource, action string) bool {
	return app == "people" && resource == "assignments" && action == "change"
}

type PeopleReader interface {
	ReadPeopleApprovalInstance(context.Context, string) (*Instance, error)
}
