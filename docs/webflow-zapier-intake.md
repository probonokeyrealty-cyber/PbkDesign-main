# Webflow to Zapier to PBK

Prepared November 2, 2026 from the connected Webflow account and PBK source.

## Connections

- Webflow site: Probono Key Realty (`6969944d1f878bbd2a6bf86a`).
- Website: https://www.probonokeyrealty.com
- PBK bridge: https://pbk-openclaw-bridge.onrender.com
- Zapier browser tab requires login before a Zap can be created or enabled.
- The Netlify connector requires reauthentication; the old Command Center hostname currently returns HTTP 404.

## Zap configuration

1. Trigger: Webflow, New Form Submission. Connect the PBK site above.
2. Filter: allow the seller/contact/appointment forms below. Exclude newsletter Email Form, ZIP lookup, and Holding Cost Explorer calculator submissions.
3. Action: Webhooks by Zapier, Custom Request. Method POST.
4. URL: `https://pbk-openclaw-bridge.onrender.com/api/leads/import`.
5. Headers: `Content-Type: application/json` and `Authorization: Bearer <PBK bridge credential>`.
6. Store the credential only in the private Zap connection/action settings. Never embed it in Webflow page code.
7. Map the JSON below, test with a clearly identified PBK test submission, and confirm the returned leadId in PBK before enabling the Zap.

The direct lead-import route persists canonical lead state, queues analyzer work when an address is supplied, and schedules the lead-profile projection. It avoids the separate `/events` lane, which may forward intake to the existing n8n workflow first.

## JSON mapping

Replace the angle-bracket placeholders using Zapier's field picker, not literal placeholder text.

```json
{
  "eventId": "webflow:<site-id>:<form-submission-id>",
  "source": "webflow-zapier",
  "leadSource": "webflow-contact-us",
  "seller": {
    "name": "<Name>",
    "email": "<Email>",
    "phone": "<Phone>",
    "bestTimeToCall": "<selected Morning/Afternoon/Evening labels>"
  },
  "property": {
    "address": "<Property-Address>",
    "city": "<Property-City>",
    "state": "<Property-State>",
    "propertyType": "<Property-Type>"
  },
  "motivation": { "summary": "<Inquiry-Message>" },
  "notes": "Inquiry type: <Inquiry-Type>; form: <form-id>; page: <page-name>",
  "tags": ["webflow", "website-inquiry"],
  "compliance": { "consentStatus": "unknown", "dncStatus": "needs_review" }
}
```

Use `Name 2` and `Phone Number` for Home and Appointment forms. Leave unavailable property fields empty; do not invent them. Preserve the original submission ID in eventId for every retry. Inquiry types can represent buyers or partners, so route those to their appropriate workflow rather than treating every contact as a seller. A newsletter email alone must not create an outbound calling task.

## Current production-domain forms

| Page               | Form ID                    | Available fields                                                                                                  |
| ------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Contact Us         | `6ae91b163b549fae388494cf` | Inquiry-Type, Name, Email, Phone, Property-Type, Property-Address, Property-City, Property-State, Inquiry-Message |
| Home               | `6ae91b163b549fae388494b5` | Name 2, Email, Phone Number, Morning, Afternoon, Evening                                                          |
| Book A Appointment | `6ae91b163b549fae388494df` | Name 2, Email, Phone Number, Morning, Afternoon, Evening, Field                                                   |

The account contains 87 form records, including older/domain variants and repeated newsletter forms. Select by current site/domain and exact form ID, not the generic Contact Form name alone. Recheck IDs after republishing or replacing a form. The Contact Us form also includes hidden PBK-Legacy fields; map the visible fields above.

## Verification before enabling

- Submit one PBK-owned test lead through the chosen live form.
- Confirm PBK returns `ok: true`, a leadId, and a saved canonical lead.
- Replay the same eventId: PBK should return `replayed: true` and the same leadId.
- Verify seller fields, property fields, message, and callback preferences in the saved lead.
- When an address exists, confirm the analyzer queue contains that leadId.
- Confirm the lead-profile projection completes; the HTTP response initially reports it as queued.
- Keep actual outreach behind existing PBK approvals and the consent captured by the website.

## Recovery findings

Hosted Postgres is reachable. Direct Gemini and DeepSeek requests returned HTTP 200. Hosted assistant turns timed out while Redis reported ECONNREFUSED. Render's existing free Key Value instance `red-d8ae2v7avr4c73dfbqog` is suspended; both resume endpoints returned HTTP 500. The local Redis recovery patch bounds connection attempts, disables offline queuing, and uses isReady instead of isOpen for readiness.

The local OpenClaw gateway was restarted, but its existing profile selects Ollama. Its model/profile configuration needs review before using it as PBK's cloud-model agent runtime. No production configuration or model credentials were changed during this recovery pass.

## References

- https://help.zapier.com/hc/en-us/articles/8496043264653-How-to-get-started-with-Webflow-on-Zapier
- https://help.zapier.com/hc/en-us/articles/8496326446989-Send-webhooks-in-Zap-workflows
- https://help.webflow.com/hc/en-us/articles/33961235002643-Does-Webflow-integrate-with-Zapier
- https://api-docs.render.com/reference/resume-key-value
