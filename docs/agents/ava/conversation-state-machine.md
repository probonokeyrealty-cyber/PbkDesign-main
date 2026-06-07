# Conversation State Machine

Ava advances through explicit phases. She may briefly answer a seller's question
from a later phase, but she must return to the current evidence gap before asking
for commitment.

| Phase                    | Entry criteria              | Exit criteria                                                                    | Permitted tools                                                               | Required evidence                                                    |
| ------------------------ | --------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Trust                    | Call or thread starts       | Seller engages with a rapport or purpose question                                | `recallConversationMemory`, `retrieveClosingIntelligence`                     | `trustEstablished`                                                   |
| Participant verification | Trust opened                | Name, role, authority, address, and contact identity are known or marked unknown | `classifyParticipant`, `getParticipantProfile`, `checkDNC`                    | `participantsIdentified`                                             |
| Discovery                | Participant verified        | At least three useful seller facts are captured                                  | `getPropertyData`, `retrieveSimilarDeals`                                     | `discoveryComplete`                                                  |
| Motivation               | Discovery active            | Primary motivation and timing pressure are captured                              | none required                                                                 | `primaryMotivation`                                                  |
| Economics                | Motivation captured         | ARV, repairs, seller ask, debt, and MAO/RBP range are known or marked missing    | `analyzeDeal`, `recordRepairs`                                                | `maoCalculated`                                                      |
| Path selection           | Economics complete          | Best deal path is selected with rationale                                        | `selectContextAwareScript`                                                    | `pathSelected`                                                       |
| Objection resolution     | Path presented              | Objections are resolved, deferred, or escalated                                  | `selectContextAwareScript`, `retrieveClosingIntelligence`, `getProsodyAdvice` | `objectionsCleared`                                                  |
| Commitment               | Objections resolved         | Seller gives verbal yes, counter, exact next meeting, or clear no                | none required                                                                 | `verbalCommitment`, `counterOffer`, `specificCallback`, or `clearNo` |
| Approval                 | Commitment or risky action  | Approval is approved, queued, or not required                                    | `createApproval`, `sendNegotiationApproval`, `validateProviderActionSafety`   | `approvalStatus`                                                     |
| Follow-up                | Call or thread reaches exit | Next action is recorded or sequence is scheduled                                 | `scheduleAppointment`, `startNurtureSequence`, `updateCRM`                    | `nextAction`                                                         |

## Transition rules

- Phases advance in order unless the operator overrides and the override is
  logged.
- Ava may not present an authoritative offer before economics are complete.
- Ava may not ask for a signature before participant authority is clear.
- If the seller refuses, Ava may ask one clarification question and then must
  respect the answer.
- If the seller says "call me later," Ava must convert that into a specific
  callback time or mark the follow-up as unresolved.
