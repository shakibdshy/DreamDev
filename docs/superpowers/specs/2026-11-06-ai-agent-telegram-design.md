# AI Agent + Telegram Integration — Design

Date: 2026-11-06
Status: Approved (design review complete with Shakib)

## Summary

Add an AI agent that performs full CRUD on the fund's records through chat, and a
Telegram integration with two capabilities: (1) Admin/Editor chat with the same
agent without opening the dashboard, and (2) automatic Telegram notifications to
the specific member a new record belongs to, with the record's details.

Core principle: **the LLM never touches the database.** Agent tools are thin
wrappers over the existing `src/api/<domain>/service.ts` functions, so every
write passes the same zod validation, domain invariants (share-price snapshots,
FIFO repayment, ledger integrity), and role guards as dashboard writes.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Telegram audience | Admin/Editor chat with agent; members are receive-only (notifications about their own records) |
| LLM | GLM-5.3-Flash via OpenAI-compatible endpoint |
| SDK | TanStack AI (`@tanstack/ai` + `@tanstack/ai-openai-compatible` + `@tanstack/ai-react`) |
| Architecture | One agent loop, two transports (web SSE + Telegram webhook) |
| Write scope | Full CRUD with a mandatory confirm gate; deletes double-gated |
| Notification events | All member-touching events; recipient is exactly the affected member |
| Web UI | Floating chat panel on all pages |
| Rejected | Direct-DB agent tools (bypasses domain invariants — unsafe for a financial ledger); separate command bot (kills chat UX) |

## Architecture

```
Floating chat panel ──SSE──►┐
                            ├─► Agent loop (TanStack AI) ──► tools = existing services ──► Postgres
Telegram webhook ──fetch───►┘            │
                                    interrupt = confirm card (web) / inline keyboard (TG)
                                            │
                                on write ──► notifyMemberEvent() ──► member's Telegram chat
                                                                    └─► NotificationLog
```

## New modules (apps/web/src)

```
agent/
  agent.ts          # loop construction: model adapter, tool registry, interrupt config
  prompt.ts         # system prompt generated from GLOSSARY.md domain rules
  context.ts        # acting-user context (session OR telegram link); role-filters tools
  tools/            # one file per domain; thin wrappers over service.ts functions
    contributions.ts loans.ts repayments.ts expenses.ts transfers.ts
    adjustments.ts  members.ts banks.ts dashboard.ts (read-only)
telegram/
  client.ts         # raw Bot API client (sendMessage, answerCallbackQuery) — plain fetch, no SDK
  webhook.ts        # update parsing + secret verification + dedupe by update_id
  pairing.ts        # pairing-code issue/validate
  notify.ts         # notification templates + send + NotificationLog writes
routes/api/agent/chat.ts        # SSE endpoint (session auth) for the web panel
routes/api/telegram/webhook.ts  # single Telegram webhook (secret-token header auth)
components/agent/AgentPanel.tsx # floating button + slide-over + confirm cards
```

Conventions follow the existing `src/api/<domain>/{service,http,schema}.ts` pattern.

## Schema changes (packages/db)

| Change | Purpose |
|---|---|
| `User.telegramChatId String? @unique`, `telegramLinkedAt DateTime?` | bind Admin/Editor chats |
| `Member.telegramChatId String? @unique`, `telegramLinkedAt DateTime?`, `notifyEnabled Boolean @default(true)` | bind member chats (receive-only) |
| New `TelegramPairingCode`: `code`, `targetType` (user/member), `targetId`, `expiresAt` (15 min), `usedAt`, `createdBy` | single-use deep-link pairing (`t.me/<bot>?start=CODE`) |
| New `AgentConversation` / `AgentMessage` | chat history for both transports + full audit (tool called, args, result) |
| New `NotificationLog`: `memberId`, `type`, `recordId`, `status` (sent/failed/skipped-no-chat/disabled), `telegramMessageId`, `error`, `@@unique([recordId, type, memberId])` | dedupe + retry + delivery audit |

Chat IDs are stored as `String` (not BigInt) to avoid serialization pain; Telegram
chat IDs are exact when passed back as strings.

## Dependencies & environment

New packages: `@tanstack/ai`, `@tanstack/ai-openai-compatible`, `@tanstack/ai-react`.
No Telegram SDK — raw Bot API via a small fetch client (webhook parsing,
sendMessage, inline keyboards are plain JSON).

New env vars (via varlock): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
`AGENT_API_KEY`, `AGENT_BASE_URL`, `AGENT_MODEL`.

## Flows

### 1. Web chat with confirm gate (core loop)

1. User types in the floating panel (English or Bangla): "Rahim অক্টোবরে ৫০০০ কন্ট্রিবিউশন যোগ করো"
2. `POST /api/agent/chat` (SSE) → session user → agent context with role-filtered tools
3. LLM resolves the member (fuzzy name match via members list tool), builds args, calls the write tool
4. Tool **proposal phase**: validates args against the existing zod schema and assembles the preview (member, bank, running totals) via read queries only — **no write**
5. Interrupt → panel renders a confirm card with canonical DB values (member, ৳5,000, credit date, bank, note)
6. ✅ Approve → interrupt resumes → **execute phase** calls the real service → invariants run as in dashboard writes → notification fires
7. Agent replies with result summary (e.g. shares at entry)

Deletes: confirm card echoes the record's human identifier (name + amount) and
requires explicit approve; services are soft-delete. Interrupts expire after 10
minutes (no orphaned confirms).

