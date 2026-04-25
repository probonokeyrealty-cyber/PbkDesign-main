import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Landmark, MessageSquareQuote, Sparkles } from 'lucide-react';
import { DealData, PBKPath } from '../types';
import { formatCurrency, sanitizeLegacyCopy } from '../utils/formatting';
import { downloadTextFile } from '../utils/fileExport';
import { InvestorYield } from './InvestorYield';
import { CallScriptSections } from './CallScriptSections';
import {
  calculateCreativeFinanceMath,
  calculateMarketPiti,
  amortizedPayment,
} from '../utils/dealCalculations';

type ScriptVariant = 'owner' | 'agent';

interface ScriptBundle {
  opening: string;
  acquisition: string;
  closing: string;
}

interface PathWorkflowPanelProps {
  deal: DealData;
  activePath: PBKPath;
  scriptVariant: ScriptVariant;
  currentScripts: ScriptBundle;
  onDealChange: (updates: Partial<DealData>) => void;
}

interface ObjectionItem {
  q: string;
  l1: string;
  l2: string;
  l3: string;
  close: string;
}

interface OfferCard {
  id: string;
  label: string;
  badge: string;
  price: number;
  down: number;
  rate: number;
  term: number;
  monthly: number;
  summary: string;
}

function isLandPath(path: PBKPath) {
  return path === 'land-agent' || path === 'land-owner' || path === 'rbp-land';
}

function formatLine(label: string, value: string) {
  return `${label}: ${value}`;
}

function buildCreativeOffers(deal: DealData): OfferCard[] {
  const price = deal.price || deal.agreedPrice || 0;
  const math = calculateCreativeFinanceMath(
    price,
    deal.arv || 0,
    deal.rent || 0,
    deal.balance || 0,
    deal.rate || 0,
    deal.mao60 || 0,
  );

  return [
    {
      id: 'cf-anchor',
      label: 'Offer 1',
      badge: 'Anchor',
      price: math.offerOne.price,
      down: math.offerOne.down,
      rate: math.offerOne.rate,
      term: math.offerOne.term,
      monthly: math.offerOne.monthly,
      summary: `I can come to ${formatCurrency(math.offerOne.price)} with ${formatCurrency(math.offerOne.down)} down, ${math.offerOne.rate}% carry, and ${formatCurrency(math.offerOne.monthly)}/mo to the seller.`,
    },
    {
      id: 'cf-max',
      label: 'Offer 2',
      badge: 'Maximum',
      price: math.offerTwo.price,
      down: math.offerTwo.down,
      rate: math.offerTwo.rate,
      term: math.offerTwo.term,
      monthly: math.offerTwo.monthly,
      summary: `My maximum structure is ${formatCurrency(math.offerTwo.price)}, ${formatCurrency(math.offerTwo.down)} down, and ${math.offerTwo.rate > 0 ? `${math.offerTwo.rate}% carry` : '0% carry'}.`,
    },
  ];
}

function buildMtOffers(deal: DealData) {
  const price = deal.price || deal.agreedPrice || 0;
  const balance = deal.mtBalanceConfirm || deal.balance || 0;
  const rate = deal.mtRateConfirm || deal.rate || 0;
  const months = 360;
  const monthlyRate = rate > 0 ? rate / 100 / 12 : 0;
  const payment =
    balance > 0 && monthlyRate > 0
      ? Math.round(
          balance *
            ((monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1)),
        )
      : 0;
  const gap = Math.max(0, price - balance);
  const carryMonths = 240;
  const gapCarry =
    gap > 0 && monthlyRate > 0
      ? Math.round(
          gap * ((monthlyRate * Math.pow(1 + monthlyRate, carryMonths)) / (Math.pow(1 + monthlyRate, carryMonths) - 1)),
        )
      : 0;

  return [
    {
      id: 'mt-anchor',
      label: 'Offer 1',
      badge: 'Anchor',
      upfront: Math.round(price * 0.03),
      monthly: payment,
      type: 'subto' as const,
      summary: `Take over the existing loan with ${formatCurrency(Math.round(price * 0.03))} to seller and preserve the current note.`,
    },
    {
      id: 'mt-max',
      label: 'Offer 2',
      badge: 'Maximum',
      upfront: Math.round(price * 0.08),
      monthly: gapCarry,
      type: 'carry-gap' as const,
      summary: `Stretch with ${formatCurrency(Math.round(price * 0.08))} upfront and carry the equity gap separately if needed.`,
    },
  ];
}

function buildCreativeObjections(deal: DealData): ObjectionItem[] {
  const price = deal.price || 0;
  const mao60 = deal.mao60 || 0;
  return [
    {
      q: 'My seller will not do seller financing.',
      l1: 'That is a fair reaction. Most sellers hear "seller financing" and picture uncertainty.',
      l2: 'What specifically worries them most: default risk, tax treatment, or the note staying tied to the property?',
      l3: 'Title still transfers at closing. The note is secured against the property, and a deed-in-lieu clause gives the seller a clean path back to the asset if I ever default.',
      close: 'If I send a one-page explanation of the protection language, will you share it before ruling it out?',
    },
    {
      q: 'My seller needs all cash at close.',
      l1: 'Understood. Usually that means there is a very specific cash need tied to the sale.',
      l2: `If the cash need is around ${formatCurrency(Math.round(price * 0.07))}, I can often shape the down payment to solve that and carry the rest.`,
      l3: `A full-cash investor usually lands closer to ${formatCurrency(mao60)}. Structuring it can keep the seller materially above that cash baseline.`,
      close: 'What is the minimum cash at close that would make the seller comfortable?',
    },
    {
      q: 'We already have a conventional offer.',
      l1: 'That is great if it truly closes. I mean that.',
      l2: 'Has the lender approved this actual property at this exact price, or do you only have the buyer pre-approved?',
      l3: 'At today’s DSCR rules, a financed investor often fails at the address level even when the buyer looks qualified on paper.',
      close: 'Would your seller be open to a clean backup structure in case the financed buyer slips in underwriting?',
    },
    {
      q: 'What if you stop making payments?',
      l1: 'That is the right question.',
      l2: 'We use third-party servicing and seller protections so the note is tracked and documented every month.',
      l3: 'The deed-in-lieu language is there specifically so the seller does not have to fight through a long foreclosure process.',
      close: 'Should I send the exact default-protection clause for attorney review?',
    },
    {
      q: 'My seller has to talk to their accountant about taxes.',
      l1: 'They absolutely should.',
      l2: 'Seller financing often qualifies for installment-sale treatment, which can spread the capital-gains hit across the life of the note.',
      l3: 'I can package the structure terms, payment schedule, and security terms into one clean summary for their CPA.',
      close: 'Want me to send that summary today so the accountant has something concrete to react to?',
    },
    {
      q: 'This sounds complicated. The seller just wants a simple sale.',
      l1: 'Simple is better, and this can still stay simple.',
      l2: 'The seller gets near their number, receives cash at closing, and then receives the rest through documented monthly payments.',
      l3: 'The only thing changing from a normal sale is the timing of the proceeds, not the professionalism of the closing.',
      close: `If I can show the seller how this beats a ${formatCurrency(mao60)} cash offer, is it worth a short conversation?`,
    },
  ];
}

