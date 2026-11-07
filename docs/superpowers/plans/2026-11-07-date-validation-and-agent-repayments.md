# Date Validation + Loan Repayments Through Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ledger dates can never be in the future (Asia/Dhaka), and the agent can record/delete loan repayments through chat.

**Architecture:** One shared zod schema (`ledgerDateSchema`) becomes the single source of truth at the service boundary (dashboard + agent writes both flow through it), with defense-in-depth in the agent sanity layer and the dashboard `DatePicker` (new `max` prop). The agent gains a `list_loans` read tool + record ids in `transactions_feed` (the actual blockers), a `loan:repay` alias, honest fallback errors, an explicit prompt recipe, and `loan_repayment` joins the gated delete surface backed by a new `softDeleteRepayment` service + `DELETE /api/loans/repayments/$id`.

**Tech Stack:** Bun + TanStack Start (file routes) + zod v4 + Prisma (multi-file schema, Postgres) + TanStack AI (`@tanstack/ai`, `needsApproval` gate) + react-day-picker via `packages/ui` Calendar.

**Spec:** `docs/superpowers/specs/2026-11-07-date-validation-and-agent-repayments-design.md`

## Global Constraints

- Money is whole taka; taka formatting via `toLocaleString("en-IN")` as elsewhere.
- Dates are `YYYY-MM-DD` at the Asia/Dhaka clock; canonical "today" is `todayInDhaka()` from `@DreamDev/db/domain/month`.
- Every agent write/delete stays behind the `needsApproval` confirm gate; previews show canonical values from DB reads only.
- Role rules unchanged: Adjustments + Share changes are Admin-only; repayments are any-user.
- Tests run from `apps/web`: `bun test --timeout 60000` (Prisma Postgres latency). Full suite before every commit that claims green.
- No Prisma schema/migration changes (notification type is a TS union in `notify.ts`, not a DB enum).
- Match surrounding comment style; comments explain "why", not "what".

## Task 1: `ledgerDateSchema` + loans schemas + test helpers

**Files:**
- Create: `apps/web/src/api/date-schema.ts`
- Create: helpers in `apps/web/src/api/test-support.ts` (append)
- Modify: `apps/web/src/api/loans/schema.ts`
- Test: `apps/web/src/api/loans/loans.test.ts`

**Interfaces:**
- Produces: `ledgerDateSchema` (zod `ZodString` with format + real-calendar + not-future refinements; error "Date can't be in the future").
- Produces: `pastMonth(): string` (`YYYY-MM`, last month) and `thisDay(month: string, n: number): string` (`${month}-${min(n, today's Dhaka day)}` padded) from `test-support.ts` — later tasks import these.

- [ ] **Step 1: Write the failing test** — append to the `describe("loans", …)` block in `loans.test.ts` (imports: add `todayInDhaka` from `@DreamDev/db/domain/month`, `pastMonth` from `../test-support`; change `const thisMonth = monthOfDate(new Date());` to `const thisMonth = pastMonth();` and add `const futureDay = () => { const d = new Date(`${todayInDhaka()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };`):

```ts
  test("record dates can't be in the future (Asia/Dhaka)", async () => {
    await createContribution({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 5000, creditDate: `${thisMonth}-05` });
    const tomorrow = futureDay();
    await expect(
      createLoan({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 8000, date: tomorrow }),
    ).rejects.toMatchObject({ status: 422 });

    const { loan } = await createLoan({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 8000, date: todayInDhaka() });
    await expect(
      createRepayment({ db, session: editor }, loan.id, { bankAccountId: bankId, amount: 1000, creditDate: tomorrow }),
    ).rejects.toMatchObject({ status: 422 });
    await createRepayment({ db, session: editor }, loan.id, { bankAccountId: bankId, amount: 1000, creditDate: todayInDhaka() }); // today is fine
  });
```

- [ ] **Step 2: Run to verify failure** — `cd apps/web && bun test --timeout 60000 src/api/loans/loans.test.ts`. Expected: new test FAILS (future dates accepted); existing tests FAIL too (`${thisMonth}-10` is future once validation lands — this task also sweeps them).
- [ ] **Step 3: Sweep `loans.test.ts` dates to the past month** — replace `const thisMonth = monthOfDate(new Date());` with `const thisMonth = pastMonth();` (keep every `${thisMonth}-NN` untouched — all days of a past month are valid and ordering is preserved). Drop the now-unused `monthOfDate` import if nothing else uses it.
- [ ] **Step 4: Implement** — create `apps/web/src/api/date-schema.ts`:

```ts
import { z } from "zod";

import { todayInDhaka } from "@DreamDev/db/domain/month";

/**
 * A ledger day: a real `YYYY-MM-DD` calendar date, today (Asia/Dhaka) or
 * earlier. The domain never records future dates (spec 2026-11-07); the agent
 * sanity layer and the dashboard DatePicker enforce the same rule.
 */
export const ledgerDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => {
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
  }, "Choose a real calendar date")
  .refine((value) => value <= todayInDhaka(), "Date can't be in the future");
