# Public-Release Documentation — Design

**Date:** 2026-11-14
**Status:** Approved (user chose "Approve — run it")

## Goal

Prepare the DreamDev repo for going public on GitHub as a **portfolio piece**:
documentation that leads with the product and the AI-agent story, a license,
curated screenshots, and repo hygiene — without exposing anything sensitive.

## Decisions (user-locked)

| Decision | Choice |
|---|---|
| Audience | Portfolio piece (recruiters/interviews) — no contributor docs |
| License | MIT, `Copyright (c) 2026 shakibdshy` |
| Internal dev docs (`docs/superpowers/`, `docs/agents/`, `AGENTS.md`) | Stay public; linked from README as the engineering-process story |
| Visuals | Screenshots only — no live demo link, no demo credentials |

## Approach chosen

**A — README-first portfolio package.** One excellent README as the single
entry point; depth lives behind links to existing specs/ADRs/glossary.
Rejected: B (expanded docs tree — duplicates ADRs/specs, maintenance drag),
C (patch scaffold README — wastes the differentiators).

## Deliverables

1. **`README.md` rewrite** (portfolio tone, ~200 lines):
   hero + one-line pitch + two hero screenshots; features grounded in the
   actual route/agent-tool inventory (verified against code, not memory);
   a dedicated AI-agent section (TanStack AI API, AG-UI, tools-over-services
   per ADR-0004, needsApproval interrupt/resume, Telegram pairing);
   architecture mermaid diagram; engineering-process section linking specs,
   ADRs, GLOSSARY; accurate local-dev quickstart; short deployment note;
   MIT license section; "personal project" one-liner instead of CONTRIBUTING.
2. **`LICENSE`** — MIT text.
3. **`docs/screenshots/`** — fresh screenshots from a seeded local instance
   via headed browser (consistent data, current UI). Not the stale
   `gui-test-screenshots/` ticket artifacts.
4. **Hygiene** — untrack `gui-test-screenshots/`, gitignore it. Everything
   else stays tracked. No CONTRIBUTING, no SECURITY.md.
5. **Publish prep** — gitleaks-style sweep over full git history; `gh` repo
   description + topics; final commit. **Going public is the user's action** —
   hand over the one command, do not flip visibility.

## Out of scope

Repo rename (DreamDev is the product name), live demo, git history rewrite
(history verified clean: no .env files ever committed, no token patterns in
tracked files).

## Success criteria

- README front-loads product + agent story with real screenshots.
- Every factual claim (features, test count, scripts) verified against the
  codebase at execution time.
- `git log --all` sweep finds no secrets.
- Repo is commit-clean and one command away from public.