function buildMtObjections(deal: DealData): ObjectionItem[] {
  const price = deal.agreedPrice || deal.price || 0;
  const cashPrice = deal.mao60 || 0;
  const stretch = Math.round(price * 1.08);
  const spread = Math.abs(cashPrice - price);
  const down = Math.round(price * 0.04);

  return [
    {
      q: 'The due-on-sale clause means the lender could call the loan.',
      l1: 'You are right to ask that. The clause exists in nearly every standard mortgage.',
      l2: 'In practice, lenders care most about performance. When the payment stays current, the note rarely becomes the issue people imagine.',
      l3: 'If a lender ever did escalate, I would still control the outcome through refinance or payoff. That is a solvable risk, not a mystery risk.',
      close: 'Would a written lender-risk plan make your seller comfortable enough to keep talking?',
    },
    {
      q: 'My seller needs all cash at closing.',
      l1: 'Understood. Usually there is a real reason behind that.',
      l2: `I can often stretch the upfront closer to ${formatCurrency(stretch)} if that solves an immediate need and the rest carries in the structure.`,
      l3: `A straight cash buyer is usually closer to ${formatCurrency(cashPrice)}. That is roughly ${formatCurrency(spread)} less than what structure can preserve for the seller.`,
      close: 'What is the minimum cash number at close that solves the seller’s situation?',
    },
    {
      q: 'What if you stop making payments?',
      l1: 'That is a fair concern.',
      l2: 'The seller should expect transparent servicing, statements, and default protections if they are going to trust a subject-to structure.',
      l3: `I also have real skin in the game with an upfront contribution around ${formatCurrency(down)}, so walking away would not make business sense.`,
      close: 'Would it help if I sent the deed-in-lieu and servicing explanation for review?',
    },
    {
      q: 'We already have a conventional offer.',
      l1: 'If that closes, great.',
      l2: 'I just want to know whether the approval is property-specific or still a buyer-only pre-approval.',
      l3: 'A lot of financed investment offers die after 20 to 30 days because the property does not meet lender math even when the buyer looks strong.',
      close: 'Would your seller take a backup structure so they are not starting over if the financed buyer falls apart?',
    },
    {
      q: 'My seller needs to ask their CPA about taxes.',
      l1: 'That is smart and I would encourage it.',
      l2: 'The key here is that timing of proceeds can materially change how the tax conversation goes, especially when part of the value is deferred.',
      l3: 'I can send a short CPA-ready breakdown so they are reacting to exact numbers, not a vague story.',
      close: 'Should I send that CPA summary today?',
    },
    {
      q: 'This feels risky because the seller has never heard of it.',
      l1: 'That is actually common.',
      l2: 'Most sellers have not heard of subject-to until they are face-to-face with a real investor who can explain it cleanly.',
      l3: 'The process still closes through title like any other sale. The only real difference is how the debt is handled after closing.',
      close: 'Would a plain-English two-page overview help before the seller decides?',
    },
    {
      q: 'My seller is behind on payments or in a loan modification.',
      l1: 'I understand. That is a stressful place to be.',
      l2: 'A loan modification often just pushes missed payments to the back end. It changes timing, but it does not erase the burden.',
      l3: 'If the arrears can be capitalized, I may be able to take the mortgage over as-is, stop the spiral, and get the seller out cleanly.',
      close: 'Would the seller rather delay the problem with a loan mod, or exit it cleanly now?',
    },
  ];
}

function buildLandObjections(deal: DealData, agentMode: boolean): ObjectionItem[] {
  const offer = formatCurrency(deal.offer || deal.mao60 || 0);
  const rbpOffer = formatCurrency(deal.builderTotal || deal.maoRBP || 0);

  return [
    {
      q: 'The number is too low.',
      l1: 'I understand, and I want to be direct about how I got there.',
      l2: 'Land value starts with what a builder can pay after site work, approvals, utilities, and margin are backed out.',
      l3: agentMode
        ? 'If the cash number is not enough, tell me where the seller needs to be and I will see if there is room to tighten the builder-backed structure.'
        : `If the cash number does not work, I may have a slower RBP-style path that can push closer to ${rbpOffer}.`,
      close: agentMode
        ? 'If I can sharpen the structure and still keep it real, is there a number worth taking back to the seller?'
        : 'If the seller can wait a little longer, is it worth hearing the higher-number option before saying no?',
    },
    {
      q: 'I can get more by listing it.',
      l1: 'You might be right, and I would never tell you not to test the market.',
      l2: 'The tradeoff is time. Land can sit for months while taxes, HOA, and uncertainty keep running in the background.',
      l3: `My structure is ${offer} cash with a clean close timeline, not a paper number that sits in limbo.`,
      close: 'If I can get close to the seller’s real net without the wait, would that be worth considering?',
    },
    {
      q: 'I need to think about it.',
      l1: 'Of course.',
      l2: 'Usually there is one specific thing creating the hesitation: number, timing, or confidence in the process.',
      l3: 'If we name the real concern now, I can answer it directly instead of leaving you with a question mark.',
      close: 'What would need to be true for this to feel like a yes today?',
    },
    {
      q: 'I already have another offer.',
      l1: 'Competition is healthy.',
      l2: 'The real question is how that offer is structured and whether it is actually going to close.',
      l3: 'With land, the prettiest number is often the first one to disappear once diligence starts digging into the lot.',
      close: 'Would you share the structure so I can tell you honestly whether I can compete?',
    },
    {
      q: 'The county has it assessed higher.',
      l1: 'County value and market value are rarely the same on land.',
      l2: 'The county is not underwriting builder carry, site work, utility access, entitlement risk, or the resale margin.',
      l3: 'I base my number on what lots like this are actually trading for, not what the county assigns on paper.',
      close: 'Would walking through the comp logic help the seller understand the offer?',
    },
  ];
}

