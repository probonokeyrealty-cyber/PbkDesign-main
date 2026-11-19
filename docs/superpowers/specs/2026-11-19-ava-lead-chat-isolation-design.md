# Lead-linked Ava chat continuity

## Intent and evidence

The founder asked to keep enhancing agent workflows within the original Command Center and previously required one lead at a time with explicit actions. The research inspector and its clarity pass are live. AvaChat currently reads leadId/lead_id from the URL but uses three global localStorage keys for operator draft memory, assistant session and completed exchanges. React also retains the same route component when just the lead query changes. This creates a concrete continuity gap: draft/history/session can belong to a different linked lead. Reproduce it in an isolated browser fixture before implementation.

Standing direction allows autonomous refinement without further design questions. No Composio credential is created or configured in this slice; that approval is still separate.

## Approaches

Only filter the visible draft, clear all history on every lead change, or isolate the existing conversation state by linked lead. Choose isolation: filtering leaves the session/history request context shared, while clearing loses continuity. Keep the existing general operator chat and its legacy keys intact; linked leads get separate keys without guessing ownership of old unscoped data.

## Design and authority

Use a small pure scope resolver for raw useLocation().search validation and storage-key selection. No linked-lead query means the existing general operator scope and existing three storage keys. Exactly one valid nonempty leadId or lead_id means that exact lead scope and three collision-free lead-specific keys. Reject duplicate identifiers, both aliases together, empty/trimmed/control-character identifiers, identifiers over256 UTF-16 code units, malformed percent/UTF-8 encodings or Unicode and an over4000-code-unit raw query. Strictly form-decode parameter names once, so encoded aliases count as duplicates; malformed parameter names fail closed, while malformed values of unrelated parameters are irrelevant. Preserve exact lead case, normalization and interior ordinary spaces. Nonempty raw search must begin with a question mark. Invalid explicit context shows an inline PBK warning and link to the general chat; it must not silently mount a different conversation. Lead keys use `pbk:ava-chat:lead:${encodeURIComponent(leadId)}:` plus the original suffix, distinct even for IDs named general or containing literal percent escapes.

Split the exported route into a scope-reading wrapper and a keyed existing session component. The key depends only on canonical lead identity, so alias spelling or unrelated query changes do not reset the same lead. Lead changes remount the existing session UI, invoking existing stream/STT/TTS cleanup and resetting draft/action/local conversation state. Do not create a new composer, route, controller or chat product. Ava supervises and Rex stays in Brain.

The session component uses only its scope's keys. Preserve existing completed-only normalization,30-exchange retention, bounded draft-memory behavior and explicit Resume draft control. Old global history stays accessible only in the general operator chat; do not copy it into linked lead storage. Gate persistence with restored state, not a ref set synchronously before stale initial write effects run, so initial empty state cannot erase saved conversation history. Browser storage getter/get/remove/set failures must leave chat usable in memory, with no cross-scope fallback. A slot whose initial read throws must remain unwriteable for that session mount, avoiding a later successful write erasing unseen saved data.

Navigating or resuming a draft must never submit a command, invoke research, save CRM data, request microphone permission or play speech. A pending assistant stream must be aborted on lead change; its late result cannot populate the new scope or persist under its keys. Already accepted backend actions remain governed by existing runtime and approvals. The global operational command/approval queue remains unchanged; it is not a lead-specific chat history and must not be silently filtered or deleted.

## UX and limits

Preserve original graphite/sky/amber tokens, typography, shell, mobile navigation and current composer controls. The existing lead-context indicator continues to identify linked chat. Add only a short scope hint near saved-draft continuity if needed for clarity. Invalid context uses existing warning/link styling. This is browser conversation continuity, not a server authorization boundary or cross-device synchronization feature. Manually quoted content may discuss another lead; no semantic rewriting/filtering is introduced.

## Acceptance

An isolated fixture must first show leadA's saved draft/history/session leaking into leadB under the original code, without any live provider or CRM action. After the fix, seed distinct A/B/general data and navigate A→B→A without full-page reload: each scope keeps its own history, session and resumable draft. Submitted fixture requests include only the current lead/session/history and context.search after an explicit click. MemoryRouter fixtures synchronize their real browser URL before in-memory navigation to preserve the existing window.location request contract. Switching mid-stream aborts and ignores late results; opening, switching and resuming produces zero submits. General legacy storage remains unchanged by linked conversations. Invalid/ambiguous lead queries mount no chat session. Storage denial does not crash the page. Alias and unrelated query changes preserve the same scope. Existing Ava desktop/WebKit mobile proof and release gates remain green.
