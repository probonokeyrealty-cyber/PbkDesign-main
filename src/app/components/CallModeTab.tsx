import { useEffect, useState } from 'react';
import { DealData, PBKPath } from '../types';
import { LiveCallInputs } from './LiveCallInputs';
import { LiveDealTrackerPanel } from './LiveDealTrackerPanel';
import { PathWorkflowPanel } from './PathWorkflowPanel';
import { CallScriptSections } from './CallScriptSections';
import { formatCurrency, sanitizeLegacyCopy } from '../utils/formatting';
import { getLiveInputPath, getPathOptions } from '../utils/pbk';

type LegacyPath = 'cash' | 'creative' | 'subto' | 'rbp' | 'land';

interface CallModeTabProps {
  deal: DealData;
  onDealChange: (updates: Partial<DealData>) => void;
  selectedPath: PBKPath;
  onSelectPath: (path: PBKPath) => void;
}

function getLegacyPath(path: PBKPath): LegacyPath {
  if (path === 'cf') return 'creative';
  if (path === 'mt') return 'subto';
  if (path === 'land-owner' || path === 'land-agent' || path === 'rbp-land') return 'land';
  return path;
}

function normalizeLegacyScriptTree<T>(value: T): T {
  if (typeof value === 'string') {
    return sanitizeLegacyCopy(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeLegacyScriptTree(item)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeLegacyScriptTree(entry)]),
    ) as T;
  }

  return value;
}

