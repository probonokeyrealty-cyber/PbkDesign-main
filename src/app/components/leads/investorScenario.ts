import { calculateInvestorMetrics } from '../../utils/dealCalculations';
import type { InvestorStrategy } from './investorStrategies';

const fields = {
  purchase: 'Purchase price',
  exit: 'Expected resale price',
  rehab: 'Rehab and contingency',
  project: 'Site work and due diligence',
  closing: 'Acquisition closing costs',
  carry: 'Monthly carry and financing cost',
  months: 'Months held',
  selling: 'Selling costs (%)',
  rent: 'Monthly gross rent',
  shortTermRevenue: 'Monthly gross booking revenue',
  vacancy: 'Vacancy or revenue loss (%)',
  expenses: 'Monthly operating expenses',
  reserves: 'Monthly capital reserves',
  payment: 'Monthly debt service',
  cashAtClosing: 'Total cash invested at closing',
  cashInvested: 'Cash invested before refinance',
  appraisal: 'Expected refinance appraisal',
  leverage: 'Refinance loan-to-value (%)',
  payoff: 'Existing loan payoff at refinance',
  refiCosts: 'Refinance costs',
  fee: 'Expected assignment fee',
  assignmentCost: 'Total assignment expenses',
  optionFee: 'Upfront option fee',
  optionCredit: 'Option fee applied to purchase',
  rentCredit: 'Monthly rent applied to purchase',
  optionMonths: 'Months to exercise',
  housingCost: 'Full monthly housing cost',
  sellerDownPayment: 'Down payment to seller',
  sellerRate: 'Seller note interest rate (%)',
  amortizationMonths: 'Seller note amortization (months)',
  balloonMonths: 'Months until balloon (0 for none)',
  callReserve: 'Cash set aside for a possible payoff',
} as const;

type Field = keyof typeof fields;
export type ScenarioInputs = Partial<Record<Field, string>>;
type Result = { label: string; value: number | null; kind?: 'percent' | 'ratio' };

const rentalFields = ['rent', 'vacancy', 'expenses', 'reserves', 'payment'] as const;
const modelFields = {
  resale: ['purchase', 'exit', 'rehab', 'closing', 'carry', 'months', 'selling'],
  refinance: ['cashInvested', 'appraisal', 'leverage', 'payoff', 'refiCosts', ...rentalFields],
  assignment: ['purchase', 'fee', 'assignmentCost'],
  rental: ['purchase', ...rentalFields],
  option: ['purchase', 'rent', 'optionFee', 'optionCredit', 'rentCredit', 'optionMonths'],
  occupancy: ['housingCost', 'rent', 'vacancy', 'expenses'],
} as const;

const percentages = new Set<Field>(['selling', 'vacancy', 'leverage', 'sellerRate']);
const wholeMonths = new Set<Field>(['amortizationMonths', 'balloonMonths']);

export function scenarioFields(strategy: InvestorStrategy) {
  let keys: readonly Field[] = modelFields[strategy.model];
  if (strategy.id === 'owner-financing') {
    keys = [
      ...keys.filter((key) => key !== 'payment'),
      'sellerDownPayment',
      'sellerRate',
      'amortizationMonths',
      'balloonMonths',
    ];
  } else if (strategy.id === 'subject-to') {
    keys = [...keys, 'cashAtClosing', 'payoff', 'callReserve'];
  } else if (strategy.model === 'rental') {
    keys = [...keys, 'cashAtClosing'];
  }
  return keys.map((original): { key: Field; label: string; max: number; step: number | 'any' } => {
    const key =
      original === 'rehab' && strategy.id === 'land'
        ? 'project'
        : original === 'rent' && strategy.id === 'short-term-rental'
          ? 'shortTermRevenue'
          : original;
    const max =
      key === 'selling' ? 99.99 : percentages.has(key) ? 100 : wholeMonths.has(key) ? 600 : 1e9;
    const label =
      key === 'payoff' && strategy.id === 'subject-to'
        ? 'Verified current loan payoff'
        : fields[key];
    return { key, label, max, step: wholeMonths.has(key) ? 1 : 'any' };
  });
}

