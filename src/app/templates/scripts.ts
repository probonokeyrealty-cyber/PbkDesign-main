/**
 * Centralized script templates for call scripts and acquisition workflows
 * All scripts auto-populate with deal data
 */

import { DealData } from '../types';
import { formatCurrency, formatDate } from '../utils/formatting';

export const generateOpeningScript = (deal: DealData): string => {
  const today = formatDate();

  return `
OPENING SCRIPT - INITIAL CONTACT

Property: ${deal.address || '[PROPERTY ADDRESS]'}
Seller: ${deal.sellerName || '[SELLER NAME]'}
Date: ${today}

═══════════════════════════════════════════════════════════════

📞 OPENING (First 30 Seconds)

Hi, is this ${deal.sellerName || '[SELLER NAME]'}?

Great! My name is [YOUR NAME] with Probono Key Realty. I noticed your property at ${deal.address || '[ADDRESS]'} is ${deal.contact === 'realtor' ? 'listed' : 'for sale'}, and I wanted to reach out directly.

We work with investors who are looking for properties in your area, and we may have a buyer who'd be interested in making a quick, clean offer.

Do you have a few minutes to talk about your property?

═══════════════════════════════════════════════════════════════

🎯 QUALIFICATION (Next 2-3 Minutes)

Ask these questions to understand the situation:

• How long have you owned the property?
  → Listen for: distress signals, timeline urgency

• What's your ideal timeline for selling?
  → Listen for: motivation level (1-5 scale)
  → Current motivation: ${deal.motivationLevel || 'Not assessed'}

• Are there any repairs or updates needed?
  → Listen for: repair estimates, seller fatigue
  → Known repairs: ${deal.repairs.mid > 0 ? formatCurrency(deal.repairs.mid) : 'Not assessed'}

• Do you have a mortgage on the property?
  → Listen for: SubTo potential, equity position
  → Current balance: ${deal.balance > 0 ? formatCurrency(deal.balance) : 'Unknown'}

• What's your bottom line price to walk away happy?
  → Listen for: anchor price, flexibility
  → Asking price: ${deal.price > 0 ? formatCurrency(deal.price) : 'Not provided'}

═══════════════════════════════════════════════════════════════

💡 VALUE PROPOSITION (Bridge to Numbers)

Based on what you're telling me, here's what we can offer you:

✓ Quick close – we can close in as little as 7-14 days
✓ Cash or creative financing options
✓ No repairs needed – we buy as-is
✓ No realtor commissions to pay (you save ${deal.arv > 0 ? formatCurrency(deal.arv * 0.06) : '6%'})
✓ Certainty – no buyer financing falling through

Would any of these benefits be valuable to you?

═══════════════════════════════════════════════════════════════

🔄 TRANSITION TO ACQUISITION

If seller shows interest (Motivation 3+):

"Perfect! Let me ask a few more questions so I can put together the best possible offer for your situation. This will only take a few more minutes..."

→ Move to ACQUISITION SCRIPT

If seller is hesitant (Motivation 1-2):

"I completely understand. Can I send you some information about how we work? That way you can review it on your own time and reach out if it makes sense."

→ Follow up in 7 days

═══════════════════════════════════════════════════════════════

Prepared by: Probono Key Realty
© ${new Date().getFullYear()}
  `.trim();
};

