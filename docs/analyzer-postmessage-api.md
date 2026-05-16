# PBK Analyzer postMessage API

The PBK shell and embedded React analyzer communicate only with same-origin
`postMessage` events. Both sides must reject any message whose `origin` does
not match `window.location.origin`.

## Messages from analyzer to shell

- `pbk:analyzer:ready`: analyzer iframe is mounted and ready to receive shell
  state.
- `pbk:analyzer:state`: analyzer state changed. Payload includes `{ deal,
  activeTab, analyzeStatus, updatedAt }`.
- `pbk:analyzer:state-request`: analyzer is asking the shell to resend the
  canonical shell snapshot.

## Messages from shell to analyzer

- `pbk:analyzer:set-state`: direct state update for the iframe.
- `pbk:analyzer:shell-state`: shell-originated canonical state snapshot. The
  analyzer should merge this unless the user is actively editing a form field.

## Storage contract

Analyzer state uses environment-scoped keys:

- `pbk:{env}:analyzer:current-deal`
- `pbk:{env}:analyzer:saved-deals`
- `pbk:{env}:analyzer:activity`
- `pbk:{env}:analyzer:comps-cache`
- `pbk:{env}:analyzer:underwriting-presets`
- `pbk:{env}:analyzer:undo-stack`
- `pbk:{env}:analyzer:redo-stack`

Legacy keys such as `pbk-deal-data` and `pbk-saved-deals` are migrated into the
namespaced storage envelope and removed.
