# PBK Toast Notification and Brain Audit

Source: `index.html` in the modern PBK Command Center. Legacy `public/legacy` and `src/imports` pages are not part of the live modern surface audited here.

Total modern toast call sites: 124. One call is the core renderer; the rest are user-facing runtime notifications.

## Verbiage Improvements Applied

- Replaced operator-facing `OpenClaw` copy with `PBK Brain` where the user is taking an action, while keeping technical OpenClaw identifiers in code and plugin labels.
- Clarified local-only actions with language like `Ava context updated locally` and `previewed locally before campaign action`.
- Reworded Train Rex success from `coach memory lane` to `Rex training memory`.
- Replaced confusing shortcut/toast punctuation with plain ASCII labels such as `Ctrl/Command+K`.
- Tightened Rex prompts so the Brain page suggests specific research questions without odd punctuation.

## Detailed Toast Inventory

### Navigation and orientation

| Line | Type | Title | Description |
|---:|---|---|---|
| 12042 | default | [dynamic title] |  |
| 12406 | info | [dynamic title] | Set to "${next.label}" - Ava's next script preview will adapt. |
| 12424 | info | Path switched | Now using ${DEAL_PATH_LABELS[key]} - Ava context updated locally. |
| 12481 | info | Call script path updated | Loaded ${DEAL_PATH_LABELS[analyzerScriptPath.value] \|\| 'PBK'} call mode. |
| 12491 | info | Call script audience updated |  |
| 12506 | success | Ava call script updated | ${DEAL_PATH_LABELS[path] \|\| 'PBK'} ${analyzerScriptTab} guidance is now the active call-mode reference. |
| 12522 | success | Deal confirmed - Ava dialing | ${offer} - ${DEAL_PATH_LABELS[path] \|\| path.toUpperCase()} - close ${date} - contract template prepped |
| 12529 | info | Ava connecting... | Outbound call preview - TCPA window verified - recording disclosure ready |
| 12543 | info | Lead Portal strategy opened | Change the path, offer, contract route, and Ava notes here so the Lead Portal remains the source of truth. |
| 12549 | info | Lead filter preview active | ${filter.textContent.trim()} routing is previewed locally before campaign action. |
| 12556 | info | Path performance selected | ${path} rows are ready for the next analytics drill-down. |
| 12562 | info | Path table sorted | Rows are shown by conversion strength in this local view. |
| 12587 | warning | Approval needs live bridge data | This visible card is a static fallback. Connect PBK Brain or wait for approvals to sync before approving or declining. |
| 12699 | info | Keyboard shortcuts | Ctrl/Command+K palette - G+D dashboard - G+L leads - G+I inbox - A approve - ? shortcuts |
| 12724 | info | Marked all as read |  |
| 12928 | default | Analyzer ready | Enter an address to run ARV + MAO |
| 12929 | default | Add a new lead | Upload CSV or enter manually |
| 12931 | default | Outbound queue open | Pick a lead or start a batch |
| 12933 | info | Rex research ready | Type a research question in the right panel. |
| 12970 | info | Keyboard shortcuts | Ctrl/Command+K palette - G+D/L/I/B navigate - A approve - R decline - ? shortcuts |
| 13033 | info | [dynamic title] |  |
| 13232 | success | Tour complete | Press Ctrl/Command+K anytime to jump anywhere - ? for shortcuts. |
| 13562 | dynamic | [dynamic title] | ARV ${fmt(result.arv)} — MAO ${fmt(result.walkAway)} — profit ${fmt(result.estProfit)} |

### Bridge, approvals, and runtime actions

