# Pitch: slides and 3-minute video script

Record the video against the **replay** (`argus replay`, works with the market
closed) and cut in one live screenshot of the paper ledger. Lead with the
number; governance gets one slide, because every other entry has it.

## Slides (8)

1. **Title.** ARGUS — does the AI earn its inference bill? One line: same
   shortlist, two deciders, one paired number.
2. **The gap.** 47 options-track entries; ~a dozen say "LLM proposes, code
   decides"; none measure the LLM's contribution. Screenshot of five
   submission one-liners with "least-trusted component" highlighted.
3. **The experiment.** Diagram: snapshot → ~48 candidates → quant picks / AI
   picks → governor → Alpaca (AI's pick) → mark both from same quotes → Δ.
   Emphasise "AI cannot write a trade, only choose or abstain."
4. **The scoreboard.** Live board screenshot: AI minus quant, n, changed
   decisions, coverage, CI, inference cost, evidence state.
5. **One disagreement.** A real cycle where quant went bearish SPY (trend) and
   Gemini went bullish QQQ ("bullish_bias", conf 0.7) — and what it cost or
   earned. This is the memorable slide.
6. **Governance in one slide.** 17 gates, hash-bound authorization, kill
   switch, Alpaca CLI reconciliation. Say "table stakes" out loud.
7. **Evidence.** Hash-chained ledger, claim manifest with statuses, credential-
   free replay, 27 tests. "AI beats quant: UNSUPPORTED" shown deliberately.
8. **What this is for.** Any team can drop their own LLM policy into the AI
   arm and get the same paired number. Repo, board, account ID.

## Video script (≈3:00)

**0:00–0:20 — Hook (board on screen).**
"Almost every agent in this hackathon says the LLM proposes and code decides.
Fine. But does the LLM add anything? ARGUS is the only entry built to answer
that. This number — AI minus quant, after every cost — is the product."

**0:20–0:55 — How it works (slide 3, then terminal).**
"Every twenty minutes ARGUS freezes an Alpaca snapshot of SPY and QQQ option
chains and builds every five-dollar-wide vertical — debit spreads near forty
delta, credit spreads near thirty — about forty-eight candidates, each with its
max loss, quoted spread, realized-versus-implied vol, term slope and trend. A deterministic quant picks one by a
registered rule. Gemini gets the identical packet and picks one, or abstains.
It can't write a trade; it can only choose. `argus run` — here's a cycle."

**0:55–1:30 — One decision (slide 5 + ledger).**
"Here the quant went bearish SPY because the twenty-day trend is down. Gemini
went bullish QQQ — 'bullish bias, low spread, good risk-reward', confidence
0.7. Both are marked from the same quotes every cycle. ARGUS trades the AI's
pick on the paper account; the quant's pick is scored as the counterfactual.
This one cost the AI [X] dollars against the control."

**1:30–2:00 — Governor and Alpaca (slide 6).**
"Before any order, seventeen checks re-observe quotes and the account: a
fixed max loss per position, an aggregate cap, no stacking the same spread,
nothing new in the last hour before flatten. Approval is a sixty-second token
bound to the proposal hash. Orders go through alpaca-py as multi-leg limits
with deterministic client IDs; after every cycle the official Alpaca CLI reads
positions back and the ledger records whether broker and ledger agree."

**2:00–2:35 — Evidence (slide 7).**
"Every event is hash-chained. Every number on the board maps to a claim with
its source hash and the command that reproduces it. Replay runs with no
credentials. And the claim 'AI beats quant' is published as UNSUPPORTED —
because with 40 observations that's the honest state, and the apparatus is
the point."

**2:35–3:00 — Close (slide 8).**
"Swap in your own model or prompt and you get the same paired number. Paper
account PA3OAPMCFQAY, repo and live board in the description. ARGUS: does the AI earn
its inference bill? Now you can find out."

## Recording notes

- Terminal font ≥ 18 pt, dark theme; board in the browser at 125% zoom.
- Show `argus verify` output (chain ok) for two seconds; judges notice.
- Do not say "profit". Say "paired net difference".
- Alpaca's official FAQ: equity snapshot EOD Thursday 3 Sep; no UI required;
  "winners will not be selected based on P&L alone". Say the last line in the
  video — it frames the paired number as exactly what they asked for.
