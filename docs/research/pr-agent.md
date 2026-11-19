# PR-Agent — research notes

Primary-source research on the PR-Agent repository (`The-PR-Agent/pr-agent`), gathered from the repo itself, its PyPI package, its docs site, and related vendor pages. All stats captured 2026-11-19.

## 1. Identity and history

- Canonical repo: `The-PR-Agent/pr-agent` — https://github.com/The-PR-Agent/pr-agent
- Same repository, not a fork: repo created 2023-07-05, GitHub repo id 662766482 (https://api.github.com/repos/The-PR-Agent/pr-agent).
- Old org URLs 301-redirect to the new org: `github.com/Codium-ai/pr-agent` → `github.com/The-PR-Agent/pr-agent` (verified via HTTP headers), and `github.com/qodo-ai/pr-agent` → same (verified via HTTP headers).
- The repo was donated by Qodo to the community: README states "Qodo has donated PR-Agent to the open-source community… fully community-owned… first external maintainer, Naor (@naorpeled)… in the process of being donated to an open-source foundation" (https://github.com/The-PR-Agent/pr-agent#big-news-for-pr-agent).
- Repo description: "The Original Open-Source PR Reviewer. This project is not the Qodo free tier." (https://github.com/The-PR-Agent/pr-agent)
- Qodo is now listed as Gold Sponsor of the OSS project; maintainer sponsorship via github.com/sponsors/naorpeled (https://github.com/The-PR-Agent/pr-agent#sponsors).

## 2. What it is; tools/commands

- Open-source AI-powered code-review agent for pull requests; answers and suggestions are posted as PR comments or returned via CLI (https://github.com/The-PR-Agent/pr-agent).
- Definitive command list from docs (https://docs.pr-agent.ai/commands/):
  - `/describe` — PR title, type, summary, code walkthrough, labels
  - `/review` — review feedback on issues, security concerns, tests, review effort
  - `/improve` — committable code suggestions
  - `/ask "..."` — free-text Q&A about the PR or specific code lines
  - `/add_docs` — generate docs for undocumented components
  - `/generate_labels` — custom labels based on the diff; custom labels must be enabled in host configuration with `config.enable_custom_labels = true` (host-only, not settable from a repo `.pr_agent.toml`), then defined in `[custom_labels]` — see the [custom-label example](https://docs.pr-agent.ai/commands/generate_labels/#defining-custom-labels) (https://docs.pr-agent.ai/commands/generate_labels/)
  - `/similar_issue` — find similar issues (issue-scoped command)
  - `/help` — list available commands
  - `/update_changelog` — update CHANGELOG.md from PR changes
  - `/help_docs` — Q&A over a docs folder — **disabled since v0.36.1** pending a credential-exposure fix (issue #2445) (https://github.com/The-PR-Agent/pr-agent/issues/2445)

## 3. Supported platforms

From the official support matrix (https://docs.pr-agent.ai/overview/supported_platforms/):
- Git providers: GitHub, GitLab, Bitbucket Cloud, Bitbucket Server, Azure DevOps, Gitea.
- Also registered: Gerrit and AWS CodeCommit (no dedicated install pages; reduced feature set) (https://docs.pr-agent.ai/overview/supported_platforms/#gerrit-and-codecommit).
- Diff-only modes (no hosting platform): local git provider, plain-diff (stdin/file), MOSAICO A2A server (https://docs.pr-agent.ai/overview/supported_platforms/#diff-only-providers).
- Trigger styles per provider: comment command, tagging bot, GitHub Actions / GitLab pipeline / Bitbucket pipeline / Azure DevOps pipeline (https://docs.pr-agent.ai/overview/supported_platforms/).

## 4. Deployment modes; open source vs paid

Open source (this repo):
- CLI: `pip install "pr-agent[github]"` then `pr-agent --pr_url <URL> review`; provider SDKs are optional extras (`pr-agent[all]` for all) (https://github.com/The-PR-Agent/pr-agent#cli-usage-local-development).
- GitHub Action: `uses: the-pr-agent/pr-agent@main` (Docker-based action, `action.yaml` + `Dockerfile.github_action_dockerhub`) (https://github.com/The-PR-Agent/pr-agent/blob/main/action.yaml).
- Docker: images at `pragent/pr-agent` on Docker Hub since 0.34.2; legacy `codiumai/pr-agent` namespace frozen at ≤ v0.31 (https://github.com/The-PR-Agent/pr-agent#docker-hub-namespace-migration, https://hub.docker.com/r/pragent/pr-agent).
- Self-hosted webhook server / GitHub-style App (FastAPI/uvicorn apps) (https://docs.pr-agent.ai/overview/supported_platforms/).
- PyPI package `pr-agent` (https://pypi.org/project/pr-agent/).

Commercial/hosted (separate from this repo):
- Qodo Merge (formerly PR-Agent Pro), the hosted/enterprise version, has been rebranded and evolved into "Qodo" ("Qodo 2.0"), a full AI code-review platform (https://github.com/The-PR-Agent/pr-agent#big-news-for-pr-agent).
- Qodo offers a free tier for open-source projects and is the OSS repo's Gold sponsor (https://www.qodo.ai/solutions/open-source/, https://github.com/The-PR-Agent/pr-agent#sponsors).
- A GitHub Marketplace listing **does exist** as [The PR Agent](https://github.com/marketplace/actions/the-pr-agent) (checked 2026-11-19). The earlier 404s were for other slugs (e.g. `github.com/marketplace/pr-agent`) and do not prove that no listing exists.

## 5. License and tech stack

License (current and history, traced via LICENSE file commits):
- Current: MIT, "Copyright (c) 2026 The PR Agent" (https://github.com/The-PR-Agent/pr-agent/blob/main/LICENSE).
- History: Apache 2.0 from initial commit 2023-07-05 → changed to AGPLv3 on 2025-05-22 (commit 70428ebb) → back to Apache 2.0 on 2026-05-20 (commit fdbcecc8) → MIT on 2026-07-09 (commit d7e94bc2) (https://github.com/The-PR-Agent/pr-agent/commits/main/LICENSE). It is *not* Apache 2.0 today.
- The historically Apache-2.0 assumption no longer holds; note the 2025–2026 license churn when doing license diligence.

Stack:
- Python `>= 3.12`; package `pr-agent`; build via setuptools, deps locked with uv (`uv.lock`) (https://github.com/The-PR-Agent/pr-agent/blob/main/pyproject.toml).
- LLM layer: LiteLLM, pinned `litellm==1.109.1` (https://github.com/The-PR-Agent/pr-agent/blob/main/pyproject.toml).
- Web/server: FastAPI, starlette, uvicorn/gunicorn; config via dynaconf; pydantic 2; GitPython, unidiff, tiktoken; telemetry via Langfuse + OpenTelemetry + Prometheus client (https://github.com/The-PR-Agent/pr-agent/blob/main/pyproject.toml).

## 6. Supported LLM providers

- "PR-Agent supports LiteLLM's native model providers and third-party endpoints that implement the OpenAI-compatible or Anthropic-compatible API" (https://docs.pr-agent.ai/usage-guide/changing_a_model/).
- Named providers in docs/README: OpenAI (default model `gpt-6.1-sol`, fallback `gpt-6-luna` in `configuration.toml`), Anthropic Claude, Google Gemini / Vertex AI, Azure OpenAI (incl. Azure AD auth via `pr-agent[azure]`), DeepSeek, Mistral, xAI Grok, Groq, SambaNova, Hugging Face Inference Endpoints, Replicate, OpenRouter, AWS Bedrock, Databricks, and local models via Ollama or vLLM (https://github.com/The-PR-Agent/pr-agent#platform-agnostic, https://docs.pr-agent.ai/usage-guide/changing_a_model/).
- Fallback chain configured via `config.model` + `config.fallback_models`, with retries/fallback on 429/5xx (https://docs.pr-agent.ai/usage-guide/changing_a_model/).

## 7. Repo health (as of 2026-11-19)

- Stars: ~16.4k (16,398); forks ~2,220 (https://api.github.com/repos/The-PR-Agent/pr-agent).
- Issues: 16 open, 1,357 closed; PRs: 25 open, 3,547 closed (https://api.github.com/search/issues?q=repo:The-PR-Agent/pr-agent).
- Commits: ~6,610 total; ~100 in the 30 days before 2026-11-19; last push 2026-11-19 (https://api.github.com/repos/The-PR-Agent/pr-agent/commits).
- Contributors: 417 (https://api.github.com/repos/The-PR-Agent/pr-agent/contributors).
- Releases: 42 releases, earliest v0.7 (2023-09-20); latest v0.50.0 (2026-11-07); releases roughly every 2–4 weeks (https://github.com/The-PR-Agent/pr-agent/releases).
- PyPI: `pr-agent` 0.50.0 published 2026-11-08; 26 releases on PyPI (https://pypi.org/project/pr-agent/).
- Active and maintained as of Nov 2026; explicitly community-maintained (not vendor-run) (https://github.com/The-PR-Agent/pr-agent).

## 8. CI integration (GitHub Actions)

Official quick-start workflow from the README (https://github.com/The-PR-Agent/pr-agent#github-action-recommended):

```yaml
# .github/workflows/pr-agent.yml
name: PR Agent
on:
  pull_request:
    types: [opened, synchronize]
  issue_comment:   # lets PR comment commands (/review, /ask, ...) start the workflow
jobs:
  pr_agent_job:
    if: ${{ github.event.sender.type != 'Bot' && (github.event_name == 'pull_request' || github.event.issue.pull_request) }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
      pull-requests: write
    steps:
    - name: PR Agent action step
      uses: the-pr-agent/pr-agent@main
      env:
        OPENAI_KEY: ${{ secrets.OPENAI_KEY }}
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- Triggering: on `pull_request` events the action runs automatically; PR-Agent skips `synchronize` by default — auto-run commands are controlled by `github_action_config.pr_actions`, and push-triggered commands by `github_action_config.handle_push_trigger` (https://github.com/The-PR-Agent/pr-agent#github-action-recommended). Fork caveat: with the plain `pull_request` event, forked PRs run without repository secrets (`OPENAI_KEY` is empty) and with a read-only `GITHUB_TOKEN`, so the review cannot complete or publish; use `pull_request_target` for fork support (https://docs.pr-agent.ai/installation/github/#using-with-pull_request_target-forkcontribution-support, https://docs.github.com/en/actions/writing-workflows/events-that-trigger-workflows#pull_request).
- Otherwise, any command (`/review`, `/improve`, `/ask "..."`) is invoked by posting it as a comment on the PR; the agent replies in the same PR (https://docs.pr-agent.ai/commands/#usage-examples).
- CLI equivalent: `pr-agent --pr_url <PR_URL> review` (https://docs.pr-agent.ai/commands/#usage-examples).
- Setup guide: https://docs.pr-agent.ai/installation/github/#run-as-a-github-action