```

  Append to `apps/web/src/api/test-support.ts` (check its existing imports first; add `addMonths, monthOfDate` from `@DreamDev/db/domain/month`):

```ts
/** A `YYYY-MM` that is always in the past — record dates can never be future. */
export function pastMonth(): string {
  return addMonths(monthOfDate(new Date()), -1);
}

/** Day `n` of `month`, clamped to today's Dhaka day for current-month tests. */
export function thisDay(month: string, n: number): string {
  const day = Math.max(1, Math.min(n, Number(todayInDhaka().slice(8, 10))));
  return `${month}-${String(day).padStart(2, "0")}`;
}
```

  In `apps/web/src/api/loans/schema.ts` replace the local `dateString` + its two usages with `import { ledgerDateSchema } from "../date-schema";` → `date: ledgerDateSchema` and `creditDate: ledgerDateSchema`.
- [ ] **Step 5: Run to verify pass** — `bun test --timeout 60000 src/api/loans/loans.test.ts` — all PASS.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: ledgerDateSchema — no future record dates (loans)"`

## Task 2: Apply `ledgerDateSchema` to contributions, expenses, transfers, members + sweep their tests

**Files:**
- Modify: `apps/web/src/api/transactions/schema.ts` (create + update `creditDate`; keep the local `dateString` for `listFeedQuerySchema.from/to` — filters stay unbounded)
- Modify: `apps/web/src/api/ledger/expense.ts` (create + update `date`)
- Modify: `apps/web/src/api/ledger/transfer.ts` (create + update `date`)
- Modify: `apps/web/src/api/members/schema.ts` (`joiningDate` create + update, `setStatusBodySchema.date`; `changeSharesBodySchema.effectiveMonth` untouched)
- Test: `transactions.test.ts`, `ledger.test.ts`, `members.test.ts` (one rejection test each + date sweep)

**Interfaces:**
- Consumes: `ledgerDateSchema`, `thisDay`.

- [ ] **Step 1: Failing tests** — add one test per file, mirroring the loans pattern:

```ts
// transactions.test.ts — inside the main describe
  test("contribution credit dates can't be in the future", async () => {
    const tomorrow = futureDay();
    await expect(
      createContribution({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 1000, creditDate: tomorrow }),
    ).rejects.toMatchObject({ status: 422 });
    await createContribution({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 1000, creditDate: todayInDhaka() });
  });
```

```ts
// ledger.test.ts
  test("expense and transfer dates can't be in the future", async () => {
    const tomorrow = futureDay();
    await expect(createExpense({ db, session: editor }, { bankAccountId: bankA, amount: 500, date: tomorrow })).rejects.toMatchObject({ status: 422 });
    await expect(createTransfer({ db, session: editor }, { fromAccountId: bankA, toAccountId: bankB, amount: 500, date: tomorrow })).rejects.toMatchObject({ status: 422 });
    await createExpense({ db, session: editor }, { bankAccountId: bankA, amount: 500, date: todayInDhaka() });
  });
```

