# PBK Command Center - Master Document Repository

This repository is the source-of-truth folder system for PBK training, scripts, deal-path agreements, PDF packages, legal/compliance files, and version history.

Operational notes:
- Keep the Investor Yield Calculator inside the PBK Command Center only. Do not create or maintain a separate Excel file for it.
- Put executable contract path files in `/contracts/<path-id>/` so the bridge and Contract Lawyer can load them.
- Put broader training, script, and package material here so Rex can ingest and reference it.
- When a contract path changes, update the matching `/contracts/<path-id>/fields.json` and `negotiation.md`, then call `POST /api/contracts/reload` or ask Rex to reload contract templates.

Top-level groups:
- `01-training-and-protocol`
- `02-scripts-master`
- `03-deal-path-contracts-and-agreements`
- `04-pdf-packages-and-templates`
- `05-legal-and-compliance`
- `06-updates-and-version-log`