| Line | Type | Title | Description |
|---:|---|---|---|
| 14615 | success | PBK Brain connected | Command Center can now reach the Brain bridge. |
| 14630 | error | PBK Brain did not respond |  |
| 14882 | dynamic | [dynamic title] |  |
| 16836 | dynamic | [dynamic title] | Reconnect PBK Brain to replay this as a live approval callback. |
| 16856 | dynamic | [dynamic title] |  |
| 16865 | error | Approval action failed |  |
| 17005 | warning | PBK Brain endpoint missing | Open Settings and connect the Brain bridge before using ${actionLabel}. |
| 17019 | error | PBK Brain connection failed |  |
| 17098 | dynamic | ${title} · ${outcomeLabel(outcome)} |  |
| 17130 | error | [dynamic title] |  |
| 17164 | error | [dynamic title] |  |
| 17294 | error | [dynamic title] |  |
| 17400 | success | Draft ready | ${MESSAGE_STAGE_LABELS[stageValue] \|\| 'Follow-up'} copy loaded for ${safeContext.leadName \|\| 'this lead'}. |
| 17409 | warning | Message is empty | Write a message or generate one before sending. |
| 17431 | info | Give Ava a concrete command | Try "call Diane now", "analyze 202 Cherry Ln", or "send DocuSign to Robert Chen". |
| 17466 | warning | Skip trace fallback missed |  |
| 17484 | success | Ava is on it |  |
| 17492 | error | Agent command failed |  |
| 17719 | error | ${title} failed |  |

### Leads, campaigns, inbox, contracts, recordings