```ts
// members.test.ts
  test("joining and status dates can't be in the future", async () => {
    const tomorrow = futureDay();
    await expect(createMember({ db, session: admin }, { name: "X", mobile: "01911111111", joiningDate: tomorrow, shareQuantity: 1 })).rejects.toMatchObject({ status: 422 });
    const member = await createMember(memberInput());
    await expect(setStatus({ db, session: admin }, member.id, { status: "inactive", date: tomorrow })).rejects.toMatchObject({ status: 422 });
  });
```

  Each file gains a local `futureDay()` helper identical to Task 1's (or import from `../test-support` — prefer exporting `futureDay()` from `test-support.ts` once and importing everywhere; put it there in this task).
- [ ] **Step 2: Verify failures** — run the three files; new tests FAIL.
- [ ] **Step 3: Implement** — swap the local `dateString` for `ledgerDateSchema` in the four schema spots listed above (leave `transactions/schema.ts`'s feed-filter `dateString` and `members/schema.ts`'s `effectiveMonth` regex untouched).
- [ ] **Step 4: Sweep test dates** — in `transactions.test.ts`, `ledger.test.ts`, `members.test.ts`, `dashboard.test.ts`, `settings.test.ts`: replace record-date constructions `${thisMonth}-NN` with `thisDay(thisMonth, NN)` where NN can exceed today (10/12/15/20…). Do NOT change month-based values (`joiningDate: \`${thisMonth}-01\`` is always ≤ today — may stay; `effectiveMonth`/adjustment months stay). `dashboard.test.ts` keeps `thisMonth` bucketing (KPI assertions depend on it) — only days get clamped; its aggregate assertions (`thisMonthCollected`, `series[thisMonth]`) are day-independent. Verify imports of `thisDay` from `../test-support`.
- [ ] **Step 5: Verify pass** — `bun test --timeout 60000 src/api/` (full api tree). All PASS.
- [ ] **Step 6: Commit** — `git commit -am "feat: no-future record dates across contributions, expenses, transfers, members"`

## Task 3: Agent sanity layer + prompt date rule

**Files:**
- Modify: `apps/web/src/agent/write-tools.ts` (`assertSanity`, remove `SANITY_MAX_FUTURE_DAYS`)
- Modify: `apps/web/src/agent/contribution-tools.ts` (`creditDateSchema`)
- Modify: `apps/web/src/agent/prompt.ts` (date rule line)
- Test: `apps/web/src/agent/agent.test.ts`

**Interfaces:**
- Consumes: `todayInDhaka`.
- Produces: `assertSanity` rejects any `args.date`/`args.creditDate` > today (Dhaka) with `"Record dates can't be in the future — use today or earlier (Asia/Dhaka)"`.

- [ ] **Step 1: Failing test** — in the `generic write surface` describe:

```ts
  test("future record dates are rejected at the sanity layer, before any card", async () => {
    const { bank } = await seedFund();
    const tomorrow = futureDay();
    await expect(
      previewWrite(deps(), "admin", { entity: "expense", action: "create", args: { bankAccountId: bank.id, amount: 100, date: tomorrow } }),
    ).rejects.toThrow("can't be in the future");
    await expect(
      previewWrite(deps(), "admin", { entity: "loan_repayment", action: "repay", id: "any", args: { bankAccountId: bank.id, amount: 100, creditDate: tomorrow } }),
    ).rejects.toThrow("can't be in the future");
  });
```

  (`futureDay` import from `../api/test-support`.) Also sweep agent.test.ts hardcoded write dates → dynamic: `"2026-11-01"`→`todayInDhaka()` where a valid create is needed, `seedFund()`'s `"2026-10-05"` contribution → `` `${pastMonth()}-05` ``; direct `db.*.create` rows (loan `new Date("2026-09-01")`) may stay — they bypass zod.
- [ ] **Step 2: Verify failure** — `bun test --timeout 60000 src/agent/agent.test.ts`; new test FAILS (35-day cap accepts tomorrow).
- [ ] **Step 3: Implement** — in `write-tools.ts`:

