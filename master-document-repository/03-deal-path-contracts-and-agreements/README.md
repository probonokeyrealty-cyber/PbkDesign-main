# 03 - Deal Path Contracts & Agreements

This folder mirrors the executable contract paths in `/contracts`.

Executable contract paths:
- `contracts/cash-offer`
- `contracts/retail-buyer-program`
- `contracts/creative-finance-agent`
- `contracts/mortgage-takeover-agent`
- `contracts/land`

How to update a path:
- Put broad reference materials in this repository folder.
- Put Contract Lawyer runtime files in `/contracts/<path-id>/`.
- Runtime files are `fields.json`, `negotiation.md`, and optionally `template.pdf`.
- Ask Rex to reload contract templates or call `POST /api/contracts/reload`.
