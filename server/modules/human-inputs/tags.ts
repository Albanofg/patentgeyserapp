// Controlled tag vocabulary for the human-input ledger. Each tag identifies
// what kind of content the user typed, NOT where they typed it (the `source`
// column carries that). The same tag can come from many sources — that's the
// whole point: when the Pannu pre-fill draws on a factor, it picks up every
// row tagged for that factor regardless of which module produced it.
//
// Pannu factor mapping is the load-bearing relationship: each Pannu factor
// (conception / quality / known_concepts) reads a fixed list of tags.
//
// Adding a new tag means:
//   1. Add it to HUMAN_INPUT_TAGS below.
//   2. Wire it into PANNU_FACTOR_TAGS so pre-fill picks it up.
//   3. Use it in the writer site for the module that produces that content.

export const HUMAN_INPUT_TAGS = [
  // Conception-bucket tags
  "conception_timeline",     // when/how the user first thought of the idea
  "conception_mechanism",    // the specific technical mechanism in the user's words
  "problem_narrative",       // the problem being solved, in the user's words

  // Quality-bucket tags
  "technical_advance",       // why this is non-trivial / not a routine combo
  "vs_obvious_combo",        // contrast with combining known parts
  "implementation_detail",   // concrete technical specifics

  // Known-concepts-bucket tags
  "prior_art_awareness",     // what the user knows already exists
  "differentiation",         // how the idea differs from existing solutions
  "whitespace_rationale",    // the white-space strategy reasoning

  // Cross-cutting / informational (not consumed by Pannu pre-fill)
  "free_text",               // user typed something that we want to keep verbatim but didn't classify
] as const;

export type HumanInputTag = typeof HUMAN_INPUT_TAGS[number];

export const PANNU_FACTORS = ["conception", "quality", "known_concepts"] as const;
export type PannuFactor = typeof PANNU_FACTORS[number];

export const PANNU_FACTOR_TAGS: Record<PannuFactor, HumanInputTag[]> = {
  conception: ["conception_timeline", "conception_mechanism", "problem_narrative"],
  quality: ["technical_advance", "vs_obvious_combo", "implementation_detail"],
  known_concepts: ["prior_art_awareness", "differentiation", "whitespace_rationale"],
};

// Inverse lookup — given a tag, which Pannu factor(s) does it feed?
export function pannuFactorsForTag(tag: string): PannuFactor[] {
  const out: PannuFactor[] = [];
  for (const factor of PANNU_FACTORS) {
    if (PANNU_FACTOR_TAGS[factor].includes(tag as HumanInputTag)) {
      out.push(factor);
    }
  }
  return out;
}

// Friendly source labels used when telling the user "this draft came from X".
// Keep these short — they render as chips in the Pannu UI.
export const SOURCE_LABELS: Record<string, string> = {
  "module0/qa-assistant": "AI Helper notes",
  "module1/idea-refinement": "Initial idea refinement",
  "module1/inspect": "Inspect & Refine notes",
  "module2/expansion": "Concept expansion",
  "module2/refinement": "Refinement feedback",
  "module2/extracted-ideas": "Extracted ideas",
  "module3/notes": "Prior art notes",
  "module4a/concept-notes": "White Space notes",
  "module4b/concept-rationale": "Key Concept rationale",
};

export function friendlySourceLabel(source: string): string {
  return SOURCE_LABELS[source] || source;
}
