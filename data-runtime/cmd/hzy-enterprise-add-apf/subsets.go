package main

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"strings"
)

// The names are a closed enum, never a file, domain, table or DDL selector.
func subsetInstaller(name string, e domaininstall.Expectation) (domaininstall.Installer, error) {
	if domaininstall.W1Domain(name) != "" {
		return domaininstall.ForW1(name, e)
	}
	switch name {
	case "altoc-receivables":
		return domaininstall.ForReceivables(e), nil
	case "finance-bank-account-columns":
		return domaininstall.ForFinanceBankAccountColumns(e), nil
	case "aims-portfolio-members":
		return domaininstall.ForAimsPortfolioMembers(e), nil
	case "people-offboarding":
		return domaininstall.ForPeopleOffboarding(e), nil
	case "altoc-due", "finance-due", "people-due":
		return domaininstall.ForDue(e, strings.TrimSuffix(name, "-due")), nil
	case "people-hr-source":
		return domaininstall.ForPeopleHRSource(e), nil
	case "":
		return domaininstall.ForAPF(e), nil
	case "people-private":
		return domaininstall.ForPeoplePrivateFacts(e), nil
	case "people-facts":
		return domaininstall.ForPeopleFacts(e), nil
	case "finance-B3":
		return domaininstall.ForFinanceB3(e), nil
	case "finance-13a":
		return domaininstall.ForFinance13a(e), nil
	case "finance-13b":
		return domaininstall.ForFinance13b(e), nil
	case "altoc-sales-B2":
		return domaininstall.ForAltocSales(e), nil
	case "altoc-feedback":
		return domaininstall.ForAltocFeedback(e), nil
	case "altoc-renewals":
		return domaininstall.ForAltocRenewals(e), nil
	case "altoc-tickets":
		return domaininstall.ForAltocTickets(e), nil
	case "altoc-services":
		return domaininstall.ForAltocServices(e), nil
	case "altoc-tenders":
		return domaininstall.ForAltocTenders(e), nil
	case "finance-receivables":
		return domaininstall.ForFinanceReceivables(e), nil
	case "finance-cost":
		return domaininstall.ForFinanceCost(e), nil
	default:
		return domaininstall.Installer{}, rejected
	}
}
func subsetDomain(name string) string {
	if d := domaininstall.W1Domain(name); d != "" {
		return d
	}
	if name == "altoc-due" || name == "finance-due" || name == "people-due" {
		return strings.TrimSuffix(name, "-due")
	}
	switch name {
	case "aims-portfolio-members":
		return "aims"
	case "people-private", "people-facts", "people-hr-source", "people-offboarding":
		return "people"
	case "altoc-receivables", "altoc-sales-B2", "altoc-tenders", "altoc-services", "altoc-tickets", "altoc-renewals", "altoc-feedback":
		return "altoc"
	default:
		return "finance"
	}
}

// owner is the reviewed Enterprise deployment, the same value Runtime config
// requires for the migration namespace; it is not borrowed from another domain.
func extendSubset(b enterprise.Binding, name, owner string) (enterprise.Binding, error) {
	if domaininstall.W1Domain(name) != "" {
		return domaininstall.WithW1(b, name, owner)
	}
	if domaininstall.IsColumnSubset(name) {
		return b, nil
	}
	if name == "altoc-due" || name == "finance-due" || name == "people-due" {
		return domaininstall.WithDue(b, strings.TrimSuffix(name, "-due"))
	}
	switch name {
	case "altoc-receivables":
		return domaininstall.WithReceivables(b)
	case "aims-portfolio-members":
		return domaininstall.WithAimsPortfolioMembers(b)
	case "people-offboarding":
		return domaininstall.WithPeopleOffboarding(b)
	case "people-hr-source":
		return domaininstall.WithPeopleHRSource(b)
	case "people-private":
		return domaininstall.WithPeoplePrivateFacts(b)
	case "people-facts":
		// The hzy0 approved chain freezes private before facts, even though the
		// library allows facts without private for other isolated deployment plans.
		if b.Domains["people"].Tables["people_employee_private_facts"] != "people_employee_private_facts" {
			return b, rejected
		}
		return domaininstall.WithPeopleFacts(b)
	case "finance-B3":
		return domaininstall.WithFinanceB3(b)
	case "finance-13a":
		return domaininstall.WithFinance13a(b)
	case "finance-13b":
		return domaininstall.WithFinance13b(b)
	case "altoc-sales-B2":
		return domaininstall.WithAltocSales(b)
	case "altoc-feedback":
		return domaininstall.WithAltocFeedback(b)
	case "altoc-renewals":
		return domaininstall.WithAltocRenewals(b)
	case "altoc-tickets":
		return domaininstall.WithAltocTickets(b)
	case "altoc-services":
		return domaininstall.WithAltocServices(b)
	case "altoc-tenders":
		return domaininstall.WithAltocTenders(b)
	case "finance-receivables":
		return domaininstall.WithFinanceReceivables(b)
	case "finance-cost":
		return domaininstall.WithFinanceCost(b)
	default:
		return b, rejected
	}
}
