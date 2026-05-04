import { DealData } from '../types';
import { formatCurrency } from '../utils/formatting';

export interface PbkScriptBundle {
  opening: string;
  acquisition: string;
  closing: string;
  objections: string;
}

export interface PbkPathScriptGroup {
  name: string;
  color: 'green' | 'amber' | 'blue' | 'purple' | 'gray';
  owner: PbkScriptBundle;
  agent: PbkScriptBundle;
}

export type PbkLegacyScriptPath = 'cash' | 'creative' | 'subto' | 'rbp' | 'land';

const clean = (value: string | number | undefined | null, fallback: string) =>
  value === undefined || value === null || value === '' ? fallback : String(value);

const money = (value: number | undefined | null, fallback = '[AMOUNT]') =>
  value && value > 0 ? formatCurrency(value) : fallback;

const payment = (balance: number, rate: number) => {
  const monthlyRate = rate > 0 ? rate / 100 / 12 : 0;
  if (!balance || !monthlyRate) return 0;
  return Math.round(
    balance * ((monthlyRate * Math.pow(1 + monthlyRate, 360)) / (Math.pow(1 + monthlyRate, 360) - 1)),
  );
};

function cashObjections(deal: DealData) {
  return [
    [
      'I need to think about it.',
      'Acknowledge: Of course. This is a big decision, and I respect that completely.',
      'Reframe: Can I ask, is it the price or the timing that you need to think through?',
      'Authority close: What would make you feel completely comfortable moving forward today?',
    ],
    [
      'Your number is too low.',
      'Acknowledge: I hear you. Your property means something to you, and I am not dismissing that.',
      'Reframe: Help me understand how you came up with your number.',
      'Authority close: If I show you the exact comps and repair math behind this number, would you be willing to look at it before making a final decision?',
    ],
    [
      'I have a higher offer from someone else.',
      'Acknowledge: That is great. If it closes, you win.',
      'Reframe: Is that offer cash or financed? Have they provided proof of funds? Is earnest money already down?',
      'Authority close: Would you be open to keeping my offer as a backup, no obligation, in case the other deal falls apart?',
    ],
    [
      'Agent: I already work with several investors.',
      'Acknowledge: That is smart. You are ahead of most agents.',
      'Reframe: Do any of them pay your full commission, protect the seller, and close without retrading?',
      'Authority close: Would you be opposed to having me as a backup if your other investors cannot perform?',
    ],
    [
      'Agent: We will just list it on the MLS.',
      'Acknowledge: Listing is a valid option.',
      `Reframe: For a distressed or stale property, DOM can run ${clean(deal.dom || 90, '90')}+ days before the seller has a real exit.`,
      'Authority close: What if I gave you a clean cash backstop today so your seller has a real option before waiting months?',
    ],
    [
      'How do I know you can actually close?',
      'Acknowledge: Fair question. Proof matters.',
      'Reframe: I can send proof of funds and place earnest money with title after agreement.',
      'Authority close: Would a refundable earnest deposit into escrow within 24 hours make you comfortable?',
    ],
  ].map((parts) => parts.join('\n')).join('\n\n');
}

function rbpObjections(deal: DealData) {
  const rbpGain = Math.max(0, (deal.maoRBP || 0) - (deal.mao60 || 0));
  return [
    [
      'Why would I get more money through your program than selling myself?',
      'Acknowledge: That is a fair question. You deserve to know exactly where the value comes from.',
      'Reframe: A retail buyer with a mortgage can pay more because they plan to live in the home. An investor has to make a profit, so they pay less.',
      'Authority close: Would you like me to show a side-by-side comparison of cash investor net versus the Retail Buyer Program?',
    ],
    [
      'I do not want to wait 60 days.',
      'Acknowledge: I understand. Time is money.',
      `Reframe: The extra time is what can create roughly ${money(rbpGain, '[RBP_GAIN]')} more in your pocket.`,
      'Authority close: If I can tighten the timeline closer to 30 days, would the higher net be worth considering?',
    ],
    [
      'What if the appraisal comes in low?',
      'Acknowledge: That is a real concern. Appraisals can kill deals.',
      'Reframe: Your offer is locked in. The appraisal affects the buyer loan, not the number we are trying to protect for you.',
      'Authority close: Would a written net-proceeds guarantee make the process feel safer?',
    ],
  ].map((parts) => parts.join('\n')).join('\n\n');
}

