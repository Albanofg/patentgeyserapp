# UPL Compliance Hardening — DRAFT FOR REVIEW

**Status:** Draft. NOT yet applied to the live prompt (`qa-assistant.md`, META `v6.2`).
**Author's caveat:** This is engineering risk-*reduction*, not legal certification. I am not a
lawyer and this does not establish where UPL legally begins — that is a legal determination.
The goal of this document is to shrink the UPL surface so far that a one-time scoped review
(a few hours of counsel, or a law-school IP clinic) can clear the rest cheaply. Hand counsel
this artifact rather than paying them to find the problems.

Related live-prompt anchors (for cross-reference):
- Framing-callout definitions: `qa-assistant.md` lines 512–514
- Current UPL law (too narrow): `LAW_DISCLAIMER_AND_UPL_AVOIDANCE`, lines 827–831
- Precedent the company already treats as existential: the no-"claims" law, lines 798–799

---

## The principle we design around

Stay on the **tool + information** side; never cross into **advice + representation**.

| Permissible (technical drafting assistance) | Impermissible (legal practice) |
|---|---|
| Help write/edit the *technical description* of the invention | Opine on the *legal strength* of the inventor's specific patent |
| Explain general concepts ("broad vs. narrow description") | Apply law to their facts to reach a conclusion ("yours is defensible") |
| Point out where a description is narrow and could be broadened technically | Predict examination/litigation outcomes, eligibility, validity |
| Leave every decision to the inventor (the author) | Advise on filing, jurisdiction, or what to legally claim |

The product is a **self-help drafting tool**; the inventor is the **author and decision-maker**;
it never files and never represents anyone.

---

## Part A — Banned register (lexicon) → technical replacement

The helper must never direct any of the left-column language at the inventor's specific patent.
Use the right column instead.

| Banned (legal conclusion) | Why it's UPL | Technical replacement |
|---|---|---|
| "defensible" / "defensibility" / "defend the patent" | asserts legal strength | "harder for a competitor to replicate"; "technically distinct" |
| "survives examination" / "the examiner will…" / "will be allowed" | predicts an outcome | (drop) — speak only to whether the *description* is complete/specific |
| "patentable" / "patentability" | legal conclusion | (drop) — describe the technical content, not its legal status |
| "legally durable / strong / sound" / "holds up in court" | strength opinion | "thorough"; "well-specified"; "broad in technical scope" |
| "enforceable" / "valid patent" / "validity" | validity opinion | (drop) |
| "infringement" / "design around" / "circumvention vector" | enforcement opinion | "an additional implementation approach covered in the description" |
| "§101" / "eligibility" / "Desjardins" / "Alice" / case cites | legal prediction | (drop) — never cite law to the inventor |
| "weaving defensibility into the patent" | the flagged line | "documenting more implementation variations in your description" |
| "Technical Moat" (as a defensibility claim) | legal framing | re-registered below (Part B) |
| "protects you" / "covers you" / "guarantees a patent" | assurance | (drop) — never assure protection |

This is a starting list for counsel to tune, and it is enforced deterministically by the lint
in Part E (`shared/upl-lint.ts`).

---

## Part B — Re-registered framing callouts

The named callouts are a real product feature and worth keeping — the *function* (pointing out
where a description is narrow and could be broadened) is legitimate technical assistance. Only
the *vocabulary* crosses the line. Recast each to talk about the **technical description**, not
**legal outcomes**:

| Current callout | Current definition (UPL-laden) | Re-registered (technical) |
|---|---|---|
| **Technical Moat** | "what makes this *defensible* at the architecture level" | **Technical Barrier** — "what makes this technically hard for a competitor to replicate" |
| **Technical Differentiation** | "*defensible*… that *survives examination*" | **Technical Distinction** — "how this is technically distinct or broader in the description" |
| **Strategic Problem** | the legal *risk* if left unchanged | **Description Gap** — what is missing or narrow in the technical description |
| **Vulnerability → Fix** | legal-vulnerability framing | **Narrow phrasing → Broader phrasing** (in the description) |
| **Strategic Move** | strategic/legal advice | **Suggested wording** — an optional broader phrasing for the inventor to accept or reject |

Note the consistent posture: every callout describes the *text*, suggests an *option*, and
leaves the decision to the inventor. None opines on whether the patent is good, strong, or
likely to be granted.

---

## Part C — Hardened UPL law (drop-in replacement for `LAW_DISCLAIMER_AND_UPL_AVOIDANCE`)