function buildCreativeObjectionsV5(deal: DealData): ObjectionItem[] {
  const price = deal.price || 0;
  const mao60 = deal.mao60 || 0;
  const immediateCashNeed = formatCurrency(Math.round(price * 0.07));
  const nearAsk = formatCurrency(Math.round(price * 0.95));

  return [
    {
      q: 'My seller will not do seller financing.',
      l1: 'That is a fair reaction, and I respect it. Most sellers hear "seller financing" and picture uncertainty.',
      l2: 'What specifically concerns them: risk of default, tax treatment, or the fact that the loan stays in their name?',
      l3: 'Title transfers on day one. The note is secured against the property with a recorded lien. The deed-in-lieu clause means if I miss a payment, your seller gets the property back without going through foreclosure. Their attorney can review the clause before signing.',
      close: 'If I can send a one-page summary of how the deed-in-lieu protection works, would you be willing to share it with your seller before making a final decision?',
    },
    {
      q: 'My seller needs all cash at close.',
      l1: 'Understood. Can I ask what the cash is being used for: another purchase, paying off debt, or just liquidity?',
      l2: `The reason I ask: I can sometimes increase the down payment to cover an immediate cash need. The note carries the rest. If the need is ${immediateCashNeed} at close, I can structure toward that.`,
      l3: 'At current rates, a buyer who can offer near-ask and all cash on this property does not exist in today\'s market. The math does not work for a conventional investor. Partial cash now plus ongoing note income is actually a stronger position than waiting for a cash offer that beats them down.',
      close: 'What is the minimum amount at close that would make this work for your seller?',
    },
    {
      q: 'We already have a conventional offer.',
      l1: 'I respect that. And if that offer closes, your seller wins. I mean that.',
      l2: 'Has the buyer\'s lender given a conditional approval specifically on this property at this price? Not a pre-qual letter, an actual conditional approval tied to this address.',
      l3: 'At current DSCR underwriting standards, a financed investment buyer cannot clear approval on this property at asking price. That is not a negotiating position. It is an arithmetic fact.',
      close: 'Would your seller be open to a backup offer so they have a clean exit if the conventional buyer\'s financing does not survive underwriting?',
    },
    {
      q: 'What if you stop making payments?',
      l1: 'That is exactly the right question and I take it seriously.',
      l2: 'We set up the note through a licensed third-party loan servicer who tracks every payment and reports to both parties. Your seller gets a monthly statement.',
      l3: 'The deed-in-lieu clause means if I ever miss a payment, your seller files a simple notice and gets the property back. No court. No foreclosure timeline. No attorneys dragging it out for six months.',
      close: 'Would it help if I sent you the exact deed-in-lieu language so your seller\'s attorney can review it before we go any further?',
    },
    {
      q: 'My seller has to talk to their accountant about taxes.',
      l1: 'That is the right call and I would encourage it. This is a significant transaction.',
      l2: 'Seller financing has a real tax advantage called installment sale treatment. Instead of recognizing the full capital gain in the year of sale, your seller can spread it over the life of the note as payments are received.',
      l3: 'I can provide a clean one-page structure summary: deal mechanics, payment schedule, and security details. It answers most of the questions and makes that CPA conversation faster.',
      close: 'Should I put that summary together so your seller\'s accountant has everything they need to give a clear opinion?',
    },
    {
      q: 'This sounds complicated. The seller just wants a simple sale.',
      l1: 'I hear that. Simple is better. Let me give you the 30-second version.',
      l2: 'Your seller gets near their asking price. I bring cash to the table at closing. Title transfers, they are completely out. I handle the ongoing obligation. They start receiving monthly income from the note.',
      l3: 'The only thing different from a cash sale is the timing of when they receive the full amount. Everything else, closing, title transfer, no more liability, happens the same way.',
      close: `If I can show that the net to your seller is ${nearAsk} compared to ${formatCurrency(mao60)} on a cash offer, is that worth a 10-minute conversation with them?`,
    },
    {
      q: 'My seller is behind on payments / in pre-foreclosure / doing a loan mod.',
      l1: 'I understand. That is a stressful place to be. A loan modification can feel like the only option when they are drowning.',
      l2: 'A loan mod usually moves the missed payments to the back end. It does not erase them. Your seller still owes every dollar, and they are still in a mortgage they cannot afford.',
      l3: 'If the bank agrees to put the arrears on the back end of the loan, I may be able to structure a clean exit that stops the spiral, avoids foreclosure, and gets the seller out without future payments.',
      close: 'Would your seller rather have a loan mod that only delays the problem, or a clean exit today with no more mortgage burden?',
    },
  ];
}