function cfObjections(deal: DealData) {
  const cash = money(deal.mao60, '[MAO_CASH]');
  const agreed = money(deal.agreedPrice || deal.price, '[AGREED_PRICE]');
  return [
    [
      'My seller will not do seller financing.',
      'Acknowledge: That is a fair reaction, and I respect it. Most sellers hear seller financing and picture uncertainty.',
      'Reframe: What specifically concerns them: default risk, tax treatment, or the loan staying in their name?',
      'Authority close: Title transfers on day one. The note is secured by the property, and deed-in-lieu protection gives the seller a clean remedy if I default.',
    ],
    [
      'My seller needs all cash at close.',
      'Acknowledge: Understood. What is the cash being used for: another purchase, paying off debt, or liquidity?',
      'Reframe: I can sometimes increase the down payment to solve an immediate cash need while the note carries the rest.',
      'Authority close: What is the minimum amount at close that would make this work for your seller?',
    ],
    [
      'What if you stop making payments?',
      'Acknowledge: That is exactly the right question, and I take it seriously.',
      'Reframe: We use a licensed third-party loan servicer to track payments and report to both parties.',
      'Authority close: Would it help if I sent the exact deed-in-lieu language for attorney review?',
    ],
    [
      'We already have a conventional offer.',
      'Acknowledge: If that offer closes, your seller wins.',
      'Reframe: Has the buyer lender issued property-specific conditional approval on this address at this price?',
      'Authority close: Would your seller keep a backup offer so they are not starting over if financing dies?',
    ],
    [
      'This sounds complicated. The seller wants simple.',
      'Acknowledge: I hear that. Simple is better.',
      `Reframe: The seller gets near ${agreed}, I bring cash to closing, title transfers, and the rest is documented monthly income instead of a lower ${cash} cash number.`,
      'Authority close: Is beating the cash number worth a 10-minute conversation with the seller?',
    ],
  ].map((parts) => parts.join('\n')).join('\n\n');
}

function mtObjections(deal: DealData) {
  const price = deal.agreedPrice || deal.price || 0;
  const stretch = price > 0 ? Math.round(price * 1.08) : 0;
  const down = price > 0 ? Math.round(price * 0.04) : 0;
  return [
    [
      'The due-on-sale clause means the lender could call the loan.',
      'Acknowledge: You are right to ask. That clause exists in every conventional mortgage.',
      'Reframe: In practice, lenders care most about performance. We keep payments current and use a lender-risk plan.',
      'Authority close: Would a written guarantee that I cover lender-related costs satisfy your seller?',
    ],
    [
      'My seller needs all cash at closing.',
      'Acknowledge: Understood. What is the cash needed for: another purchase or paying off debt?',
      `Reframe: I can often increase the upfront to ${money(stretch, '[STRETCH_PRICE]')} and carry the rest as a note.`,
      'Authority close: What is the minimum cash at closing that would make this a yes today?',
    ],
    [
      'What if you stop making payments?',
      'Acknowledge: That is fair. Here is the protection.',
      `Reframe: Deed-in-lieu protection, third-party servicing, and real skin in the game around ${money(down, '[DOWN_PAYMENT]')}.`,
      'Authority close: Can I send the deed-in-lieu and servicing language for attorney review?',
    ],
    [
      'We already have a conventional offer.',
      'Acknowledge: That is great if it closes.',
      'Reframe: Is the approval tied to this exact property, or is it just a buyer pre-qual?',
      'Authority close: Would your seller accept a backup structure with no obligation?',
    ],
    [
      'My seller has to talk to their accountant about taxes.',
      'Acknowledge: Absolutely. They should.',
      'Reframe: Seller financing may qualify for installment sale treatment under IRS Section 453.',
      'Authority close: Should I email a one-page CPA summary today?',
    ],
  ].map((parts) => parts.join('\n')).join('\n\n');
}

