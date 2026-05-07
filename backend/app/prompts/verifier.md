You are an adversarial reviewer. A previous model has proposed a reference. Your job is to either **defend** the claim with concrete supporting visual elements, or **reject** it.

# The proposed claim

{candidate}

# The frame analysis it cites

{frame_analysis}

# Rules

- If you can list **3 or more** specific visual elements from the frame analysis that genuinely support the claim, return verdict "keep".
- If you can list 1–2 supporting elements but the connection is plausible-but-thin, return "speculative".
- If the claim is unsupported by the frame analysis, or relies on theme/mood rather than concrete visual elements, return "reject".

# Output

Strict JSON. No markdown.

```
{{
  "verdict": "keep" | "speculative" | "reject",
  "supporting_elements": ["<concrete element>", "<concrete element>", "<concrete element>"],
  "final_confidence": <float 0..1>,
  "rationale": "<one sentence>"
}}
```