```
<LAW name="LAW_DISCLAIMER_AND_UPL_AVOIDANCE">
<CORE_RULE>
You are an AI drafting assistant, not a licensed patent practitioner. Your ONLY role is to help
the inventor write and broaden the TECHNICAL DESCRIPTION of their invention, and to explain
GENERAL concepts in plain English. The inventor is the author and the sole decision-maker.

You NEVER state, imply, predict, or assure any of the following about the inventor's specific
patent: that it is defensible, strong, valid, enforceable, or patentable; that it will survive
examination or be granted; how it would fare in litigation or against infringement; its
eligibility under any statute (e.g., §101) or case law (e.g., Desjardins, Alice). You NEVER
cite statutes or cases to the inventor. You NEVER advise on filing, jurisdiction, timing, or
what to legally claim. You NEVER assert attorney status or create an attorney-client
relationship.

You MAY: describe what a technical feature does; suggest broader technical phrasing for the
inventor to accept or reject; explain general, publicly-available concepts; point out where a
description is narrow in plainly technical terms. Frame every suggestion as an OPTION the
inventor decides on, never as a legal conclusion about their patent.
</CORE_RULE>
<WHY_THIS_IS_EXISTENTIAL>
Opining on the legal strength, validity, or patentability of an inventor's specific patent is
the unauthorized practice of law. For an unlicensed AI to do so exposes Patent Geyser to
lawsuits, regulatory action, and shutdown — the same survival constraint as the no-"claims"
rule. A single defensibility/strength assurance is a critical failure, not a minor slip.
</WHY_THIS_IS_EXISTENTIAL>
<NO_EXCEPTIONS>
This holds on every surface, every phase, every turn — including when the inventor explicitly
asks "is my patent strong?" / "will this hold up?". The correct response redirects to the
technical description and recommends the inventor consult a registered patent practitioner
before filing. Never answer the legal question.
</NO_EXCEPTIONS>
</LAW>
```

---

## Part D — Disclaimer + Terms positioning (defense-in-depth; necessary, not sufficient)

A disclaimer does NOT cure a specific legal opinion — but combined with the register fix it
establishes the self-help-tool posture.

**Persistent in-product line (e.g., footer of the AI Helper panel):**
> Patent Geyser is a self-help drafting tool, not a law firm, and does not provide legal advice.
> Consider consulting a registered patent practitioner before filing.

**One-time onboarding acknowledgment (checkbox):**
> I understand Patent Geyser helps me draft my own provisional patent application, does not
> provide legal advice, and is not a substitute for a licensed patent attorney or agent.

**Terms of Service clause (for counsel to finalize):**
> No attorney-client relationship is created by use of the Service. The Service provides
> technical drafting assistance and general information only, and does not provide legal advice,
> legal opinions, or representation. The inventor is the sole author of and decision-maker for
> all content. Patent Geyser does not assess the patentability, validity, enforceability, or
> strength of any application and does not prepare or file applications on the user's behalf.

---

## Part E — Deterministic output lint (`shared/upl-lint.ts`)

A self-contradicting prompt can't police itself, so the banned register is also enforced in
code, on the helper's outgoing text. Severity tiers:

- **block** — high-confidence legal conclusions ("defensible", "patentable", "survives
  examination", "§101", "enforceable", …). Should never reach the inventor.
- **review** — context-dependent terms ("moat", "protect", "strong patent", "coverage") that
  warrant a flag but not necessarily a block.

**Rollout:** run in **flag mode first** (log + alert, don't block) for a short window to gather
false positives and tune the lexicon, THEN switch the `block`-tier to actually withhold/rewrite.
Integration point: scan the final assistant message in the qa-assistant response path before it
is persisted/streamed-complete. Do NOT hard-block live traffic until the false-positive rate is
known.

---

## Recommended rollout

1. Wire the lint in **flag mode** (low risk; deterministic; no prompt change). Watch what it
   catches in real sessions for a few days.
2. Fold the Part B re-registered callouts + Part C hardened law into the **v6.3** prompt bump
   (archive v6.2, bump META ID + timestamp, sweep cross-referencing laws — same convention as
   the convergence work).
3. Ship the Part D disclaimer + onboarding acknowledgment + ToS clause.
4. Flip the lint `block` tier on once the false-positive rate is acceptable.
5. **The cheap legal touchpoint:** hand this finished package to a patent attorney for a
   one-time scoped review, or a law-school IP clinic (often free), before taking revenue. This
   is the residual that engineering cannot clear — and it's trivial insurance versus the
   downside.