function landObjections(deal: DealData) {
  const offer = money(deal.offer || deal.mao60, '[OFFER_TO_SELLER]');
  return [
    [
      'We already have offers or multiple offers.',
      'Acknowledge: Totally fair. Anybody can write a bigger number on paper.',
      'Reframe: The number that matters is the one that actually closes after diligence, utilities, site work, and title.',
      'Authority close: Would you present mine alongside the others so the seller has a real certainty option?',
    ],
    [
      'Your offer is too low.',
      'Acknowledge: I understand. I am not trying to steal it.',
      'Reframe: My number is based on actual build math: site work, utilities, approvals, and builder margin.',
      'Authority close: What number would the seller realistically consider?',
    ],
    [
      'Seller wants full asking price.',
      'Acknowledge: Understood. If they can get it, they absolutely should.',
      'Reframe: My offer is based on executable cash, not the prettiest paper number.',
      'Authority close: Would it be okay if I checked back in a couple weeks if the situation changes?',
    ],
    [
      'Are you a wholesaler or is this an assignment?',
      'Acknowledge: I source lots for myself and for builder partners depending on the deal.',
      'Reframe: What matters is certainty. If the lot fits, we move quickly with cash, title, and clear diligence.',
      'Authority close: What matters most to your seller: number, timeline, or certainty of close?',
    ],
    [
      'The county has it assessed higher.',
      'Acknowledge: County value and market value are rarely the same on land.',
      'Reframe: County value does not underwrite buildability, utilities, wetlands, zoning, or builder margin.',
      `Authority close: If I walk you through the build math behind ${offer}, would that help?`,
    ],
  ].map((parts) => parts.join('\n')).join('\n\n');
}