### 2. Telegram chat (same brain)

Webhook (secret verified, `update_id` deduped) → chatId → linked Admin/Editor →
same agent loop → reply as Telegram message. Confirm cards become inline
keyboards (✅ Approve / ✖ Cancel); `callback_query` resumes the interrupt.
Unlinked chat → pairing instructions only.

### 3. Pairing — receive-only for members

Pairing exists only to create a receive-channel.

- **User (Admin/Editor):** Settings → "Connect Telegram" → code + `t.me/<bot>?start=CODE`, 15-min TTL, single use → bot binds chat, confirms name + role, full agent chat unlocked.
- **Member:** Admin generates the same code from the member detail page and shares the link (SMS/WhatsApp). Member taps Start → chat bound → bot replies "✅ You'll receive notifications about your fund records here."
- **Member sends anything else** → only response: "This bot is notification-only." No commands, no chat, no data access.
- Unlink (either side) revokes the binding immediately.

### 4. Notification — exactly one recipient

After any member-touching write, services call `notifyMemberEvent()`:

- Recipient is **only the member the record belongs to**. No broadcasts, no group chats.
- Records with no member attached (bank-to-bank transfers, expenses, general adjustments) → **no notification**.
- Covered events: contribution recorded/updated/deleted, loan created/status-changed/disbursed, repayment recorded, adjustment touching a member, shares allotted.
- Message includes: what happened, amount (৳, integer), credit date, bank (where meaningful), resulting running total (where meaningful).
- Member without linked chat → `NotificationLog` status `skipped-no-chat`; `notifyEnabled=false` → `disabled`.
- Send failure never fails the write; failed rows retry on the next touching write for that member.

## Guardrails

1. **No DB access for the LLM** — tools wrap services only; all invariants stay enforced
2. **Confirm gate on every write** — proposal → interrupt → human approve → execute; deletes double-gated
3. **Role scoping** — agent acts as the linked user; editor role filters out admin-only tools; user management (roles/passwords) excluded from the tool surface entirely, even for admins
4. **Attribution & audit** — all writes set `createdBy` = acting user; `AgentMessage` logs every tool call, args, result
5. **Prompt-injection defense** — confirm cards always show canonical DB values, never LLM-paraphrased text; free-text fields (names, notes) are treated as data, never instructions
6. **Sanity caps in the tool layer** (on top of zod): amount ∈ (0, ৳10,000,000]; creditDate ≤ 35 days in the future
7. **Rate limiting** — ~60 agent messages/hour per user; webhook replay protection via `update_id`
8. **Webhook authenticity** — `X-Telegram-Bot-Api-Secret-Token` must match env secret; TG↔user binding one-to-one and revocable

## Error handling

- LLM API down → "agent unavailable" (banner in panel / DM in TG); no partial writes
- Tool validation errors → returned to the LLM as tool errors so it self-corrects and re-asks the user
- Telegram send timeout (5s) → logged for retry; write already committed stands
- SSE disconnect mid-loop → interrupt expires (10 min); nothing half-written (proposal phase writes nothing)

## Testing

- **Tool unit tests:** proposal shape, zod passthrough, role filtering, sanity caps, member-name resolution
- **Agent loop integration tests (mock model adapter):** proposal→interrupt→approve→execute sequence; `createdBy` attribution; `NotificationLog` row; **rejecting** the confirm card produces zero writes
- **Pairing tests:** expiry, single-use, wrong-target rejection
- **Webhook tests:** bad secret rejected, replay dropped, member "notification-only" reply
- **Notification templates:** snapshot per event type
- Existing 111 service tests unchanged; notify hooks injectable (no-op in tests)

## Build order (8 steps, each shippable)

| # | Step | Delivers |
|---|------|----------|
| 1 | Schema (User/Member telegram fields, PairingCode, AgentConversation/Message, NotificationLog) + migration | DB ready |
| 2 | Telegram foundation: BotFather bot, env vars, `client.ts`, webhook route + secret verification + dedupe | bot alive |
| 3 | Pairing flows both sides + unlink/revoke | identities bound |
| 4 | Agent core: GLM adapter, tool registry over services, GLOSSARY-derived prompt, interrupt confirm gate, role filtering | the brain |
| 5 | Web transport: SSE route + floating `AgentPanel` + confirm cards | dashboard chat |
| 6 | Telegram transport: webhook → agent loop, inline-keyboard confirms | TG chat for Admin/Editor |
| 7 | Notifications: post-write hooks, templates, NotificationLog, retry-on-next-write | member DMs |
| 8 | Hardening + tests + `setWebhook` deploy script + GLOSSARY/ADR entry | production-ready |

Steps 2–3 (Telegram identity) and 4–5 (web agent) are independent and parallelizable.

## Operations

- One bot via BotFather; bot username embedded in deep links
- `setWebhook` run once from a script with the secret token (webhook mode — no long-polling process; Vercel-compatible)
- Secrets via varlock like existing env
- Vercel function durations: agent SSE 30–60s max; TG webhook <10s — well within limits
- Cost: GLM-5.3-Flash per-message pricing, a few cents per conversation at team scale; rate limit caps abuse

## Explicitly out of scope (v1)

- Member chat/query access to the agent (receive-only)
- Telegram interactions beyond Approve/Cancel inline keyboards (no file uploads, no media)
- User management via agent (roles, passwords, deactivate)
- Group-chat notifications or broadcasts
