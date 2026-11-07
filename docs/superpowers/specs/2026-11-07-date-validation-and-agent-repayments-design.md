# Date Validation + Loan Repayments Through Chat — Design

Date: 2026-11-07
Status: approved

## Problem

Two issues reported live on 2026-11-07 (today):

1. **Bug — future dates accepted.** A Loan Repayment of ৳8,000 exists dated **8 Nov 2026** — tomorrow. No layer rejects future dates: the API/service schemas only check `YYYY-MM-DD` format (4 duplicated regex copies), the agent's sanity layer explicitly allows **35 days** into the future, and the dashboard `DatePicker` calendar lets users pick up to **100 years** ahead.
2. **Feature — agent can't record loan repayments.** The write surface *does* support `entity: "loan_repayment", action: "repay"`, but (a) no read tool exposes loan ids, so the model can't fill the required `id`; (b) the model's natural phrasing `entity: "loan", action: "repay"` falls into the generic fallback error which *tells* it repayments are dashboard-only — and it parrots that to the user (observed verbatim in Telegram).

## Decisions (user-approved)

- **Strict rule**: a record date may be today (Asia/Dhaka clock) or earlier — never future. No grace period.
- **Scope**: all record dates — loan `date`, repayment/contribution `creditDate`, expense/transfer `date`, member `joiningDate`, member status effective `date`. Share-change `effectiveMonth` and feed date *filters* stay unbounded (future months/filters are legitimate).
- **Bad record remediation**: add single-repayment soft delete (dashboard + agent), so the ৳8,000 / 8 Nov record can be removed without deleting its loan.

## A. No-future-date rule

### Shared schema (single source of truth)

New `ledgerDateSchema` in `apps/web/src/api/date-schema.ts`:

- format regex `^\d{4}-\d{2}-\d{2}$` (message: "Use YYYY-MM-DD")
- must be a **real calendar date** (currently `2026-02-31` can slip through ISO parsing)
- must satisfy `value <= todayInDhaka()` (lexicographic — both are `YYYY-MM-DD`; timezone-correct regardless of server region), message: "Date can't be in the future"

Applied to:

| Field | File |
|---|---|
| `createLoanBodySchema.date`, `createRepaymentBodySchema.creditDate` | `api/loans/schema.ts` |
| contribution `creditDate` (create + update) | `api/transactions/schema.ts` |
| expense `date` (create + update) | `api/ledger/expense.ts` |
| transfer `date` (create + update) | `api/ledger/transfer.ts` |
| `joiningDate` (create + update), `setStatusBodySchema.date` | `api/members/schema.ts` |

Services parse through these schemas on every write, so **dashboard and agent are both covered at the domain boundary**.

### Defense in depth

- **Agent sanity layer** (`agent/write-tools.ts` `assertSanity`, `agent/contribution-tools.ts` `creditDateSchema`): replace the 35-day future allowance with the same not-future check so the model gets a clear rejection *before* a confirm card renders.
- **Dashboard**: `DatePicker` gains a `max?: string` prop — passes `disabled: [{ after: max }]` to the react-day-picker `Calendar` (it forwards all DayPicker props), clamps `endMonth`, and keeps the Today button working. Every record-date form passes `max={todayInDhaka()}` and rejects a future value with "Date can't be in the future." Forms: loan create (`members.$id.tsx`), repayment (`loan-repayment-form.tsx`), contribution/expense/transfer (`routes/_auth/transactions.tsx`), member create/edit + status dialogs (`members.index.tsx`, `members.$id.tsx`, `member-actions.tsx`).
- **Agent prompt** (`agent/prompt.ts`): add "Record dates can't be in the future — resolve 'today' against **{today}**."

## B. Loan repayments through chat

1. **`list_loans` read tool** — input `{ memberId? }`; output loans with `id, memberId, memberName, amount, repaid, outstanding, settled, bankName, date`. Backed by new `listLoans()` in `api/loans/service.ts` (reuses the `loanViews` aggregation; all-members when `memberId` omitted). Fixes the real blocker: the model could never learn a loan id.
2. **`transactions_feed` entries gain `id`** — the feed service already returns `id`; the tool mapping drops it. This re-grounds every delete/update flow, not just repayments.
3. **Alias `loan:repay` → `loan_repayment:repay`** in `previewWrite`/`executeWrite`, and the fallback default error now lists the valid write combos and where ids come from (`list_members` / `list_banks` / `list_loans` / `transactions_feed`) instead of claiming dashboard-only.
4. **Prompt recipe** (`agent/prompt.ts`): loan repayments = find the loan with `list_loans`, then `preview_write { entity: "loan_repayment", action: "repay", id: <loanId>, args: { bankAccountId, amount, creditDate } }` → `write_record` with identical arguments.
5. **Delete-repayment**:
   - `softDeleteRepayment(deps, repaymentId)` in `api/loans/service.ts` (requireUser, soft-delete, outstanding recovers on next aggregate).
   - HTTP: `DELETE /api/loans/repayments/$id` (static `repayments` segment takes precedence over `$id` in TanStack Router) via new `deleteRepayment` handler in `api/loans/http.ts`, route `routes/api/loans/repayments/$id/index.ts`.
   - Dashboard: per-repayment remove action in the loan's repayment history (Loans page), with confirm.
   - Agent: `loan_repayment` added to `deleteEntities` (+ `write-tools-defs.ts` enum), `previewDelete` lines show member, amount, date, and the loan's recovered outstanding; `executeDelete` dispatches to the service.
   - Telegram notification: new `MemberEventType` `"repayment_deleted"` with heading "🗑️ Loan repayment removed" and a body showing amount/date.

## C. Testing & verification

- **Failing tests first**, then implementation:
  - Service/schema tests: future loan date, repayment/contribution/expense/transfer dates, joiningDate, status date → 422; today accepted; fake calendar dates rejected.
  - `softDeleteRepayment`: removes one repayment, outstanding recovers, loan untouched.
  - Agent tests: `list_loans` present; `loan:repay` alias previews + executes; feed entries carry `id`; fallback error names valid combos; future date rejected in `preview_write`; `delete_record` supports `loan_repayment`.
- Full suite green (`bun test` via varlock per repo convention).
- **Browser pass**: dashboard date pickers block future days; agent panel records a repayment end-to-end (preview → approve → ledger/bank balances update); delete-repayment removes a row and outstanding recovers.
- Commit + push to main (deploys via Vercel); live Telegram re-test of the exact refused prompt is the user's acceptance step.

## Out of scope

- Editing/deleting historical records en masse (only the new delete-repayment capability ships; the user removes the bad ৳8,000 record with it after deploy).
- Backfilling any date lower-bound (very old dates stay allowed — backdated records are legitimate).