export function buildPbkPathScripts(deal: DealData): Record<PbkLegacyScriptPath, PbkPathScriptGroup> {
  const seller = clean(deal.sellerName, '[SELLER_NAME]');
  const agent = clean(deal.sellerName, '[AGENT_NAME]');
  const address = clean(deal.address, '[PROPERTY_ADDRESS]');
  const phone = clean(deal.sellerPhone, '[PHONE_NUMBER]');
  const email = clean(deal.sellerEmail, '[EMAIL]');
  const arv = money(deal.arv, '[ARV]');
  const maoCash = money(deal.mao60, '[MAO_CASH]');
  const maoRbp = money(deal.maoRBP, '[MAO_RBP]');
  const repairs = money(deal.repairs?.mid, '[REPAIRS]');
  const agreed = money(deal.agreedPrice || deal.price, '[AGREED_PRICE]');
  const timeline = clean(deal.timeline, '[TIMELINE]');
  const earnest = clean(deal.earnestDeposit, '[EARNEST_DAYS]');
  const rent = money(deal.rent, '[RENT]');
  const marketPayment = money(deal.price ? Math.round((deal.price * 0.8) * (0.075 / 12) / (1 - Math.pow(1 + 0.075 / 12, -360))) : 0, '[MARKET_PAYMENT]');
  const loanBalance = money(deal.mtBalanceConfirm || deal.balance, '[LOAN_BALANCE]');
  const existingRate = clean(deal.mtRateConfirm || deal.rate, '[EXISTING_RATE]');
  const existingPaymentValue = payment(deal.mtBalanceConfirm || deal.balance || 0, deal.mtRateConfirm || deal.rate || 0);
  const existingPayment = money(existingPaymentValue, '[EXISTING_PAYMENT]');
  const savings = money(existingPaymentValue && deal.price ? Math.max(0, Math.round((deal.price * 0.8) * (0.075 / 12) / (1 - Math.pow(1 + 0.075 / 12, -360))) - existingPaymentValue) : 0, '[SAVINGS]');
  const downPayment = money(deal.cfDownPayment || deal.mtUpfront || (deal.price ? Math.round(deal.price * 0.04) : 0), '[DOWN_PAYMENT]');
  const interestRate = clean(deal.cfRate || deal.mtRateConfirm || deal.rate, '[INTEREST_RATE]');
  const monthlyInterest = money(deal.cfMonthlyPayment || 0, '[MONTHLY_INTEREST]');
  const lotSize = clean(deal.landLotSizeConfirm || deal.lotSize, '[LOT_SIZE]');
  const zip = clean(deal.zipCode, '[ZIP]');
  const builderPays = money(deal.builderTotal || deal.maoRBP, '[BUILDER_PAYS]');
  const offerToSeller = money(deal.offer || deal.mao60, '[OFFER_TO_SELLER]');
  const rbpGain = money(Math.max(0, (deal.maoRBP || 0) - (deal.mao60 || 0)), '[RBP_GAIN]');
  const stretch = money((deal.agreedPrice || deal.price) ? Math.round((deal.agreedPrice || deal.price) * 1.08) : 0, '[STRETCH_PRICE]');

  const cashOwner: PbkScriptBundle = {
    opening: `[STEP 1 - OPENING]\n"Hey ${seller}, this is [YOUR_NAME] with Probono Key Realty. I know this is a little random. Did I catch you at a horrible time?"\n\n[STEP 2 - FRAME THE CALL]\n"I am looking at the property on ${address}. I do not want to assume anything, but I work with a small group of local buyers. We are looking for a few more houses in the area, and I wanted to see if you have ever thought about a simple, as-is cash sale: no repairs, no agent fees, no waiting."\n\n[STEP 3 - DISCOVERY]\n"Before I go any further, can you tell me a little about the property? Is it sitting empty, rented, or are you living there? What is the overall condition like?"\n\n[STEP 4 - PASS-OFF]\n"Got it. Here is how we work. I am not the final decision-maker on pricing. I am the scout. I find opportunities and pass them to our acquisitions team. They run the final numbers, build the offer package, and make the call."\n\n[STEP 5 - CLOSE]\n"Is ${phone} the best number for them to reach you? And ${email} for the documents?"`,
    acquisition: `[STEP 1 - RAPPORT]\n"Hey ${seller}, appreciate you taking the time. How has your day been?"\n\n[STEP 2 - UPFRONT AGREEMENT]\n"Before we get into anything, if we are able to agree on a price that works for both of us today, is there anything that would stop you from moving forward?"\n\n[STEP 3 - DISCOVERY]\n"What is making you consider selling ${address} right now?"\n"What kind of shape is the property in: any repairs or updates needed?"\n"Is it occupied right now or vacant?"\n"How soon are you looking to move on this?"\n\n[STEP 4 - PRICE ANCHOR]\n"Help me understand: what do you need to get out of this property?"\n\n[STEP 5 - DEAL ANALYSIS]\nARV: ${arv} | MAO Cash: ${maoCash} | Repairs: ${repairs}\n\n[STEP 6 - CASH OFFER DELIVERY]\n"Based on everything, the condition, the work it needs, and what similar properties are going for, we would need to be around ${agreed} to make it work on our end. Close: ${timeline}. Earnest: ${earnest}."\n\n[STEP 7 - PUSH/PULL CLOSE]\n"If it works for you, great. We move forward. If not, no problem at all."\n\n[STEP 8 - RBP PIVOT]\n"If the cash number is not quite there and you have a few extra weeks, I have a program that could get you to ${maoRbp}. That is ${rbpGain} more. Want me to walk you through it?"`,
    closing: `"If I can get this approved right now, are you ready to move forward?"\n\nNext steps:\n1. Confirm ${agreed} and ${timeline}.\n2. Send the PDF offer package and DocuSign.\n3. Verify ${email} and ${phone}.\n4. Log the objection, next step, and follow-up date for Ava.`,
    objections: cashObjections(deal),
  };

  const cashAgent: PbkScriptBundle = {
    opening: `[STEP 1 - DISARMING OPENER]\n"Hey ${agent}, this is [YOUR_NAME] with Probono Key Realty. I know you get a ton of calls from investors, so I will be quick. Did I catch you at a decent time?"\n\n[STEP 2 - FRAME THE PROBLEM]\n"I am looking at your listing at ${address} that has been on the market for ${clean(deal.dom, '[DOM]')} days. I specialize in moving inventory that has stalled out."\n\n[STEP 3 - OFFER FRAME]\n"My buyer can make a clean, all-cash offer as-is and close in ${timeline}. You keep your full commission. No split, no co-brokerage. The seller gets a guaranteed exit, and you get paid on a deal that might be sitting with no end in sight."`,
    acquisition: `[STEP 4 - PASS-OFF TO ACQUISITIONS]\n"I am not the final decision-maker. I am the scout. Let me pass this listing to our acquisitions team. They will call you within a few hours with a cash offer, email the PDF package, and schedule a time to review it with your seller. Does that sound like a good backup plan?"\n\n[DEAL ANALYSIS]\nARV: ${arv} | MAO Cash: ${maoCash} | Repairs: ${repairs} | Close: ${timeline}`,
    closing: `"Perfect. What is the best email and phone for the acquisitions team to reach you? I will make sure they prioritize this."`,
    objections: cashObjections(deal),
  };

  const rbpOwner: PbkScriptBundle = {
    opening: `[STEP 1 - OPENING]\n"Hey ${seller}, this is [YOUR_NAME] with Probono Key Realty. I know this is out of the blue. Did I catch you at a bad time?"\n\n[STEP 2 - FRAME THE RBP]\n"I am looking at your property on ${address}. Most investors will call with a low cash offer because they want to flip it. That is not what we do."\n\n"We have a Retail Buyer Program. We bring in qualified end buyers who can pay much closer to market value. We handle repairs, staging, marketing, and closing costs. You pay nothing out of pocket. The tradeoff is timing: about 30 to 60 days instead of 14."\n\n[STEP 3 - DISCOVERY]\n"If you had to choose, do you care more about the highest possible price or getting it sold as fast as possible?"`,
    acquisition: `[PHASE 1 - TRANSITION]\n"Based on what I am seeing, your property qualifies for our Retail Buyer Program, and it could put significantly more money in your pocket. Can I take 60 seconds to walk you through it?"\n\n[PHASE 2 - EXPLAIN]\n"Rather than a straight cash close, we bring in a qualified retail buyer who wants to live in the home. We cover repairs, inspections, appraisal, Realtor commissions, buyer concessions, and closing costs. You pay nothing extra."\n\n"Because we work with traditional-financing buyers, we can offer you ${maoRbp}. That is ${rbpGain} more than our cash offer of ${maoCash}. The only tradeoff is time: 30 to 60 days. Does that make sense?"\n\n[PHASE 3 - BUYER FINANCING]\n"Our buyers use FHA, VA, USDA, conventional, and similar financing. We pre-screen every buyer with their lender before showing your property."\n\n[PHASE 4 - HOLD AND REVEAL]\n"Let me put you on a brief hold. I want to confirm your property is approved before giving you the full number."\n\n"Great news. Your property is approved for the Retail Buyer Program. Our offer is ${maoRbp}. Closing is 30 to 60 days from signing."\n\n[KEY PHRASE]\n"More money. Zero extra work. Just access and a signature."`,
    closing: `"I am going to pass your info directly to our RBP manager. They handle all the numbers, buyer qualification, and the offer package. They will call you within the next few hours with the RBP estimate, send the full PDF package, and schedule a time to walk you through the process. No pressure. Does that work for you?"`,
    objections: rbpObjections(deal),
  };

  const cfAgent: PbkScriptBundle = {
    opening: `[STEP 1 - AGENT DISARM]\n"Hey ${agent}, this is [YOUR_NAME] with Probono Key Realty. I know you get a ton of calls from investors, so I will be quick. Did I catch you at a decent time?"\n\n[STEP 2 - FRAME THE PROBLEM]\n"I am looking at your listing at ${address}. I ran the numbers, and at today's rates a conventional financed buyer is going to be underwater on cash flow. That means most traditional offers will not actually close. The lender will kill it."\n\n[STEP 3 - STRUCTURE FRAME]\n"I have a different solution. My buyer can pay close to the seller's asking price, but we have to structure it: seller carry, a wrap, or a subject-to arrangement. The seller gets their number, but over time instead of all cash upfront."`,
    acquisition: `[PHASE 1 - LENDER FRAME]\n"So the way I buy is simple. I either close cash or go through my lender. My lender wants the property to at least break even or cash flow a little."\n\n[PHASE 2 - CREATE THE PROBLEM]\n"Let me run this real quick... Yeah, if I am putting 20 percent down at today's rates, my payment is roughly ${marketPayment}/mo. The rental market supports about ${rent}/mo. That means from day one, a financed buyer is underwater. My lender will not approve that. It does not cash flow."\n\n[PHASE 3 - CASH OPTION INTENTIONAL FAILURE]\n"Now I could buy it cash, but the return does not make sense at that price. I would honestly have to be around ${maoCash} to justify it cash. Is your seller open to something like that?"\n\n[PHASE 4 - CHECKMATE QUESTION]\n"Got it. That is what I figured. So we have a problem. It does not work with financing, and it does not work in cash at that price. How are you planning to get this one sold?"\n\n[PHASE 5 - SELLER FINANCE INTRO]\n"The only way I can make this work at your number is if we structure it. Has your seller ever considered seller financing?"\n\n[OFFER 1]\n"Purchase price: ${agreed}. I bring ${downPayment} to your seller at closing. I carry the remaining balance at ${interestRate}% for 7 years, then it balloons. Your seller starts collecting ${monthlyInterest}/mo in interest income immediately."\n\n[OFFER 2]\n"Alternatively, I can do ${agreed} with ${downPayment} down, ${interestRate}% rate, 10-year balloon. Which works better for your seller: seller financing from the start, or me stepping into the existing loan and handling everything from day one?"`,
    closing: `"I am going to pass this listing to our acquisitions team. They specialize in creative structures. They will call you directly, email a clean offer package with terms and proof of funds, and schedule a time to review it with your seller. You keep your full commission. We handle the complexity."`,
    objections: cfObjections(deal),
  };

  const mtAgent: PbkScriptBundle = {
    opening: `[STEP 1 - AGENT DISARM]\n"Hey ${agent}, this is [YOUR_NAME] with Probono Key Realty. I will be fast. I am looking at your listing at ${address} that has been on the market for ${clean(deal.dom, '[DOM]')} days. Did I catch you at an okay time?"\n\n[STEP 2 - RATE ADVANTAGE]\n"I noticed the existing loan has a rate of ${existingRate}%. In today's market, that rate is essentially irreplaceable. A conventional buyer would be paying ${marketPayment}/mo. My buyer can step into the existing loan. Seller stops paying immediately, gets cash at closing, and the loan stays in place."\n\n[STEP 3 - PROGRAM FRAME]\n"We have a mortgage takeover program: subject-to or formal assumption. I am not the underwriter. I am the scout. Our acquisitions team handles loan verification, title, and offer structure."`,
    acquisition: `[RATE VALUE FRAME]\n"Before I make an offer, I want to flag something that helps your seller. The existing mortgage is at ${existingRate}%. A conventional buyer at 7.5% would be paying ${marketPayment}/mo. The buyer who steps into the existing loan pays only ${existingPayment}/mo. That monthly savings of ${savings}/mo means I can pay your seller's price where a conventional offer cannot."\n\n[VERIFIABLE DATA]\n"County records show an existing loan balance around ${loanBalance}. The comps average ${arv}. You can verify the comps on Zillow or Redfin."\n\n[OPTION A - SUBJECT-TO]\n"Purchase price: ${agreed}. I bring ${downPayment} to your seller at closing. I step into the existing loan payments immediately. Third-party servicing, deed-in-lieu language, and a recorded note protect the seller."\n\n[OPTION B - FORMAL ASSUMPTION]\n"If the loan is FHA or VA and assumable, the seller can be completely removed from the loan. Buyer must qualify, and I can provide pre-approval within 24 hours."\n\n[OPTION C - SELLER CARRY NOTE]\n"Same price ${agreed}, same down payment ${downPayment}. Title transfers completely. The note is secured by the property. Your seller starts earning interest income immediately."\n\n[CLOSE]\n"Which option makes your seller most comfortable?"`,
    closing: `"I will put these options in writing via DocuSign tonight. You present them to your seller. If they say yes, we close in ${timeline}. If not, no hard feelings. I will follow up in 30 days. Fair enough?"`,
    objections: mtObjections(deal),
  };

  const landOwner: PbkScriptBundle = {
    opening: `[PERMISSION OPEN]\n"Hey, is this the owner of the land at ${address}? My name is [YOUR_NAME] with Probono Key Realty. Did I catch you at a bad time?"\n\n[POSITIONING]\n"I buy land in this area and came across your lot. I wanted to reach out directly because I may be able to make you a quick cash offer: no agent, no commission, no headaches."`,
    acquisition: `[QUALIFICATION]\n"Is the lot actively listed anywhere, or more off-market right now?"\n"Have you had any offers on it, or has it just been sitting?"\n"How long have you owned it?"\n"Do you know if it is fully buildable, or are approvals still needed?"\n\n[OFFER FRAME]\n"I have to work backwards from what a builder will pay me once I have it under contract. I may not be the number you hoped for, but I can be the number that actually moves."\n\n[VERBAL OFFER]\n"I would be at ${offerToSeller} cash. I can close in ${timeline}. I use a title company that handles everything. You just show up to sign. Zero fees or commissions out of your pocket."\n\n[RBP PIVOT]\n"If the cash number is not quite right and you can wait a few extra weeks, I have a Retail Buyer Program that could get you closer to ${builderPays}. Want me to walk you through it?"`,
    closing: `"I completely understand if that is not where you need to be. Even if it does not work today, would it be okay if I checked back in a few weeks in case anything changes?"`,
    objections: landObjections(deal),
  };

  const landAgent: PbkScriptBundle = {
    opening: `[PERMISSION OPEN]\n"Hey ${agent}, this is [YOUR_NAME] with Probono Key Realty calling about your land listing at ${address}. Did I catch you at an okay time for a quick question?"\n\n[POSITIONING]\n"I work with cash buyers focused on buildable and near-buildable ${lotSize} lots. I reviewed this one and wanted to ask a couple quick questions before putting together an offer."`,
    acquisition: `[QUALIFICATION]\n"Is it buildable as-is, or are approvals still needed?"\n"Has soil or perc work been done, or is septic still preliminary?"\n"Is electric at the street? Well and septic, or public utilities?"\n"Any wetlands, flood zone, deed restrictions, or HOA I should know about?"\n"How much activity have you had? Any serious offers in hand?"\n\n[OFFER FRAME]\n"I may not be the highest number on paper, but I try to be the cleanest number that actually closes. I have to account for site work, approvals, utilities, and build margin."\n\n[VERBAL OFFER]\n"If the seller is open to it, I would be at ${offerToSeller} cash, close in about ${timeline}, subject to clear title. I can put up earnest money of ${earnest}."\n\n[CLOSE FOR FEEDBACK]\n"Would you be willing to present that and let me know if they are completely out, somewhat interested, or if there is a number they would actually work with?"`,
    closing: `"Even if this one does not work, we are always looking for ${lotSize} lots under ${builderPays} in zip ${zip}. Anything you can bring our way, you keep the full commission. No buyer agent on our side."`,
    objections: landObjections(deal),
  };

  const rbpAgentFallback: PbkScriptBundle = {
    opening: `[RBP AGENT GUARDRAIL]\nRBP is an owner/direct-seller path. If this is an agent-listed lead, Ava should not force RBP. She should ask for seller priority, then pivot to Creative Finance or Mortgage Takeover when structure is the cleaner agent conversation.`,
    acquisition: `Ask: "Is your seller's priority speed, highest net, or certainty?"\n\nIf highest net and the agent can involve the seller, explain the RBP concept briefly. If not, move to CF or MT.`,
    closing: `"Would you prefer I connect directly with the homeowner, or should I send you the creative structure summary first?"`,
    objections: rbpObjections(deal),
  };

  return {
    cash: { name: 'Cash Offer', color: 'green', owner: cashOwner, agent: cashAgent },
    rbp: { name: 'Retail Buyer Program', color: 'amber', owner: rbpOwner, agent: rbpAgentFallback },
    creative: { name: 'Creative Finance', color: 'blue', owner: cfAgent, agent: cfAgent },
    subto: { name: 'Mortgage Takeover', color: 'purple', owner: mtAgent, agent: mtAgent },
    land: { name: 'Land', color: 'gray', owner: landOwner, agent: landAgent },
  };
}
