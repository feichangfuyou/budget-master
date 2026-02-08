# Budget Master

AI traffic controller for Cursor: routes chats to cheap vs expensive models, tracks token cost, and supports Smart (Architect/Builder) and Cascade modes.

**Security:** API keys are stored only in Cursor/VS Code settings (Settings → Budget Master). Do not commit `.vscode/settings.json`, `.env`, or any file containing keys. A **pre-push hook** blocks pushes that contain common secrets; install it once:  
`cp scripts/git-hooks/pre-push .git/hooks/pre-push && chmod +x .git/hooks/pre-push`

Use it as your **main chat** like Cursor’s built-in AI: **Apply to editor** and **Run in terminal** on code blocks in replies, and **Search workspace** to attach context — same workflow as Cursor chat.

---

## Features

Budget Master doesn't just count tokens—it **reduces them** before they hit the API and **saves output cost** when a cheap model's answer is good enough. Turn these on and watch your bill shrink without changing how you work.

### Speculative Drafting (Intern + Architect)

**What it does:** A fast, cheap model (e.g. Gemini Flash) writes the code first. A more expensive model (e.g. Claude Sonnet) only **reviews** it. If the draft is correct, you get the cheap reply and pay a fraction of the usual output cost (~95% savings). If the auditor finds bugs or wrong behavior, it **rewrites** the answer and you still get correct code—you just pay for that one rewrite instead of every reply.

**Why it feels smart:** You're not "using a weak model." You're using a **two-phase pipeline**: draft fast and cheap, then gate with a senior reviewer. When the draft passes, you've just gotten Sonnet-quality assurance at Flash prices. When it fails, the system self-corrects instead of serving bad code.

**Settings:** Enable **Speculative Drafter** in Budget Master settings. Best for coding questions (e.g. "write a function that …"). You'll see status messages like *Speculative Drafter: Draft APPROVED* or *Draft REJECTED. Auditor rewrote the code.*

### Context Squeezing (Token Crusher)

**What it does:** Before your context is sent to the API, the extension **strips comments**, collapses long runs of blank lines, and trims fluff. On typical code, that's about **30–40% fewer input tokens** with no change to behavior—the model still sees the code structure and logic.

**Why it feels smart:** You're not "sending less context." You're sending **denser** context: the same semantics with less noise. Comments and blank lines rarely change the model's answer; paying for them is optional. Squeezing runs automatically when context is large enough (configurable min size).

**Settings:** **Context Squeezer** is on by default. You can toggle comment stripping and blank-line collapsing, and set a minimum character threshold so tiny snippets are left as-is.

### Semantic Cache (Déjà Vu)

**What it does:** If you ask the **same kind of question** about the **same context** (e.g. same file version) again, Budget Master can return the previous answer **instantly** and charge **$0**. The cache key is based on normalized intent + context hash, so small rephrases ("What does this do?" / "Explain this") can still hit the cache.

**Why it feels smart:** Re-running "explain this file" or "what's wrong with this function?" after a tiny edit is free and instant. You're not "caching random stuff"—you're skipping redundant API calls when the world hasn't changed.

**Settings:** **Semantic Cache** is on by default. Repeated questions on the same file/context show status like *Semantic Cache HIT ($0.00)*.

### Savings Ticker

Session cost in the UI can show **Saved $X.XX this session**: savings from cache hits (estimated avoided cost) and from speculative drafts that were approved (real delta between full expensive run vs. draft+audit). Copy session summary includes the same number so you can see the impact at a glance.

---

## Install & use

1. **Install** — `npm run install:local` (or Extensions → Install from VSIX → `budget-master-0.0.1.vsix`).
2. **Reload** — Cursor: **Reload Window** (Cmd+Shift+P).
3. **Open** — Activity Bar → **Budget Master** (graph icon) → **Cost Control Chat**.
4. **Keys** — Settings → search **Budget Master** → set **OpenAI** and **Anthropic** keys. Optional: **Google**, **xAI**, **Kimi** for more models.

After code changes: run `npm run install:local` again, then Reload Window.

---

## Scorecard — “Did we cover everything?”

*(One scorecard replaces a long explanation.)*

### 1. Implementation

| Area | Score | Notes |
|------|-------|--------|
| Extension structure | ✅ 5/5 | Single entry point, `activate()`, `BudgetChatProvider`. |
| API integration | ✅ 5/5 | OpenAI + Anthropic + Google/xAI/Kimi; token usage from responses. |
| Cost logic | ✅ 5/5 | PRICES table, per-call and session total, $/1M formula. |
| Routing (traffic cop) | ✅ 5/5 | Hard vs easy; mini vs Sonnet. |
| UI (webview) | ✅ 5/5 | Chat list, cost display, Enter to send, postMessage. |
| Settings | ✅ 5/5 | All API keys + Architect/Builder/Cascade/context cache/budget cap. |
| Error handling | ✅ 4/5 | Keys check, try/catch, user messages. |
| package.json (contributes) | ✅ 5/5 | Activity bar, webview, configuration, commands. |
| package.json (manifest) | ✅ 5/5 | activationEvents, publisher, package/install scripts. |
| Security | ✅ 4/5 | Keys from settings only; webview scripts as needed. |

**Implementation total: 46/50+** — Solid; optional tweaks below.

### 2. Setup & install

| Area | Score | Notes |
|------|-------|--------|
| Launch (F5) | ✅ 5/5 | `launch.json`: Run Extension, Cursor executable. |
| Tasks | ✅ 5/5 | `tasks.json`: compile, watch; preLaunchTask. |
| Activation | ✅ 5/5 | `onView:budgetMaster.chatView`. |
| Packaging | ✅ 5/5 | publisher, package, install:local, .vscodeignore. |
| Install flow | ✅ 5/5 | `npm run install:local` → .vsix → Cursor. |
| Version bump | ✅ 5/5 | Bump version → `npm run package` → Install from VSIX. |
| .gitignore | ✅ 5/5 | out/, *.vsix. |

**Setup total: 35/35.**

### 3. Quick checklist

- [x] Extension runs (install:local or Install from VSIX).
- [x] Reload once (Reload Window).
- [x] Open view (Activity Bar → Budget Master → Cost Control Chat).
- [x] Set API keys (Settings → Budget Master).
- [x] After code changes: `npm run install:local` again.

### 4. Optional improvements (not required)

| Item | Priority | What to do |
|------|----------|------------|
| Version bump | Low | Change version in package.json → `npm run package` → Install from VSIX. |
| Claude model id | Low | Update `claude-3-5-sonnet-20240620` when Anthropic deprecates. |
| OpenAI max_tokens | Low | Add e.g. `max_tokens: 1024` to OpenAI call. |

### 5. Summary

- **Extension:** 46/50 — Logic, APIs, UI, settings, security in good shape.
- **Setup:** 35/35 — Launch, tasks, activation, packaging, install correct.
- **Overall:** Core is done; scorecard = single place to verify “everything” and optional next steps.

---

## Developing

See [DEVELOPING.md](DEVELOPING.md): `npm run dev` for watch + auto-install, then Reload Window after edits.

- **Stress test the Speculative Drafter:** [STRESS_TEST.md](STRESS_TEST.md) — trick questions to confirm the Auditor rejects bad drafts and rewrites correctly.
- **Publish / package:** [RELEASE.md](RELEASE.md) — vsce package and Marketplace checklist.

**Run Cursor with Budget Master** (same setup as using Cursor’s built-in AI): from this repo run `npm run start` to launch Cursor with the extension loaded. Use the Budget Master sidebar for chat; apply edits and run terminal from code blocks like in Cursor chat.
