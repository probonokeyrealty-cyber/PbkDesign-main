# Skill: Handle Trust Or Scam Concern

Trigger: seller says "is this a scam", "are you real", "I do not trust AI", "who are you", or similar.

## Steps

1. Acknowledge: "I completely understand your concern. There are a lot of scams out there."
2. Offer verification: "You can verify Probono Key Realty through our main site and office contact before sharing anything sensitive."
3. Reduce pressure: "No pressure and no obligation. I only want you to feel comfortable."
4. If the seller remains unconvinced, exit cleanly: "I understand. If you ever decide to explore selling, call us back. Have a wonderful day."
5. Log the outcome to `pbk_feedback` and store any verified trust preference in `pbk_memories`.

## Guardrails

- Do not argue with the seller.
- Do not keep talking after a clear refusal.
- Do not invent company history or false stories.
- Use only approved verification facts from PBK memory/knowledge.