| Line | Type | Title | Description |
|---:|---|---|---|
| 17951 | info | Nothing to export | No visible rows matched the current filter. |
| 17955 | success | CSV exported | ${rows.length} visible rows were downloaded. |
| 18065 | success | Lead export ready | ${payload.length} lead rows were exported. |
| 19752 | success | Campaign export ready | CSV report downloaded from the current campaign view. |
| 20037 | warning | CSV needs campaign columns | Use headers like seller/name, address/property_address, phone, email, and tags. |
| 20426 | warning | CSV needs headers | Use columns like seller/name, address/property_address, phone, email, and tags. |
| 20450 | dynamic | [dynamic title] | ${imported.length} leads imported from ${file.name}${failed.length ? |
| 20510 | info | Command loaded | Press Send to hand it to Ava. |
| 20550 | success | Draft ready | PBK drafted a ${channel.toUpperCase()} follow-up for ${context.leadName}. |
| 20660 | success | Lead export ready | The current imported lead list was exported as JSON. |
| 20942 | warning | Analyzer preview unavailable | Open the analyzer and save the deal so the live document preview has a full package URL. |
| 20950 | info | Analyzer preview opened | The contract preview is coming straight from the analyzer package. |
| 20963 | dynamic | [dynamic title] |  |
| 20972 | error | Could not open the live PDF |  |
| 20986 | error | PDF sync failed |  |
| 21018 | info | Start from the analyzer | Load a deal in the analyzer first, then PBK can create the draft contract packet here. |
| 21067 | info | Audit trail lives in the runtime log | PBK Brain activity, approvals, DocuSign events, and DNC changes are all recorded in the live runtime surfaces. |
| 21282 | info | Agent logs opened | Activity Log is the current live-safe log surface. |
| 21536 | info | Playback speed updated | Speed set to ${button.textContent}. |
| 21546 | info | Playback paused | Secure recording playback paused. |
| 21558 | success | Playback started | Streaming from a short-lived Supabase signed URL. |
| 21563 | warning | Recording not playable yet |  |
| 21738 | info | Timeline filtered | ${shown} events visible. |
| 21953 | dynamic | [dynamic title] |  |
| 21965 | warning | Publishing with local draft | PBK will still attempt to publish the latest inspector values to n8n. |
| 21987 | dynamic | [dynamic title] |  |
| 22001 | error | Publish failed |  |
| 22130 | success | Analytics refreshed | ${button.textContent.trim()} is now using live bridge data. |
| 22133 | warning | Analytics range saved |  |
| 22146 | success | Analytics export ready |  |
| 22152 | warning | Drill-down unavailable |  |
| 22158 | success | Campaign drill-down refreshed | Campaign and lead-source rows are live from the bridge. |
| 22160 | warning | Drill-down unavailable |  |

### Brain, Rex, research, and analyzer

| Line | Type | Title | Description |
|---:|---|---|---|
| 22746 | info | Ask Rex something specific | Try "subject-to in Ohio", "probate follow-up timing", or "silent MAO". |
| 22785 | error | Rex could not answer |  |
| 22795 | warning | PBK Brain connection needed | Connect PBK Brain before ingesting documents into the research library. |
| 22819 | success | [dynamic title] |  |
| 22847 | warning | Attachment indexed without file storage |  |
| 22854 | error | Attachment ingest failed |  |
| 22900 | error | Ingest failed |  |
| 22924 | success | Brain export ready | ${docs.length} indexed sources and ${blogPosts.length} Brain Blog posts exported from the current runtime. |
| 22939 | warning | Post not found | Reconnect the bridge and refresh the Brain Blog feed. |
| 22968 | warning | Research job not found | Refresh the Brain page and try opening the BrowserOS result again. |
| 23017 | warning | Research job not found | Refresh the Brain page before retrying that BrowserOS request. |
| 23021 | info | Connect PBK Brain first | Reconnect the Brain bridge before retrying BrowserOS research. |
| 23044 | error | Retry failed |  |
| 23050 | warning | PBK Brain connection needed | Connect PBK Brain before training Rex on Brain Blog content. |
| 23069 | error | Training failed |  |
| 23075 | warning | PBK Brain connection needed | Connect PBK Brain before harvesting external sales research. |
| 23095 | error | Harvest failed |  |
| 23101 | warning | PBK Brain connection needed | Connect PBK Brain before running revenue agents. |
| 23120 | error | Audit failed |  |
| 23208 | error | ${config.title} failed |  |
| 23217 | info | Connect PBK Brain first | Connect PBK Brain before launching BrowserOS research from PBK. |
| 23256 | error | Browser research failed |  |
| 23386 | info | PBK Brain config saved | PBK will remember this endpoint on this machine. |
| 23409 | info | More plugin slots coming | PBK Brain is the first live bridge. Codex-local and custom MCP plugins can layer in next. |
| 23512 | info | Analyzer cleared | Start a fresh deal when ready. |
| 23519 | warning | Address needed first | Enter or sync a property address before saving this analyzer deal to the lead pipeline. |
| 23585 | warning | Empty note | Write a note before saving it to the lead timeline. |
| 23589 | warning | Lead context needed | Sync or enter a seller/property before adding analyzer notes. |
| 23601 | success | Note added | The analyzer note is now in the lead activity trail. |
| 23604 | error | Note failed |  |
| 23613 | warning | No follow-up date | Choose a date before setting the reminder. |
| 23630 | success | Follow-up set | Reminder saved for ${dueDate}. |
| 23633 | error | Follow-up failed |  |
| 23648 | warning | Address needed first | Enter or sync a property address before sending analyzer numbers to Ava. |
| 24077 | warning | Open the analyzer first | Load a property in the analyzer so the contract draft has a real address and seller context. |
| 24087 | warning | Contract draft needs a few more fields |  |
| 24654 | info | Analyzer synced |  |
| 24764 | warning | Address needed first | Open the analyzer, enter a property address, then ask PBK Brain to run the remote tool. |
| 24841 | info | Activity log open | Audit trail is now front and center. |
| 24847 | info | Recordings open | Call playback library is ready. |

### Admin and Ava voice

| Line | Type | Title | Description |
|---:|---|---|---|
| 25322 | dynamic | [dynamic title] | Reconnect PBK Brain to replay this as a live admin callback. |
| 25334 | dynamic | [dynamic title] | Rex and the bridge audit log were updated. |
| 25341 | error | Admin action failed |  |
| 25602 | dynamic | [dynamic title] |  |
| 25662 | dynamic | [dynamic title] |  |
| 25670 | error | Voice stream issue |  |
| 25678 | error | Ava voice could not start |  |
| 25692 | info | Tell Ava what to do | Type a command or use the voice-style button to stage one. |
| 25695 | success | Ava command staged | Command captured locally. Approval guardrails still apply before any live action. |

## Brain Functional Smoke Results

The latest hosted checks should cover: Brain Blog feed, Rex query, OpenAI web search with citations, Brain Blog harvest, Train Rex, readable operator summary, and Ava memory learning. See the final Codex response for the exact run results from the current verification pass.