```ts
import { todayInDhaka } from "@DreamDev/db/domain/month";
// remove SANITY_MAX_FUTURE_DAYS; in assertSanity replace the future-days block with:
  const rawDate = typeof creditDate === "string" ? creditDate : typeof date === "string" ? date : undefined;
  if (typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && rawDate > todayInDhaka()) {
    throw new Error("Record dates can't be in the future — use today or earlier (Asia/Dhaka)");
  }
```

  In `contribution-tools.ts` replace `MAX_FUTURE_DAYS`/refine with:

```ts
import { todayInDhaka } from "@DreamDev/db/domain/month";
/** YYYY-MM-DD, today (Asia/Dhaka) or earlier — the domain never records future dates. */
const creditDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => value <= todayInDhaka(), "Credit Date can't be in the future");
```

  In `prompt.ts` domain-language section, extend the dates line with: `Record dates can't be in the future — "today" means **${today}**.`
- [ ] **Step 4: Verify pass** — agent tests green.
- [ ] **Step 5: Commit** — `git commit -am "feat: agent sanity layer rejects future record dates"`

## Task 4: DatePicker `max` + form guards

**Files:**
- Modify: `apps/web/src/components/date-picker.tsx` (new `max?: string` prop; export `isFutureDate(value: string): boolean`)
- Modify (pass `max={todayInDhaka()}` + future guard on submit/validators):
  - `loan-repayment-form.tsx` (creditDate — has `dateError`; extend)
  - `routes/_auth/transactions.tsx` (contribution form validator ~line 744 + submit guard ~790; expense ~557 + transfer ~609 — plain forms, add submit guard)
  - `routes/_auth/members.index.tsx` (joiningDate validator ~355)
  - `components/member-actions.tsx` (edit joiningDate ~143, status date ~168 — extend submit guards)
  - `routes/_auth/members.$id.tsx` (NewLoanDialog date ~765 — add submit guard)

No unit tests (UI) — verified by `check-types` + the browser pass at the end.

- [ ] **Step 1: DatePicker** — add to props: `max?: string;` (doc: "`YYYY-MM-DD` — days after this are disabled"). In the component:

```tsx
  const maxDate = max ? parseCalendarDate(max) : undefined;
  // endMonth: clamp to max's month when provided
  const endMonth = maxDate
    ? new Date(Math.max(maxDate.getFullYear(), selected?.getFullYear() ?? 0), 11, 31)
    : new Date(Math.max(today.getFullYear() + 100, selected?.getFullYear() ?? 0), 11, 31);
```

  and on `<Calendar>`: `disabled={maxDate ? [{ after: maxDate }] : undefined}` (react-day-picker matcher; the Calendar forwards props). Also export:

```tsx
/** True when `value` is a well-formed date after today (Asia/Dhaka). */
export function isFutureDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value > todayInDhaka();
}
```

- [ ] **Step 2: Forms** — every record-date call site: pass `max={todayInDhaka()}` (import already present in most files; add where missing). Guards:
  - `loan-repayment-form.tsx`: `const dateError = !validCreditDate(creditDate) ? "Choose a valid credit date." : isFutureDate(creditDate) ? "Credit date can't be in the future." : undefined;`
  - `transactions.tsx` contribution validator: `z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")` → append `.refine((v) => !isFutureDate(v), "Date can't be in the future")`; the submit-guard regex check (~790) gains `|| isFutureDate(creditDate)` → false. Expense/transfer submits: `if (isFutureDate(date)) { toast.error("Date can't be in the future"); return; }`.
  - `members.index.tsx` joiningDate validator: same refine pattern.
  - `member-actions.tsx` edit submit guard (`line ~130`): add `|| isFutureDate(joiningDate)` (and a visible error like the existing name/mobile errors); status dialog submit: add `|| isFutureDate(date)`.
  - `members.$id.tsx` NewLoanDialog submit: add `if (isFutureDate(date)) { toast.error("Date can't be in the future"); return; }`.
- [ ] **Step 3: Typecheck** — `cd apps/web && bun run check-types`. PASS.
- [ ] **Step 4: Commit** — `git commit -am "feat: dashboard date pickers block future days on every record form"`

