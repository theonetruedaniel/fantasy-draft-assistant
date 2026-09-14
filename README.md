# Draft Companion

A Chrome MV3 side-panel advisor for Yahoo and ESPN fantasy football snake drafts. It reads the visible draft page, gives up to five available recommendations and explains roster needs. It never submits picks or changes a queue.

## Public source edition

This repository publishes Daniel Abrams' draft-advisor implementation with AI assistance. Personal research, captured league pages and machine-specific setup records are excluded. Import your own research or use the small synthetic example in `examples/`.

## Install

Build with Node.js 22 or newer:

```powershell
npm ci
npm test
npm run build
```

In Chrome's extensions manager, enable Developer mode, choose **Load unpacked**, and select `outputs/draft-companion`. Open a Yahoo or ESPN football draft, refresh its page, then click the extension icon. Confirm the room's scoring, starter slots, bench size and your slot in **Draft settings**. Presets are assumptions.

For an update to the same installed folder, click **Reload** on the extension card, refresh the draft page, and reopen the panel. Reloading the extension alone does not replace an existing content script.

## Research and recommendations

The public distribution contains no personal research. Import a CSV or JSON file through the panel. Every record needs a name, position, source, snapshot date and either a rank, tier, projection or substantive note. JSON may include `players`, full `narrative`, `sections`, `sources`, `datasets`, `season` and `rankBasis`. See `extension/core/import.js` for the normalized fields.

Local ordering uses imported editorial priorities and tiers, then roster needs. Comparable research projections can reorder players of the same position, tier and nearby rank band using the configured scoring. Complete-pool projection mode additionally requires sufficient replacement depth; a visible-only pool cannot establish that. Research upside can break a nearby bench tie within its supplied price window. It cannot promote a late sleeper over an early-round foundation merely because of a tag. Optional research flags can withhold HOLD/VERIFY/OUT names pending a source update. K/DST entries marked late-only enter in the actual final two rounds.

Unknown site matches remain identified as fallback. Abbreviated-name matching requires consistent team/position and a unique identity; ambiguous matches are refused. Missing components stay missing. Partial TE receiving totals are never treated as complete projections. Historical regression evidence remains descriptive and does not automatically become a future point forecast.

Availability is limited to the mounted player rows (especially ESPN's virtual list). Use the Players tab, All positions, no search, and exclude drafted players. No imported name is declared available just because it exists in a research file. The panel reports this limitation.

## Optional background AI

Local research advice is immediate and works without AI. Run `node relay/server.mjs` with `DRAFT_RELAY_TOKEN` (a random 16+ character local secret) and `DRAFT_EXTENSION_ID` (the installed Chrome extension ID). Keep this process running during the draft.

Choose **Local Codex** in the panel to use the installed `codex` app-server and its managed ChatGPT sign-in. If needed, sign in using Codex's normal sign-in flow. No API key or extracted account token is used. Enter an explicit available model ID and low or medium effort; the verified personal configuration is `gpt-5.3-codex-spark`, low. The panel takes only the separate relay token. Leave that field blank to reuse a token already saved for this browser session. Provider/model/effort choices persist locally; after a browser-session reset the panel preserves those choices, stays in research-only mode, and asks for the token again. Reopening a panel reflects the saved connection; unsaved form edits are protected. This starts independent, ephemeral recommendation requests, not the existing voice conversation. Codex usage limits still apply.

Alternatively choose **OpenAI API** and set `OPENAI_API_KEY` outside the extension. API billing is separate. API mode retains its explicit model and optional effort controls. No silent model substitution is allowed.

The bridge accepts only localhost, the configured extension origin and its token. Codex receives a compact shortlist, research rationale, roster/scoring and bye context. It runs with a read-only sandbox, shell/search/MCP/plugin/app tools disabled and action requests rejected. Requests debounce for 600ms; unchanged board heartbeats do not call AI; identical successful contexts are cached for one minute. Changed contexts cancel/ignore stale work. A 24-second client deadline keeps local advice available on errors.

AI may reorder only the current legal shortlist. **Generated AI prose is not displayed:** the cards and research details retain source-backed local explanations. A successful response proves the connection and valid keys, not that the model's preferred order is objectively superior. Historical personal connection checks are not latency guarantees.

## Research and bye coverage

Users supply their own research and statistics. Missing data remains unknown. Historical performance is distinct from a forecast; bye coverage is a roster consideration rather than a predicted score.

## Evidence and distribution

`npm test` covers state transitions, scoring, import identity/provenance, roster legality, early QB context, late upside and AI failure handling. Private captures and original research are intentionally not in the public source archive; their tests skip when absent.

Do not publish `work/`, `outputs/`, `private/`, credentials, captured league pages or user research. The optional `--local-research` build switch copies a user-prepared profile into the local installed folder only. Its seed loads once into extension local storage when there is no existing research; it preserves custom settings, existing imports and a deliberate clear. Public packaging must exclude that seed.

Version 0.1.2 includes the Yahoo overall-pick and own-turn corrections, explicitly numbered history, ESPN row-action IDs and safe promotion of temporary player identities. Older reader session caches are not carried into the new reader versions. Missing history remains visibly incomplete; genuine conflicting numbered history still suspends advice until reconciled by a complete history read. Completed drafts have a terminal screen and retain previously observed slot/settings.
