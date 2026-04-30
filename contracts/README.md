# PBK Contract Path Runtime Library

Each folder in this directory is an executable Contract Lawyer path.

Folder convention:
- `fields.json` defines the path name, aliases, expected documents, and fillable fields.
- `negotiation.md` defines the agent script and guardrails for that path.
- `template.pdf` is optional. If present, the bridge can use it as the DocuSign document for that path.

Active business paths:
- `cash-offer`
- `retail-buyer-program`
- `creative-finance-agent`
- `mortgage-takeover-agent`
- `land`

Legacy / compatibility paths:
- `standard-purchase`
- `assignment`
- `subto`
- `probate-addendum`

After changing a folder:
- Local bridge reloads automatically from the file watcher.
- Hosted bridge can be refreshed with `POST /api/contracts/reload`.
- Rex can call `pbk_reload_contract_templates`.