## Task 5: Agent can find loans — `listLoans` service, `list_loans` tool, feed ids, alias, honest errors, prompt recipe

**Files:**
- Modify: `apps/web/src/api/loans/service.ts` (`listLoans`)
- Modify: `apps/web/src/agent/tools.ts` (`listLoansTool`; `transactions_feed` mapping gains `id`)
- Modify: `apps/web/src/agent/write-tools.ts` (alias + fallback errors), `write-tools-defs.ts` (comment only if needed — enums already cover)
- Modify: `apps/web/src/agent/prompt.ts` (recipe lines)
- Test: `agent.test.ts`

**Interfaces:**
- Produces: `listLoans(deps: LoansDeps, memberId?: string): Promise<{ loans: { id: string; memberId: string; memberName: string; amount: number; date: string; bankName: string; note: string | null; repaid: number; outstanding: number; settled: boolean }[]; totalOutstanding: number }>`
- Produces: `previewWrite`/`executeWrite` accept `{ entity: "loan", action: "repay" }` (normalized to `loan_repayment:repay`).
- Produces: `transactions_feed` output entries gain `id: string`.

- [ ] **Step 1: Failing tests** — in `agent.test.ts`:

```ts
  test("list_loans exposes ids so repayments can be proposed", async () => {
    const { member, bank } = await seedFund();
    const { loan } = await createLoan({ db, session: adminSession }, { memberId: member.id, bankAccountId: bank.id, amount: 12_000, date: todayInDhaka() });
    const names = agentTools("admin").map((t) => t.name);
    expect(names).toContain("list_loans");
    const result = await listLoans({ db, session: adminSession }, undefined);
    expect(result.loans[0]).toMatchObject({ id: loan.id, memberName: "Rahim Uddin", amount: 12_000, outstanding: 12_000, settled: false });
  });

  test("loan:repay alias previews and executes like loan_repayment:repay", async () => {
    const { member, bank } = await seedFund();
    const { loan } = await createLoan({ db, session: adminSession }, { memberId: member.id, bankAccountId: bank.id, amount: 12_000, date: todayInDhaka() });
    const preview = await previewWrite(deps(), "admin", { entity: "loan", action: "repay", id: loan.id, args: { bankAccountId: bank.id, amount: 4_000, creditDate: todayInDhaka() } });
    expect(preview.lines.join(" ")).toContain("outstanding ৳12,000");
    await executeWrite(deps(), "admin", { entity: "loan", action: "repay", id: loan.id, args: { bankAccountId: bank.id, amount: 4_000, creditDate: todayInDhaka() } });
    expect(await db.loanRepayment.count()).toBe(1);
  });

  test("unknown entity:action errors name the valid writes and where ids come from", async () => {
    const message = await executeWrite(deps(), "admin", { entity: "member", action: "repay", args: {} }).catch((e) => (e as Error).message);
    expect(message).toContain("loan_repayment:repay");
    expect(message).toContain("list_loans");
  });
```

  (imports: `agentTools`, `listLoans`, `createLoan`.) Feed-id test: call the feed tool mapping via a tiny direct assertion on `listFeed` service output (already has `id`) is not enough — assert through the tool: extend the existing read-tools loop test or add:

```ts
  test("transactions_feed entries carry ids", async () => {
    const { member, bank } = await seedFund();
    await createContribution({ db, session: adminSession }, { memberId: member.id, bankAccountId: bank.id, amount: 1_000, creditDate: todayInDhaka() });
    const row = await db.agentConversation.create({ data: { userId: adminSession.user.id, threadId: "t-feed" } });
    // tool executors are exercised through agentStream in the gate tests; here assert the mapping source:
    const feed = await listFeed({ db, session: adminSession }, { page: 1, pageSize: 5, order: "desc" });
    expect(feed.data[0]?.id).toBeTruthy();
  });
```

  — plus, in the tool definition itself the mapping `id: e.id` is type-checked by the outputSchema (see Step 3). (If a lighter direct-tool call pattern exists in the file, prefer it.)