export function calculateScenario(strategy: InvestorStrategy, input: ScenarioInputs) {
  const required = scenarioFields(strategy);
  const missing = required
    .filter(({ key, max, step }) => {
      const raw = input[key]?.trim();
      const value = Number(raw);
      return (
        !raw ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > max ||
        (step === 1 && !Number.isInteger(value)) ||
        ([
          'purchase',
          'exit',
          'appraisal',
          'cashInvested',
          'optionMonths',
          'amortizationMonths',
        ].includes(key) &&
          value === 0)
      );
    })
    .map(({ label }) => label);
  if (missing.length)
    return { missing, error: '', results: [] as Result[], sensitivity: [] as Result[] };

  const n = (key: Field) => Number(input[key]);
  const purchase = n('purchase');
  const rent = n(strategy.id === 'short-term-rental' ? 'shortTermRevenue' : 'rent');
  let payment = n('payment');
  let balloon = 0;
  if (strategy.id === 'owner-financing') {
    const principal = purchase - n('sellerDownPayment');
    const rate = n('sellerRate') / 1200;
    const term = n('amortizationMonths');
    const maturity = n('balloonMonths');
    if (principal <= 0 || maturity >= term) {
      return {
        missing,
        error:
          'Enter a down payment below the purchase price and a balloon date before the last payment, or 0 for no balloon.',
        results: [],
        sensitivity: [],
      };
    }
    const installmentFactor = (months: number) => -Math.expm1(-months * Math.log1p(rate)) / rate;
    payment = rate === 0 ? principal / term : principal / installmentFactor(term);
    if (maturity > 0) {
      balloon =
        rate === 0 ? payment * (term - maturity) : payment * installmentFactor(term - maturity);
    }
  }
  const effectiveRent = (gross: number) => gross * (1 - n('vacancy') / 100);
  const noi = (gross: number) => (effectiveRent(gross) - n('expenses')) * 12;
  const cashFlow = (gross: number) => noi(gross) / 12 - payment - n('reserves');
  const dscr = payment > 0 ? noi(rent) / (payment * 12) : null;
  const rentSensitivity = ['Rent 10% lower', 'Base rent', 'Rent 10% higher'].map(
    (label, index) => ({
      label,
      value: cashFlow(rent * [0.9, 1, 1.1][index]),
    })
  );
  let results: Result[];
  let sensitivity: Result[] = [];
  let error = '';

  switch (strategy.model) {
    case 'resale': {
      const selling = n('selling') / 100;
      const calculation = (price: number) =>
        calculateInvestorMetrics.fixFlip(
          purchase,
          n(strategy.id === 'land' ? 'project' : 'rehab'),
          price,
          n('months'),
          n('closing'),
          n('carry'),
          selling
        );
      const result = calculation(n('exit'));
      results = [
        { label: 'Before-tax resale profit', value: result.profit },
        { label: 'Break-even resale price', value: result.totalInvestment / (1 - selling) },
        { label: 'Return on project cost', value: result.roi, kind: 'percent' },
        { label: 'Total cost before sale', value: result.totalInvestment },
      ];
      sensitivity = ['Resale 10% lower', 'Base resale', 'Resale 10% higher'].map((label, i) => ({
        label,
        value: calculation(n('exit') * [0.9, 1, 1.1][i]).profit,
      }));
      break;
    }
    case 'rental':
    case 'refinance': {
      results = [
        { label: 'Monthly cash flow after reserves', value: cashFlow(rent) },
        { label: 'Annual net operating income', value: noi(rent) },
        { label: 'Debt service coverage', value: dscr, kind: 'ratio' },
      ];
      if (strategy.model === 'refinance') {
        const loan = (n('appraisal') * n('leverage')) / 100;
        const net = loan - n('payoff') - n('refiCosts');
        results.push(
          { label: 'Gross refinance loan', value: loan },
          { label: 'Net cash from refinance', value: net },
          {
            label:
              net > n('cashInvested') ? 'Cash returned above cash invested' : 'Cash left invested',
            value: Math.abs(n('cashInvested') - net),
          }
        );
      } else {
        results.push({
          label: 'Cap rate at purchase price',
          value: (noi(rent) / purchase) * 100,
          kind: 'percent',
        });
        const cash = n('cashAtClosing');
        if (strategy.id === 'owner-financing') {
          results.push(
            { label: 'Monthly seller note payment', value: payment },
            { label: 'Scheduled balloon balance', value: balloon }
          );
        } else {
          results.push({
            label: 'Cash-on-cash return',
            value: cash > 0 ? ((cashFlow(rent) * 12) / cash) * 100 : null,
            kind: 'percent',
          });
          if (strategy.id === 'subject-to') {
            results.push({
              label: 'Payoff funding gap today',
              value: Math.max(0, n('payoff') - n('callReserve')),
            });
          }
        }
      }
      sensitivity =
        strategy.id === 'short-term-rental'
          ? rentSensitivity.map((row) => ({ ...row, label: row.label.replace(/rent/i, 'Revenue') }))
          : rentSensitivity;
      break;
    }
    case 'assignment':
      results = [
        { label: 'Net assignment proceeds', value: n('fee') - n('assignmentCost') },
        { label: 'Buyer price including fee', value: purchase + n('fee') },
      ];
      break;
    case 'option': {
      const credits = n('optionCredit') + n('rentCredit') * n('optionMonths');
      const leasePayments = rent * n('optionMonths') + n('optionFee');
      if (n('optionCredit') > n('optionFee') || n('rentCredit') > rent || credits > purchase) {
        error = 'Credits must fit the signed fee, monthly rent, and purchase price.';
      }
      results = [
        { label: 'Remaining purchase price', value: purchase - credits },
        { label: 'Rent and option fee paid', value: leasePayments },
        {
          label: 'Total paid if exercised, before other costs',
          value: leasePayments + purchase - credits,
        },
      ];
      break;
    }
    case 'occupancy': {
      const netHousing = (gross: number) => n('housingCost') + n('expenses') - effectiveRent(gross);
      results = [
        { label: 'Net monthly housing cost', value: netHousing(rent) },
        {
          label: 'Gross rent to break even',
          value:
            n('vacancy') < 100
              ? (n('housingCost') + n('expenses')) / (1 - n('vacancy') / 100)
              : null,
        },
      ];
      sensitivity = ['Rent 10% lower', 'Base rent', 'Rent 10% higher'].map((label, i) => ({
        label,
        value: netHousing(rent * [0.9, 1, 1.1][i]),
      }));
      break;
    }
  }
  return { missing, error, results, sensitivity };
}