export function CallModeTab({ deal, onDealChange, selectedPath: activePath, onSelectPath }: CallModeTabProps) {
  const [callNotes, setCallNotes] = useState('');
  const [scriptVariant, setScriptVariant] = useState<'owner' | 'agent'>(deal.contact === 'realtor' ? 'agent' : 'owner');
  const selectedPath = getLegacyPath(activePath);
  const pathOptions = getPathOptions({ type: deal.type, contact: deal.contact });
  const dedicatedWorkflowPath =
    activePath === 'cf' ||
    activePath === 'mt' ||
    activePath === 'land-owner' ||
    activePath === 'land-agent' ||
    activePath === 'rbp-land';
  const forcedVariant =
    activePath === 'land-agent'
      ? 'agent'
      : activePath === 'land-owner' || activePath === 'rbp-land'
        ? 'owner'
        : null;

  useEffect(() => {
    setScriptVariant(deal.contact === 'realtor' ? 'agent' : 'owner');
  }, [deal.contact]);

  useEffect(() => {
    if (forcedVariant) {
      setScriptVariant(forcedVariant);
    }
  }, [forcedVariant]);

  // Path Scripts - organized by acquisition strategy with owner/agent variants
  const pathScripts = normalizeLegacyScriptTree({
    cash: {
      name: 'Cash Wholesale',
      color: 'green',
      owner: {
        opening: ` CASH WHOLESALE - OPENING

Hi, is this ${deal.sellerName || '[SELLER NAME]'}?

Great! My name is [YOUR NAME] with Probono Key Realty. I noticed your property at ${deal.address || '[ADDRESS]'} is ${deal.contact === 'realtor' ? 'listed' : 'for sale'}, and I wanted to reach out directly.

I work with cash investors who are actively looking for properties in your area. We can close quickly - typically 7-14 days - all cash, no financing contingencies.

Do you have a few minutes to discuss your property and timeline?`,

      acquisition: ` CASH WHOLESALE - ACQUISITION

Based on the market analysis I just ran:

PROPERTY DETAILS:
 Address: ${deal.address || '[ADDRESS]'}
 Beds/Baths: ${deal.beds || '___'}/${deal.baths || '___'}
 Square Feet: ${deal.sqft ? deal.sqft.toLocaleString() : '___'}
 Condition: ${deal.repairs?.condition || 'To be assessed'}

MARKET ANALYSIS:
 ARV (After Repair Value): ${formatCurrency(deal.arv)}
 Estimated Repairs: ${formatCurrency(deal.repairs?.mid || 0)}
 Your List Price: ${formatCurrency(deal.price)}

CASH OFFER:
I can offer you ${formatCurrency(deal.mao60)} cash and close in ${deal.timeline || '7-14 days'}.

This accounts for the ${formatCurrency(deal.repairs?.mid || 0)} in repairs needed and gives you certainty with no contingencies.

KEY BENEFITS:
 Cash payment - no financing delays
 Close in 7-14 days
 No repairs needed - we buy as-is
 No realtor commissions (save 6%)
 Certainty and speed

Does a quick, hassle-free cash sale work for your situation?`,

      closing: ` CASH WHOLESALE - CLOSING

Perfect! Here's what happens next:

NEXT STEPS:
1. I'll send you a simple Purchase Agreement today
2. You review and sign (takes 5 minutes)
3. We deposit ${deal.earnestDeposit || '$1,000 earnest money'} in escrow
4. Our team handles all inspections and paperwork
5. You close and get ${formatCurrency(deal.mao60)} in ${deal.timeline || '7-14 days'}

The earnest money protects you - if we don't close, you keep it.

What's the best email to send the agreement to?
 ${deal.sellerEmail || '___________________________'}

Can you sign and return it within 24 hours so we can get started?`,
      },
      agent: {
        opening: ` CASH WHOLESALE - AGENT PARTNERSHIP (OPENING)

Hi, this is [YOUR NAME] with Probono Key Realty. I'm calling to discuss the listing at ${deal.address || '[ADDRESS]'}.

I represent cash investors who are actively acquiring properties in this market. We work collaboratively with listing agents to bring qualified, all-cash offers that close quickly.

WHAT WE BRING:
 Pre-qualified cash buyers (no financing contingencies)
 7-14 day closings
 As-is purchase (no repair negotiations)
 Professional transaction management

I'd like to discuss submitting an offer on behalf of my investor client. Do you have a few minutes to go over the property details and seller's situation?`,

        acquisition: ` CASH WHOLESALE - AGENT PARTNERSHIP (ACQUISITION)

Thank you for the property details. Here's what my investor client can offer:

PROPERTY ANALYSIS:
 Address: ${deal.address || '[ADDRESS]'}
 Listed Price: ${formatCurrency(deal.price)}
 ARV (Comps Analysis): ${formatCurrency(deal.arv)}
 Estimated Repairs: ${formatCurrency(deal.repairs?.mid || 0)}
 Property Condition: ${deal.repairs?.condition || 'Needs assessment'}

INVESTOR OFFER:
${formatCurrency(deal.mao60)} all cash
Close in ${deal.timeline || '7-14 days'}

TRANSACTION STRUCTURE:
 All-cash purchase (no appraisal contingency)
 As-is condition (buyer assumes all repairs)
 Proof of funds provided with offer
 Title company of your/seller's choice
 Full commission honored at closing

BUYER QUALIFICATIONS:
 Seasoned investor with 10+ closings this year
 Cash reserves verified
 Can close escrow in 7-14 days
 Professional and easy to work with

This offer accounts for the ${formatCurrency(deal.repairs?.mid || 0)} in repairs and positions your seller for a quick, certain close.

Would your seller be interested in reviewing a clean, all-cash offer at this number?`,

        closing: ` CASH WHOLESALE - AGENT PARTNERSHIP (CLOSING)

Excellent! Let me outline our next steps to make this transaction smooth for everyone:

OFFER SUBMISSION:
1. I'll prepare a professional Purchase Agreement at ${formatCurrency(deal.mao60)}
2. Proof of funds attached
3. Earnest deposit: ${deal.earnestDeposit || '$1,000 to escrow'}
4. Close of escrow: ${deal.timeline || '7-14 days'}

FOR YOUR REVIEW:
 Standard residential purchase contract
 All-cash, no financing contingency
 Inspection for information only (no repair requests)
 Full commission per MLS (honored at close)
 Buyer-side title company coordinates closing

TIMELINE:
 Offer submitted: Today
 Seller review: 24-48 hours
 Accepted/countersigned: Within 3 days
 Close: ${deal.timeline || '7-14 days from acceptance'}

This gives your seller certainty and speed. My investor is ready to move immediately.

Best email to submit the official offer: _______________

I'll follow up with you in 24 hours after submission. Thank you for working with us on this.`,
      },
    },

    creative: {
      name: 'Creative Finance',
      color: 'blue',
      owner: {
        opening: ` CREATIVE FINANCE - OPENING

Hi ${deal.sellerName || '[SELLER]'}, this is [YOUR NAME] with Probono Key Realty.

I'm calling about your property at ${deal.address || '[ADDRESS]'}. I have a creative financing solution that might work better than a traditional cash sale.

Instead of a lump sum, what if I could offer you:
 Monthly income stream for ${deal.cfTerm || 30} years
 Higher total price than cash buyers
 Tax advantages (spread capital gains)
 Fully secured by the property

This is called seller financing - you act as the bank and I make payments to you.

Would you be open to hearing how this works?`,

      acquisition: ` CREATIVE FINANCE - ACQUISITION

OFFER STRUCTURE:

Purchase Price: ${formatCurrency(deal.price)}
Down Payment: ${formatCurrency(Math.round(deal.price * 0.10))} (10% at closing)
Financed Amount: ${formatCurrency(deal.price - Math.round(deal.price * 0.10))}
Interest Rate: ${deal.cfRate || 6}% (below current market)
Term: ${deal.cfTerm || 30} years
Monthly Payment: ${formatCurrency(deal.cfMonthlyPayment || 0)}

YOUR BENEFITS:
 Higher price than all-cash offers
 ${formatCurrency(deal.cfMonthlyPayment || 0)}/month income for life
 Tax advantages - spread capital gains over years
 ${deal.cfRate || 6}% return (better than savings/CDs)
 Fully secured - you hold the deed until paid off
 First position lien - you're protected

FOR CONTEXT:
 You get ${formatCurrency(Math.round(deal.price * 0.10))} cash at closing
 Then ${formatCurrency(deal.cfMonthlyPayment || 0)} every month
 Property serves as collateral
 I can refinance in 2-3 years and pay you off (your choice)

This creates better long-term wealth than a lump sum for many sellers.

Would this monthly income stream work for your situation?`,

      closing: ` CREATIVE FINANCE - CLOSING

Excellent! Here's how we'll structure this:

CLOSING DOCUMENTS:
1. Purchase Agreement at ${formatCurrency(deal.price)}
2. Promissory Note for ${formatCurrency(deal.price - Math.round(deal.price * 0.10))}
3. Deed of Trust (you hold deed until paid off)
4. Payment schedule and instructions

TIMELINE:
 Send agreements: Today
 Review with your attorney: 3-5 days
 Sign and close: ${deal.timeline || '14-21 days'}

AT CLOSING YOU RECEIVE:
 Down payment: ${formatCurrency(Math.round(deal.price * 0.10))}
 Monthly payments start: ${formatCurrency(deal.cfMonthlyPayment || 0)}/month

I'll work with a real estate attorney to structure this properly - all legal and documented.

Can we schedule a time this week to review the contract with your attorney present?`,
      },
      agent: {
        opening: ` CREATIVE FINANCE - AGENT PARTNERSHIP (OPENING)

Hi, this is [YOUR NAME] with Probono Key Realty. I'm calling about the listing at ${deal.address || '[ADDRESS]'}.

I represent an investor client who specializes in creative financing solutions. We work with listing agents to structure seller-carry arrangements that benefit both parties.

CREATIVE FINANCING BENEFITS:
 Higher purchase price than cash offers
 Monthly income stream for your seller
 Tax advantages (deferred capital gains)
 Professional transaction with legal documentation
 Full commission honored at closing

I'd like to explore whether your seller would be open to a structured payment arrangement. Do you have a moment to discuss their situation and timeline?`,

        acquisition: ` CREATIVE FINANCE - AGENT PARTNERSHIP (ACQUISITION)

Thank you for the context. Here's the financing structure my investor can offer:

SELLER FINANCING PROPOSAL:

Purchase Price: ${formatCurrency(deal.price)}
Down Payment at Closing: ${formatCurrency(Math.round(deal.price * 0.10))} (10%)
Seller Carry Amount: ${formatCurrency(deal.price - Math.round(deal.price * 0.10))}
Interest Rate: ${deal.cfRate || 6}% annually
Term: ${deal.cfTerm || 30} years
Monthly Payment to Seller: ${formatCurrency(deal.cfMonthlyPayment || 0)}

SELLER ADVANTAGES:
 Higher total price than cash offers
 Steady monthly income: ${formatCurrency(deal.cfMonthlyPayment || 0)}
 Tax benefits - spread capital gains recognition
 ${deal.cfRate || 6}% return (better than CDs/bonds)
 Secured by first-position deed of trust
 Professional legal documentation
 Potential refinance buyout in 2-3 years

BUYER QUALIFICATIONS:
 Substantial down payment (10% = ${formatCurrency(Math.round(deal.price * 0.10))})
 Strong credit and verifiable income
 Real estate investor with proven track record
 Attorney will structure transaction professionally

This structure often works well for sellers who don't need all cash immediately and would benefit from long-term income.

Would your seller be interested in reviewing this creative financing proposal?`,

        closing: ` CREATIVE FINANCE - AGENT PARTNERSHIP (CLOSING)

Excellent! Here's how we'll proceed with the seller-financing structure:

LEGAL DOCUMENTATION:
1. Standard Purchase Agreement at ${formatCurrency(deal.price)}
2. Seller Financing Addendum
3. Promissory Note for ${formatCurrency(deal.price - Math.round(deal.price * 0.10))}
4. Deed of Trust (First Position)
5. Payment Authorization/Schedule

ATTORNEY INVOLVEMENT:
 Both parties represented by independent legal counsel
 Real estate attorney structures all documents
 Title company handles escrow and recording
 All documents reviewed before signing

TIMELINE:
 Submit offer and financing terms: Today
 Seller/attorney review: 3-5 business days
 Negotiate any adjustments: 2-3 days
 Close and fund: ${deal.timeline || '14-21 days'}

AT CLOSING:
 Seller receives: ${formatCurrency(Math.round(deal.price * 0.10))} down payment
 Monthly payments begin: ${formatCurrency(deal.cfMonthlyPayment || 0)}/month
 Full commission paid to agents
 Deed of Trust recorded (seller protected)

This is a professionally structured transaction with legal protections for your seller.

What's the best way to submit this proposal to you and your seller?`,
      },
    },

    subto: {
      name: 'Subject-To (Mortgage Takeover)',
      color: 'purple',
      owner: {
        opening: ` SUBJECT-TO - OPENING

Hi ${deal.sellerName || '[SELLER]'}, this is [YOUR NAME] with Probono Key Realty.

I understand you may need to move on from your property at ${deal.address || '[ADDRESS]'}. I specialize in helping homeowners who are facing challenges with their mortgage.

I have a solution that might help:

MORTGAGE TAKEOVER (Subject-To):
 I take over your ${deal.rate}% mortgage payments
 You get ${formatCurrency(Math.round(deal.price * 0.03))} cash for your equity
 No foreclosure on your credit
 Immediate debt relief
 Close in ${deal.timeline || '14-30 days'}

This is called "Subject-To" - I literally take over making your mortgage payments so you can walk away debt-free.

Are you in a situation where this type of relief would help?`,

      acquisition: ` SUBJECT-TO - ACQUISITION

YOUR CURRENT SITUATION:
 Property: ${deal.address || '[ADDRESS]'}
 Current Mortgage Balance: ${formatCurrency(deal.balance)}
 Interest Rate: ${deal.rate}% (GREAT rate vs today's ${7}%)
 Monthly Payment: ${formatCurrency(deal.balance > 0 ? Math.round((deal.balance * (deal.rate / 100 / 12)) / (1 - Math.pow(1 + (deal.rate / 100 / 12), -360))) : 0)}

MY OFFER:
 I take over your ${formatCurrency(deal.balance > 0 ? Math.round((deal.balance * (deal.rate / 100 / 12)) / (1 - Math.pow(1 + (deal.rate / 100 / 12), -360))) : 0)}/month payments
 ${formatCurrency(Math.round(deal.price * 0.03))} cash to you for your equity
 Close in ${deal.timeline || '14-30 days'}
 Zero realtor commissions
 You walk away completely debt-free

HOW IT WORKS:
 Loan stays in your name initially
 I make all payments on time (protects your credit)
 You get monthly payment confirmations
 After 12-24 months, I refinance into my name

YOUR BENEFITS:
 Immediate relief from mortgage burden
 No foreclosure on your credit
 Walk away with cash for equity
 Loan continues being paid on time
 No repair costs or showing hassles

That ${deal.rate}% rate is incredible compared to today's rates. I'd love to keep it and take over those payments.

Does immediate debt relief sound like what you need?`,

      closing: ` SUBJECT-TO - CLOSING

Perfect! Here's what happens next:

CLOSING STRUCTURE:
1. Purchase Agreement with Subject-To terms
2. Authorization for me to make payments on your behalf
3. Title search and insurance
4. ${formatCurrency(Math.round(deal.price * 0.03))} cash to you at closing
5. I take over ${formatCurrency(deal.balance > 0 ? Math.round((deal.balance * (deal.rate / 100 / 12)) / (1 - Math.pow(1 + (deal.rate / 100 / 12), -360))) : 0)}/month payments immediately

IMPORTANT DETAILS:
 Mortgage stays in your name initially
 I make ALL payments on time (improves your credit)
 You get monthly payment confirmations
 After 12-24 months of on-time payments, I refinance into my name
 You walk away debt-free TODAY

TIMELINE:
 Send agreements: Today
 Review documents: 2-3 days
 Close and you get cash: ${deal.timeline || '14-30 days'}

This gets you immediate relief while protecting your credit.

Can we schedule a time this week to review the paperwork together?`,
      },
      agent: {
        opening: ` SUBJECT-TO - AGENT PARTNERSHIP (OPENING)

Hi, this is [YOUR NAME] with Probono Key Realty. I'm calling about the listing at ${deal.address || '[ADDRESS]'}.

I work with an investor who specializes in mortgage relief solutions. We help sellers facing challenges with their mortgage payments through a Subject-To transaction structure.

SUBJECT-TO SOLUTION:
 Investor takes over existing ${deal.rate}% mortgage payments
 Immediate debt relief for your seller
 Avoids foreclosure and credit damage
 Cash for equity at closing
 Professionally structured with legal documentation

This works particularly well for sellers who are behind on payments or need to move quickly.

Is your seller in a situation where mortgage relief would be beneficial?`,

        acquisition: ` SUBJECT-TO - AGENT PARTNERSHIP (ACQUISITION)

Thank you for sharing the seller's situation. Here's what my investor can offer:

CURRENT MORTGAGE SITUATION:
 Property: ${deal.address || '[ADDRESS]'}
 Existing Loan Balance: ${formatCurrency(deal.balance)}
 Current Interest Rate: ${deal.rate}% (excellent rate)
 Monthly Payment: ${formatCurrency(deal.balance > 0 ? Math.round((deal.balance * (deal.rate / 100 / 12)) / (1 - Math.pow(1 + (deal.rate / 100 / 12), -360))) : 0)}

INVESTOR OFFER:
 Take over ${formatCurrency(deal.balance > 0 ? Math.round((deal.balance * (deal.rate / 100 / 12)) / (1 - Math.pow(1 + (deal.rate / 100 / 12), -360))) : 0)}/month mortgage payments
 Pay seller ${formatCurrency(Math.round(deal.price * 0.03))} cash for equity at closing
 Close in ${deal.timeline || '14-30 days'}
 Full commission honored
 Professional legal documentation

HOW IT WORKS:
 Loan remains in seller's name initially
 Investor makes all payments on time (protects seller's credit)
 Monthly payment verifications provided
 After 12-24 months of on-time payments, investor refinances
 Seller walks away debt-free immediately

SELLER BENEFITS:
 Immediate relief from mortgage burden
 Avoids foreclosure/short sale
 Protects credit (on-time payments continue)
 Cash for equity at closing
 No repair costs or extended showings

This ${deal.rate}% rate is significantly below current market rates, making it attractive for the investor to maintain.

Would your seller be open to exploring this debt-relief solution?`,

        closing: ` SUBJECT-TO - AGENT PARTNERSHIP (CLOSING)

Excellent! Here's how we'll structure this transaction professionally:

LEGAL DOCUMENTATION:
1. Purchase Agreement with Subject-To terms
2. Payment Authorization Agreement
3. Deed transfer with existing lien
4. Monthly payment verification system
5. Title search and insurance

CLOSING STRUCTURE:
 Seller receives: ${formatCurrency(Math.round(deal.price * 0.03))} cash at closing
 Investor begins: ${formatCurrency(deal.balance > 0 ? Math.round((deal.balance * (deal.rate / 100 / 12)) / (1 - Math.pow(1 + (deal.rate / 100 / 12), -360))) : 0)}/month payments immediately
 Full commission paid to agents
 Professional title company handles transaction

TIMELINE:
 Submit offer and Subject-To structure: Today
 Seller/attorney review: 3-5 days
 Title search and documentation: 5-7 days
 Close and seller gets relief: ${deal.timeline || '14-30 days'}

SELLER PROTECTIONS:
 All payments verified monthly
 Refinance timeline specified in agreement
 Attorney review recommended
 Professional transaction management

This gets your seller immediate debt relief while protecting their credit through continued on-time payments.

What's the best way to present this to your seller?`,
      },
    },

    rbp: {
      name: 'Retail Buyer Program (RBP)',
      color: 'amber',
      owner: {
        opening: ` RETAIL BUYER PROGRAM - OPENING

Hi ${deal.sellerName || '[SELLER]'}, this is [YOUR NAME] with Probono Key Realty.

I'm calling about your property at ${deal.address || '[ADDRESS]'}. I work with homebuyers who are specifically looking for properties with instant equity - homes they can buy below market value.

Based on comparable sales in your area, I can offer you ${formatCurrency(deal.maoRBP)} and close in ${deal.timeline || '14-21 days'}.

That's 88% of your home's after-repair value - a strong offer that gives my buyer built-in equity while you get a quick, clean sale.

Do you have a few minutes to discuss this?`,

      acquisition: ` RETAIL BUYER PROGRAM - ACQUISITION

MARKET ANALYSIS:
 Property: ${deal.address || '[ADDRESS]'}
 After-Repair Value (ARV): ${formatCurrency(deal.arv)}
 Current Condition: ${deal.repairs?.condition || 'To be assessed'}
 Repairs Needed: ${formatCurrency(deal.repairs?.mid || 0)}

MY OFFER:
${formatCurrency(deal.maoRBP)} (88% of ARV)
Close in ${deal.timeline || '14-21 days'}

WHY THIS WORKS:
 My buyer is pre-approved and ready to go
 They're looking for a property they can fix up
 They understand it needs ${formatCurrency(deal.repairs?.mid || 0)} in work
 They get instant equity: ${formatCurrency(deal.arv - deal.maoRBP)}
 You get a quick close with no contingencies

FOR YOU:
 ${formatCurrency(deal.maoRBP)} in your pocket
 Close in 2-3 weeks
 No repairs needed
 No showing your home for months
 No realtor commissions

This gives my buyer ${formatCurrency(deal.arv - deal.maoRBP)} in instant equity (they're getting it for 88% of value), and you get a quick, clean sale.

The home needs about ${formatCurrency(deal.repairs?.mid || 0)} in repairs - are you willing to sell as-is to avoid doing that work yourself?`,

      closing: ` RETAIL BUYER PROGRAM - CLOSING

Perfect! Let me connect you with my buyer.

They're looking for exactly this type of property - something with good bones that they can add value to.

NEXT STEPS:
1. I'll prepare the purchase agreement at ${formatCurrency(deal.maoRBP)}
2. My buyer will do a quick walkthrough (15 minutes)
3. We open escrow within 24 hours
4. Close in ${deal.timeline || '14-21 days'}

BUYER EQUITY:
The buyer is getting ${formatCurrency(deal.arv - deal.maoRBP - (deal.repairs?.mid || 0))} in equity after repairs, so they're motivated to move fast.

YOU RECEIVE:
 ${formatCurrency(deal.maoRBP)} at closing
 No repair costs
 No realtor commissions
 Clean, fast transaction

Can you do a showing this week? The sooner we get my buyer through, the sooner we can close and you get your check.

Best day/time for walkthrough: ___________________`,
      },
      agent: {
        opening: ` RETAIL BUYER PROGRAM - AGENT PARTNERSHIP (OPENING)

Hi, this is [YOUR NAME] with Probono Key Realty. I'm calling about the listing at ${deal.address || '[ADDRESS]'}.

I represent a pre-qualified buyer who is specifically looking for properties with built-in equity. We work collaboratively with listing agents to bring quick, qualified offers.

BUYER PROFILE:
 Pre-approved conventional financing
 Looking for value-add properties
 Understands as-is condition
 Can close in ${deal.timeline || '14-21 days'}
 Professional and easy to work with

Based on comparable sales, I'd like to submit an offer at ${formatCurrency(deal.maoRBP)} (88% of ARV).

Do you have a moment to discuss the property condition and seller's timeline?`,

        acquisition: ` RETAIL BUYER PROGRAM - AGENT PARTNERSHIP (ACQUISITION)

Thank you for the property details. Here's what my buyer client can offer:

MARKET ANALYSIS:
 Property: ${deal.address || '[ADDRESS]'}
 After-Repair Value (ARV): ${formatCurrency(deal.arv)}
 Property Condition: ${deal.repairs?.condition || 'Needs assessment'}
 Estimated Repairs: ${formatCurrency(deal.repairs?.mid || 0)}

BUYER OFFER:
${formatCurrency(deal.maoRBP)} (88% of ARV)
Close in ${deal.timeline || '14-21 days'}

TRANSACTION STRUCTURE:
 Conventional financing (pre-approved)
 As-is purchase (buyer assumes all repairs)
 Standard inspection for information only
 No repair requests or credits
 Full commission honored per MLS

BUYER POSITIONING:
 Built-in equity: ${formatCurrency(deal.arv - deal.maoRBP)}
 After repairs: ${formatCurrency(deal.arv - deal.maoRBP - (deal.repairs?.mid || 0))} total equity
 This is a value-add investment for the buyer
 Seller gets clean transaction at 88% of market value

YOUR SELLER BENEFITS:
 ${formatCurrency(deal.maoRBP)} purchase price
 Quick close (2-3 weeks)
 No repairs or prep needed
 No showings to multiple buyers
 Full commission paid
 Qualified buyer (pre-approved)

The buyer understands the property needs ${formatCurrency(deal.repairs?.mid || 0)} in work and is comfortable with that.

Would your seller be interested in a quick, clean offer at 88% of value?`,

        closing: ` RETAIL BUYER PROGRAM - AGENT PARTNERSHIP (CLOSING)

Perfect! Let me outline the next steps to get this under contract:

OFFER SUBMISSION:
1. Purchase Agreement at ${formatCurrency(deal.maoRBP)}
2. Pre-approval letter attached
3. Proof of earnest deposit funds
4. Standard residential contract terms
5. As-is addendum (no repairs/credits)

BUYER WALKTHROUGH:
 Schedule 15-minute property showing
 Buyer confirms condition matches expectations
 No negotiations on repairs/condition
 Quick decision (24-48 hours)

TIMELINE:
 Submit offer: Today
 Property showing: Within 48 hours
 Offer acceptance: 3-5 days
 Open escrow: Immediately upon acceptance
 Close: ${deal.timeline || '14-21 days from acceptance'}

COMMISSION:
 Full MLS commission honored
 Paid at close of escrow
 Standard terms per listing agreement

The buyer is motivated because they're getting ${formatCurrency(deal.arv - deal.maoRBP - (deal.repairs?.mid || 0))} in equity after the ${formatCurrency(deal.repairs?.mid || 0)} renovation.

Can we schedule a showing this week? The sooner we walk the property, the faster we can move to close.

Best availability: ___________________`,
      },
    },

    land: {
      name: 'Land/Builder Assignment',
      color: 'gray',
      owner: {
        opening: ` LAND DEAL - OPENING

Hi ${deal.sellerName || '[SELLER]'}, this is [YOUR NAME] with Probono Key Realty.

I'm reaching out about your land at ${deal.address || '[ADDRESS]'}.

I work with builders who are actively looking for lots in your area. They're currently paying ${formatCurrency(deal.builderPrice)} per quarter-acre for buildable lots.

Your lot is ${deal.lotSize || '___'} acres, which means it's worth ${formatCurrency(deal.builderTotal)} to my builder network.

I can offer you ${formatCurrency(deal.offer)} cash and close in ${deal.timeline || '21-30 days'}.

Do you have a few minutes to discuss this?`,

      acquisition: ` LAND DEAL - ACQUISITION

LOT ANALYSIS:
 Property: ${deal.address || '[ADDRESS]'}
 Lot Size: ${deal.lotSize || '___'} acres
 Builder Value: ${formatCurrency(deal.builderPrice)}/quarter-acre
 Total Builder Value: ${formatCurrency(deal.builderTotal)}

MY OFFER:
${formatCurrency(deal.offer)} cash
Close in ${deal.timeline || '21-30 days'}

THE SITUATION:
 Builders are my end buyers
 They need cleared, buildable lots
 They pay cash, no financing delays
 You avoid holding costs and property taxes

FOR YOU:
 ${formatCurrency(deal.offer)} cash in your pocket
 Quick close (3-4 weeks)
 No surveying or clearing needed
 No dealing with individual home buyers

I handle all the builder connections and paperwork. You just sell the land and move on.

The builders I work with develop entire neighborhoods, so they need lots like yours.

Does a quick cash sale make sense for your situation?`,

      closing: ` LAND DEAL - CLOSING

Excellent! Here's how this will work:

CLOSING PROCESS:
1. Purchase Agreement at ${formatCurrency(deal.offer)}
2. Title search and survey (I coordinate)
3. Builder confirms zoning and utilities
4. Close in ${deal.timeline || '21-30 days'}

BUILDER VERIFICATION:
The builder needs to verify:
 Zoning allows residential
 Utilities accessible (water, sewer, electric)
 No wetlands or restrictions

I'll coordinate all of that. Your only job is to sign at closing.

MY ASSIGNMENT:
My assignment fee comes from the builder (${formatCurrency(deal.builderTotal - deal.offer)}), not from you. So you get your full ${formatCurrency(deal.offer)}.

EARNEST DEPOSIT:
${deal.earnestDeposit || '$500-$2,000'} earnest money into escrow

Can we start the title work this week?

Best email for documents: ${deal.sellerEmail || '_______________'}`,
      },
      agent: {
        opening: ` LAND DEAL - AGENT PARTNERSHIP (OPENING)

Hi, this is [YOUR NAME] with Probono Key Realty. I'm calling about the land listing at ${deal.address || '[ADDRESS]'}.

I work with a network of builders and developers who are actively acquiring buildable lots in this area. We collaborate with listing agents to bring qualified, all-cash land buyers.

BUILDER NETWORK:
 Actively paying ${formatCurrency(deal.builderPrice)}/quarter-acre
 All-cash closings (no financing delays)
 Experienced with zoning and permitting
 Close in ${deal.timeline || '21-30 days'}

Your listing is ${deal.lotSize || '___'} acres, which translates to approximately ${formatCurrency(deal.builderTotal)} builder value.

I'd like to discuss submitting a cash offer on behalf of one of my builder clients. Do you have a moment?`,

        acquisition: ` LAND DEAL - AGENT PARTNERSHIP (ACQUISITION)

Thank you for the lot details. Here's what my builder client can offer:

LOT ANALYSIS:
 Property: ${deal.address || '[ADDRESS]'}
 Lot Size: ${deal.lotSize || '___'} acres
 Builder Rate: ${formatCurrency(deal.builderPrice)} per quarter-acre
 Total Builder Value: ${formatCurrency(deal.builderTotal)}

BUILDER OFFER:
${formatCurrency(deal.offer)} all cash
Close in ${deal.timeline || '21-30 days'}

TRANSACTION STRUCTURE:
 All-cash purchase (no financing contingency)
 Builder handles all due diligence
 Title search and survey coordinated by buyer
 Full commission honored at closing

BUILDER DUE DILIGENCE:
The builder will verify:
 Zoning allows residential development
 Utilities accessible (water, sewer, electric)
 No wetlands or environmental restrictions
 Buildable lot (no flood zones)

SELLER BENEFITS:
 ${formatCurrency(deal.offer)} cash in pocket
 Quick close (3-4 weeks)
 No contingencies beyond title
 Professional builder transaction
 Full commission paid

The builder is actively developing in this area and needs lots like this for their project pipeline.

Would your seller be interested in a clean, all-cash land offer?`,

        closing: ` LAND DEAL - AGENT PARTNERSHIP (CLOSING)

Excellent! Here's how we'll proceed with the builder purchase:

OFFER SUBMISSION:
1. Purchase Agreement at ${formatCurrency(deal.offer)}
2. Proof of funds for all-cash purchase
3. Earnest deposit: ${deal.earnestDeposit || '$500-$2,000'} to escrow
4. Standard land purchase terms

BUILDER DUE DILIGENCE (10-14 days):
 Zoning verification (residential allowed)
 Utility accessibility confirmed
 Survey and boundary verification
 Environmental/wetlands check
 Title search and clearance

TIMELINE:
 Submit offer: Today
 Due diligence period: 10-14 days
 Clear to close: Day 15
 Final closing: ${deal.timeline || '21-30 days'}

COMMISSION STRUCTURE:
 Full MLS commission honored
 Paid at close of escrow
 Standard terms per listing agreement

BUILDER ASSIGNMENT:
 My assignment fee comes from builder side
 Your seller receives full ${formatCurrency(deal.offer)}
 No seller costs beyond standard closing

The builder needs buildable lots for their development project and this lot fits their criteria perfectly.

What's the best way to submit this offer to you and your seller?

Your email: ___________________`,
      },
    },
  });

  const currentPath = pathScripts[selectedPath];
  const currentScripts = currentPath[scriptVariant];

  const renderPathScriptsPanel = () => (
    <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex items-center gap-2">
          <div className="w-1 h-3 bg-orange-500 rounded-sm"></div>
          <h3 className="text-[10px] font-bold uppercase tracking-wide text-orange-500">
            Acquisition Scripts by Path
          </h3>
        </div>
        <div className="inline-flex items-center gap-1.5 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 border border-orange-500/40 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wide">
          <span>LIVE</span>
          <span>CALL MODE</span>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4 p-2 bg-gray-50 dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700">
        <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
          Script For:
        </span>
        <button
          onClick={() => setScriptVariant('owner')}
          disabled={forcedVariant === 'agent'}
          className={`px-3 py-1 rounded text-[11px] font-medium transition-all ${
            scriptVariant === 'owner'
              ? 'bg-blue-500 text-white shadow-sm'
              : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700'
          } ${forcedVariant === 'agent' ? 'cursor-not-allowed opacity-40' : ''}`}
        >
          Owner Direct
        </button>
        <button
          onClick={() => setScriptVariant('agent')}
          disabled={forcedVariant === 'owner'}
          className={`px-3 py-1 rounded text-[11px] font-medium transition-all ${
            scriptVariant === 'agent'
              ? 'bg-purple-500 text-white shadow-sm'
              : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700'
          } ${forcedVariant === 'owner' ? 'cursor-not-allowed opacity-40' : ''}`}
        >
          Agent Partnership
        </button>
      </div>

      {dedicatedWorkflowPath ? (
        <PathWorkflowPanel
          deal={deal}
          activePath={activePath}
          scriptVariant={scriptVariant}
          currentScripts={currentScripts}
          onDealChange={onDealChange}
        />
      ) : (
        <CallScriptSections
          deal={deal}
          activePath={activePath}
          storageScope={`${activePath}-${scriptVariant}`}
          sections={[
            {
              id: 'opening',
              eyebrow: 'Opening',
              title: 'Appointment Setter / Control Frame',
              body: currentScripts.opening,
              accent: 'amber',
            },
            {
              id: 'acquisition',
              eyebrow: 'Acquisition',
              title: 'Numbers, Pitch, and Structure',
              body: currentScripts.acquisition,
              accent:
                currentPath.color === 'green'
                  ? 'green'
                  : currentPath.color === 'amber'
                    ? 'amber'
                    : 'blue',
              defaultOpen: true,
            },
            {
              id: 'closing',
              eyebrow: 'Closing',
              title: 'Commitment and Next Steps',
              body: currentScripts.closing,
              accent: 'green',
            },
          ]}
        />
      )}

      <div className="mt-3 text-[10px] text-gray-500 dark:text-gray-400 text-center">
        All scripts auto-populate with your deal data
      </div>
    </div>
  );

  return (
    <div className="p-3.5">
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-1 h-3 bg-purple-500 rounded-sm"></div>
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-purple-500">
              Path Selector
            </h3>
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400">
            Tap a path and the tracker, scripts, objections, and live inputs update instantly.
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {pathOptions.map((option) => {
            const isActive = option.id === activePath;
            const toneClasses =
              option.tone === 'green'
                ? isActive
                  ? 'border-green-500 bg-green-500 text-white shadow-green-500/25'
                  : 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300'
                : option.tone === 'blue'
                  ? isActive
                    ? 'border-blue-500 bg-blue-500 text-white shadow-blue-500/25'
                    : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300'
                  : option.tone === 'purple'
                    ? isActive
                      ? 'border-purple-500 bg-purple-500 text-white shadow-purple-500/25'
                      : 'border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-950/30 dark:text-purple-300'
                    : option.tone === 'amber'
                      ? isActive
                        ? 'border-amber-500 bg-amber-500 text-white shadow-amber-500/25'
                        : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
                      : isActive
                        ? 'border-slate-600 bg-slate-700 text-white shadow-slate-900/30'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300';

            return (
              <button
                key={option.id}
                onClick={() => onSelectPath(option.id)}
                className={`min-w-fit rounded-full border px-4 py-2 text-left transition-all shadow-sm ${toneClasses}`}
              >
                <div className="text-[9px] font-semibold uppercase tracking-[0.2em] opacity-80">
                  Path
                </div>
                <div className="text-[12px] font-semibold leading-tight">{option.label}</div>
              </button>
            );
          })}
        </div>
      </div>

      <LiveDealTrackerPanel deal={deal} activePath={activePath} />

      {renderPathScriptsPanel()}

      {/* Call Notes */}
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
          <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
            Call Notes
          </h3>
        </div>

        <textarea
          value={callNotes}
          onChange={(e) => setCallNotes(e.target.value)}
          placeholder="Take notes during your call..."
          className="w-full h-32 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12.5px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all resize-vertical"
        />
      </div>

      {/* Live Call Inputs - PDF Data */}
      <LiveCallInputs
        deal={deal}
        onDealChange={onDealChange}
        selectedPath={getLiveInputPath(activePath)}
        canonicalPath={activePath}
      />

      {/* Quick Actions */}
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
          <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
            Post-Call Actions
          </h3>
        </div>

        <div className="space-y-2">
          <button className="w-full px-4 py-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-green-800 dark:text-green-300 text-[12px] font-medium text-left hover:bg-green-100 dark:hover:bg-green-900/30 transition-all">
            Schedule Follow-up Call
          </button>
          <button className="w-full px-4 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 text-blue-800 dark:text-blue-300 text-[12px] font-medium text-left hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-all">
            Send Offer Email
          </button>
          <button className="w-full px-4 py-2 rounded-lg bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-gray-800 dark:text-gray-300 text-[12px] font-medium text-left hover:bg-gray-100 dark:hover:bg-slate-800 transition-all">
            Add to CRM
          </button>
        </div>
      </div>
    </div>
  );
}