function buildMtObjectionsV5(deal: DealData): ObjectionItem[] {
  const price = deal.agreedPrice || deal.price || 0;
  const cashPrice = deal.mao60 || 0;
  const stretch = Math.round(price * 1.08);
  const spread = Math.abs(cashPrice - price);
  const down = Math.round(price * 0.04);

  return [
    {
      q: 'The due-on-sale clause - lender could call the loan.',
      l1: 'You are right to ask. That clause exists in every conventional mortgage.',
      l2: 'In practice, lenders only call the loan if payments stop. We set up payments from a separate account and keep the loan performing.',
      l3: 'If they ever called it, I have the capital path to refinance or pay it off. I will put that lender-risk plan in writing, and any real estate attorney can review that subject-to is legal and common.',
      close: 'Would a written guarantee that I will cover any lender-related costs satisfy your seller?',
    },
    {
      q: 'My seller needs all cash at closing.',
      l1: 'Understood. What is the cash needed for: another purchase or paying off debt?',
      l2: `I can increase the upfront to ${formatCurrency(stretch)} at closing if that solves the immediate need. The rest carries as a note. Your seller gets cash now plus monthly income.`,
      l3: `A pure cash buyer prices in the rate risk and comes in around ${formatCurrency(cashPrice)}. That is roughly ${formatCurrency(spread)} less. My structure preserves more value and still gets cash to the seller at closing.`,
      close: 'What is the minimum cash at closing that would make this a yes today?',
    },
    {
      q: 'What if you stop making payments?',
      l1: 'That is fair. Here is the protection built in.',
      l2: `1) Deed-in-lieu clause if I miss a payment. 2) Third-party loan servicing with monthly statements. 3) I am putting ${formatCurrency(down)} into the deal, so I have too much to lose to walk away.`,
      l3: 'The clause is there for peace of mind and to avoid a long foreclosure fight if something ever went wrong.',
      close: 'Can I send you the exact deed-in-lieu language so their attorney can review it?',
    },
    {
      q: 'We already have a conventional offer.',
      l1: 'That is great. If it closes, your seller wins. I mean that.',
      l2: 'Has the buyer\'s lender given a conditional approval specifically on this property at this price? Not a pre-qual letter, an actual approval tied to this address.',
      l3: 'At today\'s DSCR standards, a financed investment buyer often cannot clear underwriting at asking price. If that offer falls apart in 30 days, my offer is still here as a backup.',
      close: 'Would your seller be open to a backup offer with no obligation?',
    },
    {
      q: 'My seller has to talk to their accountant about taxes.',
      l1: 'Absolutely. They should.',
      l2: 'Seller financing may qualify for installment sale treatment under IRS Section 453. Instead of paying capital gains on the full sale price in year one, they may be able to spread it over the life of the note.',
      l3: 'I can provide a one-page CPA summary with the payment schedule, interest breakdown, and security terms.',
      close: 'Should I email that over today?',
    },
    {
      q: 'My seller has not heard of this before. It sounds risky.',
      l1: 'That is actually common.',
      l2: 'Subject-to and seller carry are used by investors every day. The reason most sellers have not heard of it is that few buyers can explain and execute it cleanly.',
      l3: 'Every step is handled by a licensed title company, the same as any conventional sale. Only the payment mechanism differs.',
      close: 'Would you let me send a two-page plain-English summary before your seller decides?',
    },
    {
      q: 'My seller is behind on payments / in pre-foreclosure / doing a loan mod.',
      l1: 'I understand. That is a stressful place to be. A loan modification can feel like the only option when you are drowning.',
      l2: 'A loan mod usually just moves the missed payments to the back end. It does not erase them. Your seller still owes every dollar, and they are still in a mortgage they cannot afford.',
      l3: 'If the bank agrees to put the arrears on the back end of the loan, I can take over the mortgage as-is. They walk away with no foreclosure on record, no future payments, and no more monthly burden.',
      close: 'Would your seller rather have a loan mod that only delays the problem, or a clean exit today with no more mortgage?',
    },
  ];
}

function buildLandObjectionsV5(deal: DealData, agentMode: boolean): ObjectionItem[] {
  const offer = formatCurrency(deal.offer || deal.mao60 || 0);
  const rbpOffer = formatCurrency(deal.builderTotal || deal.maoRBP || 0);

  return [
    {
      q: 'The number is too low.',
      l1: 'I completely understand, and I want to be straight with you about how I got there.',
      l2: 'Land value comes down to what a builder will pay me after I account for approvals, site work, utilities, and build margin. I am working backwards from that number.',
      l3: agentMode
        ? 'If the cash number does not work for the seller, tell me where they need to be and I will see if I can tighten the builder-backed cash structure without creating a deal that falls apart.'
        : `If the cash number does not work for you, I do have a Retail Buyer Program that could get you to ${rbpOffer}. That takes a few extra weeks but puts more in your pocket.`,
      close: agentMode
        ? 'If I could sharpen the cash offer and still keep it clean, is there a number worth presenting back to the seller?'
        : 'Would it be worth a quick conversation about the RBP option before you decide?',
    },
    {
      q: 'I can get more listing it with a Realtor.',
      l1: 'You might be right, and I would never tell you not to explore that.',
      l2: 'Land listings can sit for 6 to 18 months, especially without a motivated builder-buyer already in the pipeline. In that time you are carrying taxes and possibly HOA.',
      l3: `My offer is ${offer} cash, close in 21 days, zero fees or commissions out of your pocket. No waiting, no contingencies.`,
      close: 'If I could match or beat your net after commissions and carrying costs, would you consider closing now?',
    },
    {
      q: 'I need to think about it.',
      l1: 'Of course. This is a real decision and I respect that.',
      l2: 'Can I ask what specifically is giving you pause? Is it the number, the timeline, or something about the process?',
      l3: 'Most land sellers I talk to have one specific concern that has not been answered yet. Let me address it right now rather than leave you with an open question.',
      close: 'What would make you feel completely comfortable moving forward today?',
    },
    {
      q: 'I already have another offer.',
      l1: 'That is great. Competition is healthy and it tells me you have a strong lot.',
      l2: 'Before you move forward, do you know how they are buying: cash, financing, or conditional? And is there earnest money already down?',
      l3: 'The number that matters is the one that actually closes. I have seen land deals fall apart at the lender level or when a builder walks after the inspection period.',
      close: 'Would you be willing to share the offer structure so I can tell you honestly whether I can match it?',
    },
    {
      q: 'Why so low? The county has it assessed higher.',
      l1: 'County assessed value and market value are two different things, especially for raw land.',
      l2: 'Assessed value does not account for what a builder actually needs to get out of a lot after site costs, permits, and build margin.',
      l3: 'I base my number on what similar lots in this zip have actually traded for recently, not what the county thinks it is worth on paper.',
      close: 'Would you be open to me walking you through the comps I used to arrive at this number?',
    },
  ];
}

