# Mobile Chat Density Design

## Goal

Make PBK's phone chat surfaces feel like a real mobile messaging app: the seller messages stay visible, the composer is reachable, and the page itself does not jump while typing. Desktop layouts should keep their current density and workspace feel.

## Scope

- Unified Inbox conversation page at `/inbox/conversations`.
- Ava Chat at `/ava-chat`.
- The Paradise shell behavior needed by those full-height routes.

## Layout Contract

- The shell owns viewport height, top chrome, favorites, and the mobile nav.
- Full-height chat routes opt out of shell scrolling so their internal timeline owns the scroll.
- Unified Inbox must not reserve mobile bottom-navigation space a second time.
- Ava Chat must size to the shell content area with `h-full max-h-full`, not hard-coded `100dvh` subtraction.
- On narrow phones, Ava's quick prompts and disclaimers are hidden or compacted so the message list keeps at least one meaningful message row visible.

## Non-Goals

- Do not redesign desktop.
- Do not change bridge, sender, approval, or local-command behavior.
- Do not tackle the broader contracts/approval/lead-form backend slices in this patch.

## Verification

- Static regression smoke asserts route-aware shell ownership, no duplicate Unified Inbox inset, and no stale Ava height math.
- Existing Unified Inbox, Ava Chat, and production boot smoke tests stay green.
- Browser check at narrow mobile widths verifies message timeline and composer remain visible.
