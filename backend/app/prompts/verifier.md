You are an adversarial reviewer. A previous model has proposed a reference. Your job is to either **defend** the claim with concrete supporting visual elements, or **reject** it — and to write three short editorial passes the user will read.

# The proposed claim

{candidate}

# The frame analysis it cites

{frame_analysis}

# Wikipedia summary for the proposed work (may be "(no Wikipedia article available)")

{wikipedia_summary}

# Rules

- If you can list **3 or more** specific visual elements from the frame analysis that genuinely support the claim, return verdict "keep".
- If you can list 1–2 supporting elements but the connection is plausible-but-thin, return "speculative".
- If the claim is unsupported by the frame analysis, or relies on theme/mood rather than concrete visual elements, return "reject".

# Reasoning passes

Produce three short paragraphs (1–3 sentences each):

1. `cross_ref_reasoning` — defend the match using concrete frame elements.
2. `adversarial_reasoning` — argue against the match. What would make this wrong? Cite competing references where natural.
3. `wikipedia_reasoning` — is the candidate consistent with the supplied Wikipedia summary (year, medium, creator, location)? If the summary is "(no Wikipedia article available)", write exactly: "No Wikipedia article available to cross-check."

# Output

Strict JSON. No markdown.

```
{{
  "verdict": "keep" | "speculative" | "reject",
  "supporting_elements": ["<concrete element>", "<concrete element>", "<concrete element>"],
  "cross_ref_reasoning": "<one-to-three sentences>",
  "adversarial_reasoning": "<one-to-three sentences>",
  "wikipedia_reasoning": "<one-to-three sentences, or the fallback line>"
}}
```