function buildLandScripts(deal: DealData, agentMode: boolean) {
  const address = deal.address || '[PROPERTY ADDRESS]';
  const lotSize = deal.landLotSizeConfirm || deal.lotSize || 'quarter-acre lot';
  const offer = formatCurrency(deal.offer || deal.mao60 || 0);
  const builderPays = formatCurrency(deal.builderTotal || deal.maoRBP || 0);
  const timeline = deal.timeline || '21 days';
  const earnest = deal.earnestDeposit || '3 business days';
  const zip = deal.zipCode || '[ZIP]';

  if (agentMode) {
    return {
      call: [
        'Permission Open',
        `Hey, this is PBK calling about the land listing at ${address}. Did I catch you at an okay time for a quick question?`,
        'Positioning',
        `I work with cash builder buyers focused on buildable ${lotSize} lots in this area. Before I make an offer, I wanted to confirm a few things quickly.`,
        'Qualification',
        'Is the lot fully buildable as-is?',
        'Any soil, perc, wetlands, flood-zone, or utility issues I should know about?',
        'Has the seller seen any serious offers yet?',
        'Offer Frame',
        `If the numbers line up, I would be around ${offer} cash, close in ${timeline}, with earnest delivered ${earnest}.`,
      ].join('\n\n'),
      voicemail: `Hi, this is PBK calling about the land listing at ${address}. I may have a builder-backed cash offer for your seller around ${offer}, with a ${timeline} close and clean title only. Call me back when you can and I will walk you through it.`,
      text: `Hi, this is PBK regarding the land listing at ${address}. Cash builder buyer here. I may be around ${offer} with a ${timeline} close. Worth a quick call?`,
      followup: [
        `Day 3: Following up on ${address}. Still interested around ${offer} cash. Did the seller have any reaction?`,
        `Day 14: Quick follow-up on ${address}. Offer still stands around ${offer}. If the seller has a target number, I am happy to revisit.`,
      ].join('\n\n'),
      qual: [
        'Land Qualification Checklist',
        'Buildable as-is',
        'Soil / perc complete',
        'Electric or utilities at the street',
        'Flood zone / wetlands confirmed',
        `Lot size confirmed: ${lotSize}`,
        'Zoning confirmed',
        'Any prior offers or expired contracts',
      ].join('\n'),
      rules: [
        'Land Buying Rules',
        'Start from what the builder will pay, then work backward.',
        'Utilities and buildability beat pretty listing copy every time.',
        'Avoid flood or wetlands unless the discount is deep enough to justify the risk.',
        'Clear title and predictable diligence timelines matter more than a stretched paper price.',
        `Stay disciplined on close timing. Current target: ${timeline}.`,
      ].join('\n'),
    };
  }

  return {
    call: [
      'Permission Open',
      `Hey, is this the owner of the lot at ${address}? This is PBK. Did I catch you at a bad time?`,
      'Positioning',
      `I buy land in this area and your ${lotSize} caught my eye. I may be able to make you a clean cash offer with no commissions and no listing headaches.`,
      'Qualification',
      'Has the lot been listed recently or mostly off-market?',
      'Have you had any real offers or mostly quiet activity?',
      'Do you know if the lot is fully buildable?',
      'Offer Frame',
      `If the fit is there, I would be around ${offer} cash and can close in ${timeline} through title.`,
      'RBP Pivot',
      `If the cash number is light and you can wait a little longer, I may have a higher-number path closer to ${builderPays}.`,
    ].join('\n\n'),
    voicemail: `Hi, this is PBK calling about your land at ${address}. I may be able to make you a clean cash offer around ${offer} with a ${timeline} close and no extra fees. Call me back if you want to talk through it.`,
    text: `Hi, this is PBK about your land at ${address}. I buy lots in this area for cash and may be around ${offer} with a ${timeline} close. Interested in a quick conversation?`,
    followup: [
      `Day 3: Following up on the lot at ${address}. I am still around ${offer} cash if the timing works for you.`,
      `Day 10: One more touch on ${address}. If the cash number is not enough, I can also explain the higher-number option around ${builderPays}.`,
      `Day 30: Checking in on ${address}. If anything has changed, I can move quickly.`,
    ].join('\n\n'),
  };
}