- [ ] **Step 2: Verify failures** — `list_loans`/alias tests FAIL.
- [ ] **Step 3: Implement** —
  `loans/service.ts`:

```ts
/** All live Loans (optionally one Member's) with repayment aggregates — read for the agent's list_loans tool. */
export async function listLoans(deps: LoansDeps, memberId?: string) {
  requireUser(deps.session);
  const [loans, repayments] = await Promise.all([
    deps.db.loan.findMany({
      where: { deletedAt: null, ...(memberId ? { memberId } : {}) },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      include: { bankAccount: { select: { bankName: true } }, member: { select: { name: true } } },
    }),
    deps.db.loanRepayment.findMany({
      where: { deletedAt: null, ...(memberId ? { memberId } : {}), loanId: memberId ? undefined : undefined },
    }),
  ]);
  const byLoan = new Map<string, number>();
  for (const r of repayments) byLoan.set(r.loanId, (byLoan.get(r.loanId) ?? 0) + r.amount);
  const views = loans.map((loan) => {
    const repaid = byLoan.get(loan.id) ?? 0;
    return {
      ...loan,
      memberId: loan.memberId,
      memberName: loan.member.name,
      bankName: loan.bankAccount.bankName,
      date: loan.date.toISOString().slice(0, 10) as string,
      repaid,
      outstanding: Math.max(0, loan.amount - repaid),
      settled: loan.amount - repaid <= 0,
    };
  });
  return { loans: views, totalOutstanding: views.reduce((sum, l) => sum + l.outstanding, 0) };
}
```

  (fetch repayments with `loanId: { in: loans.map((l) => l.id) }` instead of the awkward spread above — final code must filter repayments to the fetched loans.)
  `tools.ts`: add `listLoansTool` (input `{ memberId?: string }`, output `total` + loans array with `id, memberId, memberName, amount, repaid, outstanding, settled, bankName, date`) wrapping `listLoans`; register it in `agentTools`'s `reads`; `transactions_feed` outputSchema + mapping gain `id: e.id`.
  `write-tools.ts`: in `previewWrite` and `executeWrite`, right after `sanitizeOptionalText`: `if (input.entity === "loan" && input.action === "repay") input = { ...input, entity: "loan_repayment" };`. Replace both `default:` throws with:

```ts
    default: {
      const valid =
        "loan:create · loan_repayment:repay (alias loan:repay) · expense:create|update · transfer:create|update · adjustment:create|update (Admin) · member:create|update|status|shares (shares Admin) · bank:create|update · contribution:update";
      throw new Error(`${entity} ${action} is not a valid write through chat. Valid writes: ${valid}. Resolve ids with list_members / list_banks / list_loans / transactions_feed — feed entries carry id.`);
    }
```

  `prompt.ts`: replace the "Everything else" line with:

```
- Loan repayments: find the loan with list_loans, then preview_write { entity: "loan_repayment", action: "repay", id: <loanId>, args: { bankAccountId, amount, creditDate } } → write_record with identical arguments ("loan" + action "repay" also works).
- Everything else (loans, expenses, transfers, adjustments, members, banks, contribution edits, deletes): preview_write or preview_delete first, then write_record or delete_record with identical arguments. Record ids come from list_members / list_banks / list_loans / transactions_feed (entries carry id) — never invent ids; call a list tool only when the Directory is missing or ambiguous.
```

- [ ] **Step 4: Verify pass** — agent tests green; run `bun test --timeout 60000 src/agent/ src/api/loans/`.
- [ ] **Step 5: Commit** — `git commit -am "feat: agent can discover loans and record repayments (list_loans, feed ids, loan:repay alias)"`

## Task 6: Delete-repayment — service, notify, HTTP, agent delete surface, dashboard UI

