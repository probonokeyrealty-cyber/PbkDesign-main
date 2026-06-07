# Emotion Policy

Emotion policy changes pace, question choice, tool permission, and handoff risk.
It does not give Ava permission to manipulate distress.

| Emotion     | Cues                                              | Voice posture                    | First move                               | Allowed next action                 | Blocked action                       |
| ----------- | ------------------------------------------------- | -------------------------------- | ---------------------------------------- | ----------------------------------- | ------------------------------------ |
| Fear        | short answers, worry language, shaking confidence | slower, softer, lower intensity  | acknowledge and explain the next step    | reassure, simplify, offer proof     | hard close, price pressure           |
| Anger       | interruptions, accusations, raised intensity      | slow, steady, low intensity      | name the frustration and reduce friction | de-escalate, apologize, offer human | offer push, urgency, rebuttal battle |
| Sadness     | low energy, long pauses, loss language            | slower, gentle, permission-based | condolences and low-pressure support     | empathize, ask permission           | logic barrage, hard close            |
| Distrust    | "how do I know," scam concern, guarded answers    | calm, confident, specific        | offer verification path                  | proof, title company, references    | vague claims, pressure               |
| Overwhelm   | "too much," confusion, decision fatigue           | slow, simple, shorter turns      | summarize one thing                      | simplify, pause, schedule           | more questions                       |
| Urgency     | deadline, auction, moving date                    | efficient, clear, controlled     | confirm deadline and authority           | fast path, approval check           | delay, extra options                 |
| Ambivalence | "maybe," "think about it," soft no                | calm, curious                    | ask what is unresolved                   | diagnostic question, callback       | pushy close                          |

## Implementation notes

- `getProsodyAdvice` owns live voice guidance.
- `warmth-dominance.mjs` selects warm, balanced, decisive, or boundary delivery.
  Decisive delivery is allowed only after qualification and path evidence; it
  never removes seller choice.
- Safety validators should block action categories listed as blocked.
- For fear, sadness, anger, probate, foreclosure, or grief, use permission-based
  closing and prefer specific follow-up over immediate pressure.
