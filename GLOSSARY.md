# DreamDev

Single team savings fund: members commit to monthly Shares, money lives in the team's Bank Accounts, and members can take interest-free Loans from the fund.

## Language

### People

**Team**:
The single group this app serves. One team per installation.
_Avoid_: organisation, workspace

**Member**:
A person who saves in the Team's fund. Members never log in; they are records managed by Users.
_Avoid_: user, account holder, customer

**User**:
A login account (Admin or Editor) that manages the Team's data.
_Avoid_: member

### Shares & Billing

**Share**:
A unit of monthly saving commitment. A member's share quantity is fixed when they join and only an Admin may change it.
_Avoid_: unit, slot, installment

**Share Price**:
The taka amount one Share costs per month. One global price for the whole Team (৳5,000 today); when changed, the new price applies from that month forward and past months never change.
_Avoid_: rate, fee

**Joining Date**:
When a member started in the Team. The first billed month is derived from it.
_Avoid_: start date, registration date

**Exit**:
A member leaving the Team. Billing stops at the exit month.
_Avoid_: leaving, closing, deactivation (that's for Users)

**Inactive**:
A Member paused from Billing without leaving the Team (e.g. abroad). Billing skips Inactive months and resumes on reactivation.
_Avoid_: paused, dormant, suspended

**Billing**:
The rule that each calendar month a member owes Share quantity × Share Price, from their joining month until their exit month.
_Avoid_: invoice, charge

### Money In

**Contribution**:
A savings payment by a member, credited to a Bank Account.
_Avoid_: saving, deposit, payment

**Credit Date**:
The date money actually entered the Bank Account. The only date a money-in record carries.
_Avoid_: payment date, transaction date

**Record dates are never in the future**:
Every record date (loan date, Credit Dates, expense and transfer dates, Joining Date, status effective date) is today or earlier, at the Asia/Dhaka clock. Only share-change months may point at future months.
_Avoid_: post-dated, scheduled dates

**Advance**:
Money contributed beyond what a member owes; carried forward against future billing.
_Avoid_: prepayment, credit

**Due**:
What a member currently owes the fund: total billed minus total contributed. Negative Due is an Advance.
_Avoid_: arrears, balance, loan (loans are separate)

**Adjustment**:
A manual correction to a member's Due history: opening due, waived month, or forgiveness.
_Avoid_: write-off, correction

### Loans

**Loan**:
Money a member takes from the fund. Always interest-free.
_Avoid_: advance (conflicts with Advance), borrowing, credit

**Loan Repayment**:
Money returned against a Loan, credited to a Bank Account.
_Avoid_: payment, installment

### Bank Accounts

**Bank Account**:
The Team's own account at a bank. The app may track several.
_Avoid_: bank, wallet, account (alone)

**Opening Balance**:
The amount a Bank Account held when it was added to the app.
_Avoid_: initial amount, starting balance

**Current Balance**:
What a Bank Account holds now: Opening Balance plus every money-in entry minus every money-out entry. Always derived from the ledger, never typed in.
_Avoid_: total amount, final balance

**Expense**:
Money leaving a Bank Account that is not a Loan: bank charges, cash withdrawals.
_Avoid_: withdrawal, charge, cost

**Transfer**:
Money moved between the Team's own Bank Accounts.
_Avoid_: movement, internal transaction

### AI Agent & Telegram

**Fund Assistant**:
The AI agent inside the dashboard (floating panel) and on Telegram for linked Users. It looks up anything and may record or remove records — always through a Confirm Gate, acting as the signed-in User.
_Avoid_: bot (alone), chatbot, AI (alone)

**Confirm Gate**:
The mandatory pause before the agent writes anything: a card (web) or inline keyboard (Telegram) shows the canonical values from the database, and nothing is recorded until the User approves. Reject and expiry record nothing. Deletes show the record's human identifier (name + amount) and never hard-delete.
_Avoid_: confirmation dialog, approval flow (alone)

**Pairing Code**:
A single-use, 15-minute code binding one Telegram chat to one identity — a dashboard User (full assistant) or a Member (notifications only). Sent as a `t.me/<bot>?start=CODE` link.
_Avoid_: invite code, token

**Notification-Only**:
A Member's Telegram channel: they receive messages about their own records and nothing else. The bot replies "notification-only" to anything a Member sends.
_Avoid_: read-only, member bot