function ObjectionsAccordion({ items, scope }: { items: ObjectionItem[]; scope: string }) {
  const [openId, setOpenId] = useState<string | null>(items[0]?.q || null);

  useEffect(() => {
    setOpenId(items[0]?.q || null);
  }, [scope, items]);

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const isOpen = openId === item.q;
        const safeQuestion = sanitizeLegacyCopy(item.q);
        const safeClose = sanitizeLegacyCopy(item.close);
        const objectionParts = [
          { label: 'Acknowledge', body: sanitizeLegacyCopy(item.l1) },
          { label: 'Reframe', body: sanitizeLegacyCopy(item.l2) },
          { label: 'Authority', body: sanitizeLegacyCopy(item.l3) },
        ];
        return (
          <div key={`${scope}-${item.q}`} className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : item.q)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                  Objection
                </div>
                <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{safeQuestion}</div>
              </div>
              <div className="rounded-full border border-gray-200 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500 dark:border-slate-700 dark:text-gray-300">
                {isOpen ? 'Hide' : 'Open'}
              </div>
            </button>
            {isOpen ? (
              <div className="border-t border-gray-100 px-4 py-4 dark:border-slate-800">
                <div className="grid gap-3 md:grid-cols-3">
                  {objectionParts.map((part) => (
                    <div key={part.label} className="rounded-2xl bg-gray-50 p-3 dark:bg-slate-800/80">
                      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                        {part.label}
                      </div>
                      <div className="mt-2 text-sm leading-6 text-gray-700 dark:text-gray-200">{part.body}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800/60 dark:bg-emerald-900/10">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
                    Close Move
                  </div>
                  <div className="mt-2 text-sm leading-6 text-emerald-900 dark:text-emerald-100">{safeClose}</div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">{value}</div>
      <div className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{note}</div>
    </div>
  );
}

function ScriptSurface({
  eyebrow,
  title,
  body,
  filename,
}: {
  eyebrow: string;
  title: string;
  body: string;
  filename: string;
}) {
  const safeEyebrow = sanitizeLegacyCopy(eyebrow);
  const safeTitle = sanitizeLegacyCopy(title);
  const safeBody = sanitizeLegacyCopy(body);

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">{safeEyebrow}</div>
          <h4 className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">{safeTitle}</h4>
        </div>
        <button
          type="button"
          onClick={() => downloadTextFile(safeBody, filename)}
          className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 dark:border-slate-700 dark:text-gray-200 dark:hover:bg-slate-800"
        >
          <Download size={13} />
          Download
        </button>
      </div>
      <pre className="mt-4 whitespace-pre-wrap text-sm leading-7 text-gray-700 dark:text-gray-200">{safeBody}</pre>
    </div>
  );
}

function OfferBlock({
  offer,
  tone,
  onApply,
}: {
  offer: OfferCard;
  tone: 'blue' | 'purple';
  onApply: () => void;
}) {
  const toneClasses =
    tone === 'purple'
      ? 'border-purple-200 bg-purple-50/70 dark:border-purple-800/60 dark:bg-purple-900/10'
      : 'border-blue-200 bg-blue-50/70 dark:border-blue-800/60 dark:bg-blue-900/10';

  return (
    <div className={`rounded-3xl border p-4 ${toneClasses}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">{offer.label}</div>
          <div className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">{offer.badge}</div>
        </div>
        <button
          type="button"
          onClick={onApply}
          className="rounded-full bg-gray-900 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-gray-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
        >
          Apply to Live Terms
        </button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <MetricCard label="Price" value={formatCurrency(offer.price)} note="Working purchase target" />
        <MetricCard label="Down" value={formatCurrency(offer.down)} note="At execution / closing" />
        <MetricCard label="Rate / Term" value={`${offer.rate}% / ${offer.term} yrs`} note="Starting finance structure" />
        <MetricCard label="Monthly" value={offer.monthly > 0 ? `${formatCurrency(offer.monthly)}/mo` : '0% carry'} note="Seller note payment" />
      </div>
      <div className="mt-4 rounded-2xl bg-white/80 px-4 py-3 text-sm leading-6 text-gray-700 dark:bg-slate-900/60 dark:text-gray-200">
        {sanitizeLegacyCopy(offer.summary)}
      </div>
    </div>
  );
}

export function PathWorkflowPanel({
  deal,
  activePath,
  scriptVariant,
  currentScripts,
  onDealChange,
}: PathWorkflowPanelProps) {
  const creativeOffers = buildCreativeOffers(deal);
  const mtOffers = buildMtOffers(deal);
  const cfObjections = buildCreativeObjectionsV5(deal);
  const mtObjections = buildMtObjectionsV5(deal);
  const landAgentMode = activePath === 'land-agent';
  const landScripts = buildLandScripts(deal, landAgentMode);
  const landObjections = buildLandObjectionsV5(deal, landAgentMode);

  const [activeTab, setActiveTab] = useState<string>('open');

  useEffect(() => {
    if (activePath === 'cf') setActiveTab('analysis');
    else if (activePath === 'mt') setActiveTab('analysis');
    else if (isLandPath(activePath)) setActiveTab('scripts');
  }, [activePath]);

  const cfMath = calculateCreativeFinanceMath(
    deal.price || deal.agreedPrice || 0,
    deal.arv || 0,
    deal.rent || 0,
    deal.balance || 0,
    deal.rate || 0,
    deal.mao60 || 0,
  );
  const marketRatePayment = cfMath.marketPiti;
  const cfSupportedRent = deal.rent || 0;
  const cfCashAnchor = deal.mao60 || 0;
  const cfSpread = cfMath.spread;
  const mtBalance = deal.mtBalanceConfirm || deal.balance || 0;
  const mtRate = deal.mtRateConfirm || deal.rate || 0;
  const mtPayment = mtBalance > 0 && mtRate > 0 ? amortizedPayment(mtBalance, mtRate, 360) : 0;
  const mtMarketPayment = calculateMarketPiti(deal.price || deal.agreedPrice || 0);
  const mtSavings = mtMarketPayment > 0 && mtPayment > 0 ? mtMarketPayment - mtPayment : 0;
  const mtSpread = (deal.mao60 || 0) - (deal.agreedPrice || deal.price || 0);
  const mtRating =
    mtRate > 0 && mtRate < 4.5
      ? 'Elite rate asset'
      : mtRate > 0 && mtRate < 5.5
        ? 'Good rate asset'
        : mtRate > 0
          ? 'Review rate carefully'
          : 'Need confirmed loan terms';

  const cfCheckmateText = [
    `At roughly ${formatCurrency(marketRatePayment)}/mo for financed debt, the market math does not line up cleanly against rent near ${formatCurrency(cfSupportedRent)}/mo.`,
    'That is why a lender-backed investor struggles to survive underwriting at the current ask.',
    `A cash investor is usually anchored closer to ${formatCurrency(cfCashAnchor)}, which means structure is what keeps the seller above the wholesale baseline.`,
    `Current spread above MAO Cash: ${formatCurrency(cfSpread)}`,
    `Creative max from v5 engine: ${formatCurrency(cfMath.creativeMax)}.`,
    `Deal rating: ${cfMath.dealRating}.`,
  ].join('\n\n');

  const cfWrapText = [
    'If the seller is uncomfortable with subject-to mechanics, convert the conversation back to clean seller finance.',
    'Title transfers, the note is recorded in the seller’s favor, and deed-in-lieu language protects the downside.',
    'Same economic outcome, cleaner emotional framing.',
  ].join('\n\n');

  const mtAnalysisText = [
    formatLine('Current balance', formatCurrency(mtBalance)),
    formatLine('Existing rate', mtRate > 0 ? `${mtRate}%` : 'Need confirmation'),
    formatLine('Current payment', mtPayment > 0 ? `${formatCurrency(mtPayment)}/mo` : 'Need confirmation'),
    formatLine('Market replacement payment', mtMarketPayment > 0 ? `${formatCurrency(mtMarketPayment)}/mo` : '-'),
    formatLine('Monthly savings vs market', mtSavings > 0 ? `${formatCurrency(mtSavings)}/mo` : '-'),
    formatLine('Spread vs MAO Cash', formatCurrency(mtSpread)),
  ].join('\n');

  const landHeaderMetrics = [
    {
      label: 'Lot Size',
      value: deal.landLotSizeConfirm || deal.lotSize || 'Need confirmation',
      note: 'Land sizing currently in play',
    },
    {
      label: 'Offer to Seller',
      value: formatCurrency(deal.offer || deal.mao60 || 0),
      note: 'Current live call offer',
    },
    {
      label: 'Builder Pays',
      value: formatCurrency(deal.builderTotal || deal.maoRBP || 0),
      note: 'Topside builder reference',
    },
    {
      label: 'Close Timeline',
      value: deal.timeline || '21 days',
      note: 'Use this as the expectation anchor',
    },
  ];

  if (activePath === 'cf') {
    const tabs = [
      { id: 'analysis', label: 'Analysis' },
      { id: 'scripts', label: 'Scripts' },
      { id: 'objections', label: 'Objections' },
    ];

    return (
      <div className="rounded-[28px] border border-gray-200 bg-gradient-to-b from-white to-gray-50/80 p-4 shadow-sm dark:border-slate-700 dark:from-slate-900 dark:to-slate-950">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 pb-4 dark:border-slate-800">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-500">Creative Finance Workflow</div>
            <h3 className="mt-2 text-xl font-semibold text-gray-900 dark:text-gray-100">Agent-grade phases without losing the modern shell</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-300">
              Use the opening to control the frame, the checkmate section to create the financing problem, then pivot into structure instead of price.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700 dark:border-blue-800/60 dark:bg-blue-900/15 dark:text-blue-300">
            <Sparkles size={14} />
            {scriptVariant === 'agent' ? 'Agent Mode' : 'Owner Mode'}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-full px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-300 dark:hover:bg-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mt-5">
          {activeTab === 'analysis' ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <MetricCard label="Market Payment" value={marketRatePayment > 0 ? `${formatCurrency(marketRatePayment)}/mo` : '-'} note="What financed buyers are fighting against" />
                <MetricCard label="Rent Support" value={cfSupportedRent > 0 ? `${formatCurrency(cfSupportedRent)}/mo` : '-'} note="Current rent anchor" />
                <MetricCard label="Cash Anchor" value={formatCurrency(cfCashAnchor)} note="Straight cash baseline" />
                <MetricCard label="Creative Max" value={formatCurrency(cfMath.creativeMax)} note={cfMath.dealRating} />
              </div>
              <ScriptSurface
                eyebrow="Checkmate"
                title="Checkmate Narrative"
                body={cfCheckmateText}
                filename={`creative_finance_checkmate_${deal.address || 'template'}`}
              />
              {creativeOffers.map((offer, index) => (
                <OfferBlock
                  key={offer.id}
                  offer={offer}
                  tone={index === 0 ? 'blue' : 'purple'}
                  onApply={() =>
                    onDealChange({
                      agreedPrice: offer.price,
                      cfDownPayment: offer.down,
                      cfRate: offer.rate,
                      cfTerm: offer.term,
                      cfType: 'carry',
                    })
                  }
                />
              ))}
              <ScriptSurface
                eyebrow="Wrap Pivot"
                title="Wrap-to-Seller-Finance Language"
                body={cfWrapText}
                filename={`creative_finance_wrap_${deal.address || 'template'}`}
              />
              <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
                <div className="flex items-center gap-2">
                  <Landmark size={16} className="text-purple-500" />
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-purple-500">Yield Lens</div>
                </div>
                <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
                  Keep this visible while shaping the final terms so the conversation stays tied to investor reality, not just seller emotion.
                </p>
                <div className="mt-4">
                  <InvestorYield deal={deal} onDealChange={onDealChange} activePath="cf" />
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === 'scripts' ? (
            <CallScriptSections
              deal={deal}
              activePath={activePath}
              storageScope={`cf-${scriptVariant}`}
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
                  title: 'Numbers, Positioning, and Terms',
                  body: currentScripts.acquisition,
                  accent: 'blue',
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
          ) : null}

          {activeTab === 'objections' ? <ObjectionsAccordion items={cfObjections} scope="cf" /> : null}
        </div>
      </div>
    );
  }

  if (activePath === 'mt') {
    const tabs = [
      { id: 'analysis', label: 'Deal Analysis' },
      { id: 'script', label: 'Call Script' },
      { id: 'objections', label: 'Objections' },
    ];

    return (
      <div className="rounded-[28px] border border-gray-200 bg-gradient-to-b from-white to-gray-50/80 p-4 shadow-sm dark:border-slate-700 dark:from-slate-900 dark:to-slate-950">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 pb-4 dark:border-slate-800">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-purple-500">Mortgage Takeover Workflow</div>
            <h3 className="mt-2 text-xl font-semibold text-gray-900 dark:text-gray-100">Rate preservation, not just a script card</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-300">
              Use the analysis tab to prove the rate advantage, then move into a clean subject-to or carry-gap close without losing operator control.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-200 bg-purple-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-purple-700 dark:border-purple-800/60 dark:bg-purple-900/15 dark:text-purple-300">
            <Landmark size={14} />
            {scriptVariant === 'agent' ? 'Agent Mode' : 'Owner Mode'}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-full px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition ${
                activeTab === tab.id
                  ? 'bg-purple-600 text-white'
                  : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-300 dark:hover:bg-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mt-5">
          {activeTab === 'analysis' ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <MetricCard label="Existing Rate" value={mtRate > 0 ? `${mtRate}%` : '-'} note={mtRating} />
                <MetricCard label="Current Payment" value={mtPayment > 0 ? `${formatCurrency(mtPayment)}/mo` : '-'} note="Existing debt service" />
                <MetricCard label="Market Payment" value={mtMarketPayment > 0 ? `${formatCurrency(mtMarketPayment)}/mo` : '-'} note="Replacement debt at current market" />
                <MetricCard label="Monthly Savings" value={mtSavings > 0 ? `${formatCurrency(mtSavings)}/mo` : '-'} note="Why the rate asset matters" />
              </div>
              <ScriptSurface
                eyebrow="Analysis"
                title="Rate Asset Breakdown"
                body={mtAnalysisText}
                filename={`mortgage_takeover_analysis_${deal.address || 'template'}`}
              />
              <div className="grid gap-4 xl:grid-cols-2">
                {mtOffers.map((offer, index) => (
                  <div key={offer.id}>
                    <div className={`rounded-3xl border p-4 ${index === 0 ? 'border-purple-200 bg-purple-50/70 dark:border-purple-800/60 dark:bg-purple-900/10' : 'border-blue-200 bg-blue-50/70 dark:border-blue-800/60 dark:bg-blue-900/10'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">{offer.label}</div>
                          <div className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">{offer.badge}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            onDealChange({
                              agreedPrice: deal.price,
                              mtUpfront: offer.upfront,
                              mtBalanceConfirm: mtBalance,
                              mtRateConfirm: mtRate,
                              mtType: offer.type,
                            })
                          }
                          className="rounded-full bg-gray-900 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-gray-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                        >
                          Apply to Live Terms
                        </button>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <MetricCard label="Upfront" value={formatCurrency(offer.upfront)} note="Cash to seller at close" />
                        <MetricCard label="Existing Note" value={formatCurrency(mtBalance)} note={mtRate > 0 ? `${mtRate}% current rate` : 'Need rate confirmation'} />
                        <MetricCard label="Extra Carry" value={offer.monthly > 0 ? `${formatCurrency(offer.monthly)}/mo` : 'None'} note={offer.type === 'carry-gap' ? 'Gap note if equity needs to be carried' : 'Pure subject-to structure'} />
                      </div>
                      <div className="mt-4 rounded-2xl bg-white/80 px-4 py-3 text-sm leading-6 text-gray-700 dark:bg-slate-900/60 dark:text-gray-200">
                        {sanitizeLegacyCopy(offer.summary)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-purple-500" />
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-purple-500">Yield Lens</div>
                </div>
                <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
                  Keep this visible while negotiating so the conversation stays anchored to rate preservation and investor spread.
                </p>
                <div className="mt-4">
                  <InvestorYield deal={deal} onDealChange={onDealChange} activePath="mt" />
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === 'script' ? (
            <CallScriptSections
              deal={deal}
              activePath={activePath}
              storageScope={`mt-${scriptVariant}`}
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
                  title: 'Numbers and Structure',
                  body: currentScripts.acquisition,
                  accent: 'purple',
                  defaultOpen: true,
                },
                {
                  id: 'closing',
                  eyebrow: 'Closing',
                  title: 'Commitment and Relief Close',
                  body: currentScripts.closing,
                  accent: 'green',
                },
              ]}
            />
          ) : null}

          {activeTab === 'objections' ? <ObjectionsAccordion items={mtObjections} scope="mt" /> : null}
        </div>
      </div>
    );
  }

  if (isLandPath(activePath)) {
    const tabs = landAgentMode
      ? [
          { id: 'scripts', label: 'Scripts' },
          { id: 'objections', label: 'Objections' },
          { id: 'voicemail', label: 'Voicemail' },
          { id: 'text', label: 'Text' },
          { id: 'followup', label: 'Follow-Up' },
          { id: 'qual', label: 'Qual Sheet' },
          { id: 'rules', label: 'Buying Rules' },
        ]
      : [
          { id: 'scripts', label: 'Scripts' },
          { id: 'objections', label: 'Objections' },
          { id: 'voicemail', label: 'Voicemail' },
          { id: 'text', label: 'Text' },
          { id: 'followup', label: 'Follow-Up' },
        ];

    const tabContent: Record<string, string> = {
      voicemail: landScripts.voicemail,
      text: landScripts.text,
      followup: landScripts.followup,
      qual: landAgentMode ? landScripts.qual || '' : '',
      rules: landAgentMode ? landScripts.rules || '' : '',
    };

    return (
      <div className="rounded-[28px] border border-gray-200 bg-gradient-to-b from-white to-gray-50/80 p-4 shadow-sm dark:border-slate-700 dark:from-slate-900 dark:to-slate-950">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 pb-4 dark:border-slate-800">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
              {landAgentMode ? 'Land Agent Workflow' : activePath === 'rbp-land' ? 'RBP Land Workflow' : 'Land Owner Workflow'}
            </div>
            <h3 className="mt-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
              Builder-backed land scripts with the modern shell intact
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-300">
              Keep land operational. This stays lighter than the old HTML visually, but it brings back the real call phases, qualification tools, and objection handling.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            <MessageSquareQuote size={14} />
            {landAgentMode ? 'Agent Mode' : 'Owner Mode'}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {landHeaderMetrics.map((metric) => (
            <MetricCard key={metric.label} label={metric.label} value={metric.value} note={metric.note} />
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-full px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition ${
                activeTab === tab.id
                  ? 'bg-slate-700 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-300 dark:hover:bg-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mt-5">
          {activeTab === 'objections' ? (
            <ObjectionsAccordion items={landObjections} scope={landAgentMode ? 'land-agent' : 'land-owner'} />
          ) : activeTab === 'scripts' ? (
            <CallScriptSections
              deal={deal}
              activePath={activePath}
              storageScope={`${activePath}-${scriptVariant}`}
              sections={[
                {
                  id: 'opening',
                  eyebrow: 'Opening',
                  title: landAgentMode ? 'Agent Permission Open' : 'Owner Permission Open',
                  body: currentScripts.opening,
                  accent: 'amber',
                },
                {
                  id: 'acquisition',
                  eyebrow: 'Acquisition',
                  title: 'Land Qualification and Offer Frame',
                  body: currentScripts.acquisition,
                  accent: 'slate',
                  defaultOpen: true,
                },
                {
                  id: 'closing',
                  eyebrow: 'Closing',
                  title: 'Builder Next Steps and Commitment',
                  body: currentScripts.closing,
                  accent: 'green',
                },
              ]}
            />
          ) : (
            <ScriptSurface
              eyebrow={landAgentMode ? 'Land Agent' : 'Land Owner'}
              title={tabs.find((tab) => tab.id === activeTab)?.label || 'Workflow'}
              body={tabContent[activeTab] || ''}
              filename={`land_${activeTab}_${deal.address || 'template'}`}
            />
          )}
        </div>

        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/60 dark:bg-amber-900/10">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
            <AlertTriangle size={14} />
            Land Reminder
          </div>
          <p className="mt-2 text-sm leading-6 text-amber-900 dark:text-amber-100">
            Use land scripts to qualify buildability first. Pretty lots with bad utilities or entitlement risk still break the deal no matter how clean the call goes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[28px] border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
        <CheckCircle2 size={14} />
        Path workflow loaded
      </div>
      <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">
        This path does not need the dedicated workflow panel. The current modern script surface is already active.
      </p>
    </div>
  );
}