**Files:**
- Modify: `apps/web/src/api/loans/service.ts` (`softDeleteRepayment`)
- Modify: `apps/web/src/telegram/notify.ts` (`repayment_deleted` union member + heading + body case)
- Modify: `apps/web/src/api/loans/http.ts` (`deleteRepayment` handler)
- Create: `apps/web/src/routes/api/loans/repayments/$id/index.ts`
- Modify: `apps/web/src/agent/write-tools.ts` (`deleteEntities` + preview/execute cases), `write-tools-defs.ts` (enum)
- Modify: `apps/web/src/routes/_auth/members.$id.tsx` (per-repayment Remove in `LoanHistory` + confirm dialog + mutation in the loans card)
- Test: `loans.test.ts`, `agent.test.ts`

**Interfaces:**
- Produces: `softDeleteRepayment(deps: LoansDeps, repaymentId: string): Promise<{ ok: true }>` (404 when missing/already deleted; notifies `repayment_deleted`).
- Produces: `DELETE /api/loans/repayments/$id`; `delete_record { entity: "loan_repayment", id }`.

- [ ] **Step 1: Failing tests** —

```ts
// loans.test.ts
  test("softDeleteRepayment removes one repayment; outstanding recovers", async () => {
    const { loan } = await createLoan({ db, session: editor }, { memberId, bankAccountId: bankId, amount: 10000, date: `${thisMonth}-01` });
    const first = await createRepayment({ db, session: editor }, loan.id, { bankAccountId: bankId, amount: 4000, creditDate: `${thisMonth}-02` });
    await createRepayment({ db, session: editor }, loan.id, { bankAccountId: bankId, amount: 3000, creditDate: `${thisMonth}-03` });

    await softDeleteRepayment({ db, session: editor }, first.repayment.id);

    const view = await memberLoans({ db, session: editor }, memberId);
    expect(view.loans[0]?.repaid).toBe(3000);
    expect(view.loans[0]?.outstanding).toBe(7000);
    expect(view.loans[0]?.settled).toBe(false);
    await expect(softDeleteRepayment({ db, session: editor }, first.repayment.id)).rejects.toMatchObject({ status: 404 });
  });
```

```ts
// agent.test.ts — inside generic write surface
  test("loan_repayment joins the delete surface with canonical lines", async () => {
    const { member, bank } = await seedFund();
    const { loan } = await createLoan({ db, session: adminSession }, { memberId: member.id, bankAccountId: bank.id, amount: 20_000, date: todayInDhaka() });
    const { repayment } = await createRepayment({ db, session: adminSession }, loan.id, { bankAccountId: bank.id, amount: 8_000, creditDate: todayInDhaka() });
    const preview = await previewDelete(deps(), "admin", { entity: "loan_repayment", id: repayment.id });
    expect(preview.lines.join(" ")).toContain("8,000");
    expect(preview.lines.join(" ")).toContain("outstanding recovers to ৳20,000");
    await executeDelete(deps(), "admin", { entity: "loan_repayment", id: repayment.id });
    expect((await db.loanRepayment.findUnique({ where: { id: repayment.id } }))?.deletedAt).not.toBeNull();
    expect(await db.loan.count()).toBe(1); // loan untouched
  });
```

- [ ] **Step 2: Verify failures** — both FAIL (no export / unknown entity).
- [ ] **Step 3: Implement service + notify + HTTP + route** — `service.ts`:

```ts
/** Soft-deletes one Loan Repayment — outstanding recovers; the Loan itself is untouched. */
export async function softDeleteRepayment(deps: LoansDeps, repaymentId: string) {
  requireUser(deps.session);
  const repayment = await deps.db.loanRepayment.findUnique({ where: { id: repaymentId } });
  if (!repayment || repayment.deletedAt) throw new HttpError(404, "Repayment not found");
  await deps.db.loanRepayment.update({ where: { id: repaymentId }, data: { deletedAt: new Date() } });
  await notifyMemberEvent({ db: deps.db }, { memberId: repayment.memberId, type: "repayment_deleted", recordId: repaymentId });
  return { ok: true };
}
```

  `notify.ts`: add `| "repayment_deleted"` after `"repayment_recorded"`, heading `repayment_deleted: "🗑️ Loan repayment removed"`, body case mirroring `loan_deleted` (push `Amount: taka(row.amount)`, `Date: day(row.creditDate)` from `db.loanRepayment.findUnique`).
  `http.ts`: `deleteRepayment: withApi(async (ctx, _request, params) => softDeleteRepayment(ctx, params.id), resolve),` (import `softDeleteRepayment`).
  New route file `routes/api/loans/repayments/$id/index.ts`:

```ts
import { createFileRoute } from "@tanstack/react-router";

import { loans } from "@/api/loans/http";

export const Route = createFileRoute("/api/loans/repayments/$id/")({
  server: {
    handlers: {
      DELETE: loans.deleteRepayment,
    },
  },
});
```

- [ ] **Step 4: Agent delete surface** — `write-tools.ts`: `deleteEntities` gains `"loan_repayment"`; `previewDelete` case:

```ts
    case "loan_repayment": {
      const row = await db.loanRepayment.findUnique({ where: { id } });
      if (!row || row.deletedAt) throw new Error("Loan Repayment not found");
      const loan = row.loanId ? await db.loan.findUnique({ where: { id: row.loanId } }) : null;
      const repaid = await db.loanRepayment.aggregate({ _sum: { amount: true }, where: { loanId: row.loanId, deletedAt: null } });
      const outstandingAfter = loan ? loan.amount - (repaid._sum.amount ?? 0) + row.amount : null;
      return {
        lines: [
          `Loan repayment: ${taka(row.amount)} from ${await memberName(row.memberId)} on ${day(row.creditDate)}`,
          ...(loan && outstandingAfter !== null ? [`Loan of ${taka(loan.amount)} — outstanding recovers to ${taka(Math.max(0, outstandingAfter))}`] : []),
        ],
      };
    }
```

  `executeDelete` case: `case "loan_repayment": await softDeleteRepayment(s, input.id); return { deleted: true };` (import it). `write-tools-defs.ts` `previewDeleteDef` enum gains `"loan_repayment"`.
- [ ] **Step 5: Dashboard UI** — in `members.$id.tsx` loans card: add `removingRepayment` state + `removeRepayment` mutation (same invalidations as the repay mutation + `transactions`, `banks`, `dashboard`, `members`, `position`); pass `onRemove={setRemovingRepayment}` (or the mutation trigger) into `LoanHistory`; each repayment `<li>` gains a small ghost destructive "Remove" button (self-identifying label, `aria-label={`Remove repayment of ${formatTaka(repayment.amount)}`}`); confirm dialog mirroring the existing remove-loan dialog ("Remove this repayment? The ৳X repayment from <date> will be soft-deleted and the loan's outstanding recovers."). Read the enclosing component for exact state/mutation patterns before editing.
- [ ] **Step 6: Verify pass** — `bun test --timeout 60000 src/api/loans/ src/agent/` + `bun run check-types`.
- [ ] **Step 7: Commit** — `git commit -am "feat: delete a single loan repayment — dashboard + agent delete surface"`

## Task 7: GLOSSARY rule + full verification

**Files:**
- Modify: `GLOSSARY.md` (add the domain rule)

- [ ] **Step 1: GLOSSARY** — add one line near the date/definitions section: `Record dates (loans, repayments, contributions, expenses, transfers, joining, status) are never in the future — today is the latest, at the Asia/Dhaka clock.`
- [ ] **Step 2: Full suite** — `cd apps/web && bun test --timeout 60000` — all PASS (111+ tests + new ones).
- [ ] **Step 3: Typecheck** — `bun run check-types` at web (and root `turbo run check-types` if quick).
- [ ] **Step 4: Browser pass** — `bun dev` + varlock env: verify (a) each record form's calendar disables tomorrow, (b) agent panel: "record a repayment of ৳4,000 for <member>'s loan" → list_loans → preview card → approve → repayment appears, (c) repayment Remove works and outstanding recovers.
- [ ] **Step 5: Commit + push** — `git add -A && git commit -m "docs: glossary — record dates are never in the future" && git push origin main` (squash-fixups if needed first). Vercel deploys; user does the live Telegram acceptance.
