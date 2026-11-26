# Property intelligence browser qualification

The older `property-intelligence-browser-smoke.mjs` fixture waited for address autocomplete and automatic recorded-sales refreshes. Those expectations predated the unified, explicitly triggered property-intelligence workflow. The check failed before reaching its useful comp handoff and call-workbench assertions.

The updated fixture uses the built React shell and the existing `/api/property-data/enrich` contract. All records are fictional, all remote requests are aborted, and the bridge configuration points to the local fixture origin. Font requests may be attempted by the built shell but are blocked along with all other remote traffic. No production credentials, leads or providers are used.

## Run

```sh
npm run build
npm run test:property-intelligence-browser
```

Playwright Chromium and WebKit must already be installed. Release Qualification installs them and runs this check after its existing build and CRM evidence suite.

## Assertions

- Typing an address makes no enrichment request or CRM write. Explicit unlinked refresh stays draft-only and preserves manually entered facts.
- An in-flight enrichment cannot fill fields belonging to a different draft address.
- Opening a lead, reloading saved evidence, sorting, or changing radius makes no enrichment request. Refresh captures the exact canonical lead and property address.
- A rejected comp save changes no canonical comps; an explicit retry persists the reviewed selection, which survives reload.
- Failed refresh retains saved evidence and reviewed comps. Radius changes retain the saved search until another explicit refresh.
- Successful refresh also preserves an operator-reviewed selection, its original sales capture time, and saved search radius. The fixture calls the real property-intelligence patch composer rather than duplicating its persistence rules.
- Reviewed comps reach the linked Analyzer; explicit Save retains edits and comps across reload.
- Call notes survive view changes and reload and are recorded against the correct fictional lead after the existing blur trigger. No call or message is sent.
- A late canonical lead response cannot replace the next lead's Analyzer state.
- The complete flow fits Chromium at 1440 and 320 pixels and iPhone-width WebKit at 390 pixels.

The existing CRM evidence suite remains responsible for detailed record datasets, comp-specific photos, duplicate-address lead isolation, and comparison layout. This check adds the end-to-end comp-to-Analyzer-to-call-workbench continuity proof. It does not establish live provider coverage or authorize underwriting or outreach.

No product, design, runtime, credential or deployment settings change in this maintenance revision.