export const generateAcquisitionScript = (deal: DealData): string => {
  const today = formatDate();

  return `
ACQUISITION SCRIPT - OFFER DEVELOPMENT

Property: ${deal.address || '[PROPERTY ADDRESS]'}
Seller: ${deal.sellerName || '[SELLER NAME]'}
Motivation Score: ${deal.motivationScore || 'Not assessed'} (${deal.motivationLevel || ''})
Date: ${today}

═══════════════════════════════════════════════════════════════

📊 NUMBERS DEEP-DIVE

"Great! Let me run some numbers while we're on the phone. I want to make sure I get you the best possible offer..."

PROPERTY SPECIFICS:
• Bedrooms: ${deal.beds || '___'}
• Bathrooms: ${deal.baths || '___'}
• Square footage: ${deal.sqft ? deal.sqft.toLocaleString() : '___________'}
• Year built: ${deal.year || '___________'}

MARKET ANALYSIS:
• What do you think the property is worth fully updated?
  → ARV estimate: ${deal.arv > 0 ? formatCurrency(deal.arv) : 'Not calculated'}

• Have you seen any recent sales in the neighborhood?
  → Use for comps verification

REPAIR ASSESSMENT:
• On a scale of 1-10, how would you rate the condition? (10 = perfect)
  → Translate: 8-10 = cosmetic, 5-7 = moderate, 1-4 = extensive
  → Current estimate: ${deal.repairs.condition || 'Not assessed'}

• What are the biggest repairs needed?
  → Kitchen: Yes/No
  → Bathrooms: Yes/No
  → Roof: Yes/No
  → HVAC: Yes/No
  → Foundation: Yes/No

═══════════════════════════════════════════════════════════════

🎯 PATH SELECTION (Based on Answers)

CASH PATH (Default for quick close):
"Based on what you've told me, I can offer you ${deal.mao60 > 0 ? formatCurrency(deal.mao60) : '[CASH OFFER]'} cash and close in ${deal.timeline || '7-14 days'}.

This accounts for the repairs needed and gives you certainty with no contingencies."

RETAIL BUYER PROGRAM (If seller wants higher price):
"I understand you'd like to get closer to market value. We have a Retail Buyer Program where we can offer you ${deal.maoRBP > 0 ? formatCurrency(deal.maoRBP) : '[RBP OFFER]'} - that's 88% of ARV.

Our buyer gets built-in equity, and you get a much higher price than traditional cash offers. We can still close in ${deal.timeline || '14-21 days'}."

SUBJECT-TO (If mortgage exists with good rate):
${deal.balance > 0 && deal.rate < 6 ? `"I notice you have an existing mortgage at ${deal.rate}%.

Instead of paying it off, what if we took over your payments and gave you ${formatCurrency(deal.price * 0.03)} cash for your equity? You'd be free of the property, and your credit would actually improve as we make on-time payments."` : `[Not applicable - no favorable mortgage exists]`}

CREATIVE FINANCE (If seller wants income):
"Would you be open to seller financing? We could structure it where you get income every month instead of a lump sum.

This could give you better tax treatment and ongoing cash flow."

═══════════════════════════════════════════════════════════════

🚫 OBJECTION HANDLING

"I need to think about it"
→ "I completely understand. What specific information would help you make a decision? Is it the price, the timeline, or something else?"

"Your offer is too low"
→ "I appreciate that feedback. Keep in mind our offer accounts for ${formatCurrency(deal.repairs.mid)} in repairs, holding costs, and the convenience of a fast, guaranteed close. What price would work for you?"

"I'm working with a realtor"
→ "That's great! We work with realtors all the time. We can make an offer that includes their commission, and you still get the benefits of a quick, certain close."

"I want to list it on the market first"
→ "I understand. Just so you know, the average house sits for ${deal.dom || '30-60'} days, and after commissions (${deal.arv > 0 ? formatCurrency(deal.arv * 0.06) : '6%'}) and repairs, many sellers net less than our offer. But I respect your decision - can I stay in touch?"

═══════════════════════════════════════════════════════════════

✅ CLOSING

"Based on what you've told me, I'd like to put together a formal offer for you. I can have that to you by [TODAY/TOMORROW].

Can I confirm the best email address to send it to?"
→ Email: ${deal.sellerEmail || '___________________________'}

"And just to confirm, you're the only decision maker, or is there anyone else who needs to review the offer?"

"Perfect! I'll get this over to you by [TIMEFRAME]. When you receive it, take a look and let me know if you have any questions. Sound good?"

═══════════════════════════════════════════════════════════════

📋 POST-CALL CHECKLIST

☐ Send offer package within 24 hours
☐ Include path comparison (all 4 paths)
☐ Add seller-specific notes based on call
☐ Follow up in 24-48 hours
☐ Add to CRM with motivation score
☐ Set calendar reminder for follow-up

═══════════════════════════════════════════════════════════════

Prepared by: Probono Key Realty
© ${new Date().getFullYear()}
  `.trim();
};

export const generateSellerQuestionnaire = (deal: DealData): string => {
  const today = formatDate();

  return `
SELLER PROPERTY QUESTIONNAIRE

Property Address: ${deal.address || '[PROPERTY ADDRESS]'}
Date: ${today}
Seller Name: ${deal.sellerName || '___________________________'}

═══════════════════════════════════════════════════════════════

PROPERTY INFORMATION

1. How long have you owned this property? ___________
2. Is the property currently occupied? ☐ Yes ☐ No
3. Are you the sole owner? ☐ Yes ☐ No
   If no, list other owners: ___________________________

═══════════════════════════════════════════════════════════════

MOTIVATION & TIMELINE

4. Why are you selling? ___________________________
5. When do you need to close? ${deal.timeline || '___________________________'}
6. What's your ideal timeline? ___________________________
7. What price would you accept for a quick cash close? ___________

═══════════════════════════════════════════════════════════════

PROPERTY CONDITION

8. Are there any known defects or issues? ☐ Yes ☐ No
   If yes, please describe: ___________________________

9. What repairs or updates are needed?
${deal.type === 'house' ? `
   ☐ Roof          ☐ HVAC         ☐ Plumbing
   ☐ Electrical    ☐ Foundation   ☐ Kitchen
   ☐ Bathrooms     ☐ Flooring     ☐ Paint
   ☐ Other: ___________________________
` : `
   ☐ Clearing      ☐ Grading      ☐ Utilities
   ☐ Access Road   ☐ Survey       ☐ Other: ___________
`}
10. Estimated repair costs: ${deal.repairs.mid > 0 ? formatCurrency(deal.repairs.mid) : '___________'}

═══════════════════════════════════════════════════════════════

FINANCIAL INFORMATION

11. Current mortgage balance: ${deal.balance > 0 ? formatCurrency(deal.balance) : '___________'}
12. Monthly mortgage payment: ___________
13. Interest rate: ${deal.rate > 0 ? `${deal.rate}%` : '___________'}
14. Are payments current? ☐ Yes ☐ No
15. Any liens or encumbrances? ☐ Yes ☐ No
16. Property taxes (annual): ___________

═══════════════════════════════════════════════════════════════

ADDITIONAL INFORMATION

17. Why is this a good deal for an investor? ___________________________
18. What's the best feature of this property? ___________________________
19. Preferred contact method: ☐ Phone ☐ Email ☐ Text
20. Best time to reach you: ___________________________

Contact Information:
${deal.sellerEmail ? `Email: ${deal.sellerEmail}` : 'Email: ___________________________'}
${deal.sellerPhone ? `Phone: ${deal.sellerPhone}` : 'Phone: ___________________________'}

Thank you for your time!

For questions, contact: Probono Key Realty

═══════════════════════════════════════════════════════════════

Probono Key Realty © ${new Date().getFullYear()}
  `.trim();
};
