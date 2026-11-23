export const strategyGuides = [
  {
    id: 'fix-flip',
    name: 'Fix and Flip',
    model: 'resale',
    summary:
      'Buy, renovate, and resell. The spread has to cover every cost between the two closings.',
    evidence:
      'Compare renovated sales with similar size, condition, and location. Walk the property and price the scope by trade.',
    work: 'Price acquisition, closing, rehab, contingency, financing, monthly carry, and sale costs. Model a lower resale price and a longer hold before setting an offer.',
    risk: 'Renovation overruns, inspection surprises, and a slow exit can erase a thin margin.',
    measure: 'Before-tax profit, break-even resale price, and return on total project cost.',
  },
  {
    id: 'brrrr',
    name: 'BRRRR',
    model: 'refinance',
    summary:
      'Buy, rehab, rent, refinance, and repeat. The stabilized rent and refinance have to work together.',
    evidence:
      'Verify rent with signed leases or comparable rentals. Get a lender quote for appraisal, seasoning, leverage, costs, and debt coverage.',
    work: 'Build the stabilized operating budget before projecting a refinance. Subtract the current payoff and fees from gross loan proceeds, then compare the cash returned with cash invested.',
    risk: 'A low appraisal, limited loan proceeds, or weak debt coverage can leave more capital in the deal than planned.',
    measure: 'Net refinance proceeds, capital left in, and post-refinance debt coverage.',
  },
  {
    id: 'wholesale',
    name: 'Wholesale',
    model: 'assignment',
    summary:
      'Find a property and assign the purchase contract where the contract and local rules allow it.',
    evidence:
      'Review recent sold comps, a credible repair estimate, buyer criteria, contract terms, and a realistic closing window.',
    work: 'Underwrite the end buyer’s cost and required margin before relying on an assignment fee. Track earnest money exposure, due diligence costs, and marketing costs.',
    risk: 'Verify assignment rights, licensing, and disclosures with local counsel. A proposed fee needs a buyer and a closing before it becomes earned income.',
    measure: 'Net assignment proceeds and the buyer’s total price including the fee.',
  },
  {
    id: 'hold',
    name: 'Buy and Hold',
    model: 'rental',
    summary: 'Operate a long-term rental for cash flow with a longer holding period.',
    evidence:
      'Check the rent roll, signed leases, actual expenses, insurance quote, tax history, and expected tax changes after sale.',
    work: 'Subtract vacancy and operating expenses from rent to estimate NOI. Then subtract debt service and reserves to see what the property may pay out.',
    risk: 'Check maintenance, tenant turnover, taxes, insurance, and capital reserves against a lower-rent scenario.',
    measure: 'Net operating income, cap rate at purchase price, debt coverage, and cash flow.',
  },
  {
    id: 'subject-to',
    name: 'Subject-To',
    model: 'rental',
    summary:
      'Acquire a property with the seller’s existing mortgage still in place. Underwrite the actual loan and transfer risks.',
    evidence:
      'Obtain current loan statements, a payoff or reinstatement quote, the note, escrow details, insurance quotes, and a title report.',
    work: 'Model payments, any arrears, buyer cash at closing, reserves, and a funded exit if the loan must be paid off. Verify servicing and insurance with qualified professionals.',
    risk: 'Have counsel review the transfer, due-on-sale language, seller disclosures, and the seller’s continued loan exposure. Use a current payoff quote for planning.',
    measure:
      'Cash flow after verified debt payments and reserves, and cash required if the loan is called.',
    source: {
      url: 'https://www.govinfo.gov/link/uscode/12/1701j-3',
      label: 'Federal due-on-sale statute',
    },
  },
  {
    id: 'owner-financing',
    name: 'Owner Financing',
    model: 'rental',
    summary: 'The seller finances part of the purchase under a negotiated payment schedule.',
    evidence:
      'Confirm the note, lien position, down payment, amortization, insurance, maturity, balloon amount, and any existing debt.',
    work: 'Model payment and reserves using the written terms. Build a payoff plan for the balloon under a lower value or higher refinance rate.',
    risk: 'Ask qualified local counsel to review loan origination, applicable disclosures, servicing, late fees, and default terms.',
    measure: 'Cash flow at the negotiated payment plus a separate balloon funding plan.',
    source: {
      url: 'https://www.consumerfinance.gov/rules-policy/regulations/1026/36/',
      label: 'CFPB loan originator regulation',
    },
  },
  {
    id: 'lease-option',
    name: 'Lease Option',
    model: 'option',
    summary: 'Lease the property and negotiate a right to buy by a specified date.',
    evidence:
      'Get the lease and option in writing. Confirm purchase price, option fee, rent credits, exercise dates, repair duties, and title.',
    work: 'Calculate the remaining purchase price after credits that actually apply. Estimate total rent and cash paid if you exercise, then review what is forfeited if you walk away.',
    risk: 'Verify local rules and the effect of missed payments, missed deadlines, title problems, or inability to qualify for financing.',
    measure: 'Cash paid through exercise and remaining purchase price after credits.',
  },
  {
    id: 'house-hack',
    name: 'House Hacking',
    model: 'occupancy',
    summary:
      'Live in one part of the property and use eligible rental space to offset your housing cost.',
    evidence:
      'Verify legal unit count, owner-occupancy rules, permits, market rent, utilities, and insurance.',
    work: 'Budget the full monthly housing cost. Offset it with realistic rent after vacancy and incremental rental expenses.',
    risk: 'Make sure you can carry the home during vacancies, repairs, or a change in household plans.',
    measure: 'Net monthly housing cost and required offsetting rent.',
  },
  {
    id: 'short-term-rental',
    name: 'Short-Term Rental',
    model: 'rental',
    summary: 'Operate a furnished rental with nightly revenue and hospitality costs.',
    evidence:
      'Confirm local permission, HOA restrictions, insurance, furnished costs, and actual booking and payout records.',
    work: 'Build monthly revenue from realistic occupied nights and realized nightly rates. Include platform fees, cleaning, utilities, furnishing replacement, and seasonality.',
    risk: 'Test a slow season and a long-term rental fallback. Use STR-specific revenue evidence in the calculator.',
    measure: 'Cash flow after operating expenses, debt service, and replacement reserves.',
  },
  {
    id: 'live-in-flip',
    name: 'Live-In Flip',
    model: 'resale',
    summary: 'Occupy a property while renovating it and plan a later resale.',
    evidence:
      'Check condition, permitted scope, livability, comparable renovated sales, and proof of residence for any tax review.',
    work: 'Separate household spending from project costs. Include the cost of living through construction and model the exit as a before-tax resale.',
    risk: 'Tax treatment depends on eligibility and facts. Review the principal-residence rules and business-use implications with a tax professional.',
    measure: 'Before-tax resale profit and break-even after a realistic renovation schedule.',
    source: { url: 'https://www.irs.gov/publications/p523', label: 'IRS Publication 523' },
  },
  {
    id: 'multifamily',
    name: 'Multifamily',
    model: 'rental',
    summary: 'Underwrite multiple units as an operating property.',
    evidence:
      'Reconcile the rent roll, trailing 12 months of expenses, leases, utility allocations, legal units, and deferred maintenance.',
    work: 'Calculate actual and stabilized NOI. Test renewal pricing, turnover, reserves, and debt coverage at an achievable loan payment.',
    risk: 'One-time income and seller expense exclusions can overstate returns. Verify unit legality and inspection findings.',
    measure: 'NOI, cap rate at purchase price, and debt coverage after stabilization.',
  },
  {
    id: 'land',
    name: 'Land Flipping',
    model: 'resale',
    summary:
      'Acquire a parcel and resell it for a margin after acquisition, due diligence, carry, and exit costs.',
    evidence:
      'Confirm parcel boundaries, legal access, zoning, utility availability, flood constraints, and true comparable land sales.',
    work: 'Price surveys, title, clearing or entitlement work if applicable, carrying taxes, and selling costs. Check days on market and the likely buyer pool.',
    risk: 'Verify buildability with local officials and qualified consultants. Include the cost and timing of conditions the buyer must satisfy.',
    measure: 'Before-tax net resale profit and break-even sale price.',
  },
] as const;

export type InvestorStrategy = (typeof strategyGuides)[number];

export const investorGlossary = [
  [
    'ARV',
    'Estimated sale value after the specified repairs. Validate it with adjusted, comparable sold properties.',
  ],
  [
    'NOI',
    'Net operating income. Annual income after vacancy and operating expenses, before debt service and capital reserves.',
  ],
  ['Cap rate', 'Annual NOI divided by the purchase price in this calculator.'],
  ['DSCR', 'Debt service coverage ratio. Annual NOI divided by annual debt service.'],
  ['LTV', 'Loan-to-value ratio. Divide the proposed loan by the lender-supported property value.'],
  ['Cash on cash', 'Annual cash flow after debt service and reserves divided by cash invested.'],
  [
    'Break-even resale',
    'Sale price required to recover project costs after percentage selling costs.',
  ],
  [
    'Current payoff',
    'The amount needed to satisfy a loan as of a specified date. Request it from the servicer.',
  ],
] as const;
