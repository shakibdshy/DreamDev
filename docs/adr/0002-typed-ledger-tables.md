# Typed ledger tables instead of one polymorphic transactions table

Every money movement is stored in its own typed table — Contribution, Loan, Loan Repayment, Expense, Transfer, Adjustment — rather than one `transactions` table with a `type` column and nullable per-type fields. The Transactions page and Bank Account balances read from a unified view/service layer over these tables.

Chosen because each entry type carries genuinely different fields (a Transfer has two bank accounts, a Contribution has a member and share snapshot, an Expense has neither), so a single table would be mostly nullable columns and every service would filter on type. The cost is one aggregation layer; the gain is that each table stays honest and its service single-purpose.

Related: Bank Account Current Balance is always computed from these tables, never stored (see GLOSSARY.md).
