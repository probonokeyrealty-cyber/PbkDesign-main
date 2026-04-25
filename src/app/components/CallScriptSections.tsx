import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Copy, Download } from 'lucide-react';
import { DealData, PBKPath } from '../types';
import {
  calculateMarketPiti,
  calculateMonthlyInterestOnly,
  calculateSubjectToPiti,
} from '../utils/dealCalculations';
import { downloadTextFile } from '../utils/fileExport';
import { formatCurrency, sanitizeLegacyCopy } from '../utils/formatting';

export interface CallScriptSection {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  accent?: 'amber' | 'blue' | 'green' | 'purple' | 'slate';
  defaultOpen?: boolean;
  filename?: string;
}

interface CallScriptSectionsProps {
  deal: DealData;
  activePath: PBKPath;
  sections: CallScriptSection[];
  storageScope: string;
}

const ACCENT_CLASSES: Record<NonNullable<CallScriptSection['accent']>, string> = {
  amber:
    'border-amber-200 bg-amber-50/70 text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/10 dark:text-amber-300',
  blue:
    'border-blue-200 bg-blue-50/70 text-blue-800 dark:border-blue-800/60 dark:bg-blue-900/10 dark:text-blue-300',
  green:
    'border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-900/10 dark:text-emerald-300',
  purple:
    'border-purple-200 bg-purple-50/70 text-purple-800 dark:border-purple-800/60 dark:bg-purple-900/10 dark:text-purple-300',
  slate:
    'border-slate-200 bg-slate-50/80 text-slate-800 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200',
};

const PLACEHOLDER_PATTERN = /\[([A-Z0-9_ /-]+)\]/g;

function buildPlaceholderValues(deal: DealData, activePath: PBKPath): Record<string, string> {
  const agreedPrice = deal.agreedPrice || deal.rbpPriceConfirm || deal.offer || deal.price || 0;
  const cfDown = deal.cfDownPayment || (agreedPrice > 0 ? Math.round(agreedPrice * 0.04) : 0);
  const cfRate = deal.cfRate || deal.rate || 5;
  const cfTerm = deal.cfTerm || 7;
  const mtUpfront = deal.mtUpfront || (agreedPrice > 0 ? Math.round(agreedPrice * 0.04) : 0);
  const mtBalance = deal.mtBalanceConfirm || deal.balance || 0;
  const mtRate = deal.mtRateConfirm || deal.rate || 0;
  const activeDown = activePath === 'mt' ? mtUpfront : cfDown;
  const activeRate = activePath === 'mt' ? mtRate : cfRate;
  const activeTerm = activePath === 'cf' ? cfTerm : 30;
  const marketPayment = calculateMarketPiti(agreedPrice || deal.price || 0);
  const existingPayment = calculateSubjectToPiti(mtBalance, mtRate, agreedPrice || deal.price || 0);
  const monthlyInterest = calculateMonthlyInterestOnly(Math.max(0, agreedPrice - activeDown), activeRate);
  const builderPays = activePath === 'rbp-land' ? agreedPrice : deal.builderTotal || deal.maoRBP || 0;
  const offerToSeller = activePath === 'rbp-land' ? agreedPrice : deal.offer || agreedPrice || deal.mao60 || 0;
  const timeline = deal.timeline || '30 days';
  const earnest = deal.earnestDeposit || 'Delivered within 3 business days';

  return {
    SELLER_NAME: deal.sellerName || 'Seller Name pending',
    PROPERTY_ADDRESS: deal.address || 'Property address pending',
    COMPANY_NAME: 'Probono Key Realty',
    AGREED_PRICE: formatCurrency(agreedPrice),
    CLOSE_TIMELINE: timeline,
    TIMELINE: timeline,
    EARNEST_DEPOSIT: earnest,
    EARNEST_DAYS: earnest,
    DOWN_PAYMENT: formatCurrency(activeDown),
    INTEREST_RATE: activeRate > 0 ? `${activeRate}%` : 'Rate pending',
    LOAN_TERM: `${activeTerm} years`,
    TERM_LENGTH: `${activeTerm} years`,
    MONTHLY_INTEREST: formatCurrency(monthlyInterest),
    MARKET_PAYMENT: formatCurrency(marketPayment),
    EXISTING_PAYMENT: formatCurrency(existingPayment),
    MONTHLY_PAYMENT: formatCurrency(activePath === 'mt' ? existingPayment : monthlyInterest),
    LOT_SIZE: deal.landLotSizeConfirm || deal.lotSize || 'Lot size pending',
    ZIP: deal.zipCode || 'ZIP pending',
    BUILDER_PAYS: formatCurrency(builderPays),
    OFFER_TO_SELLER: formatCurrency(offerToSeller),
    ASSIGNMENT_FEE: formatCurrency(Math.max(0, (deal.builderTotal || 0) - (deal.offer || 0))),
    CASH_ALTERNATIVE: formatCurrency(deal.rbpCashAlternative || 0),
    SELLER_COSTS: deal.rbpSellerCosts || deal.landSellerCosts || 'Seller costs pending',
  };
}

function renderHighlightedScript(
  script: string,
  placeholderValues: Record<string, string>,
) {
  const nodes: Array<string | JSX.Element> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIndex = 0;

  while ((match = PLACEHOLDER_PATTERN.exec(script)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(script.slice(lastIndex, match.index));
    }

    const rawToken = match[0];
    const tokenName = match[1].trim();
    const currentValue = placeholderValues[tokenName] || 'Live sync pending';

    nodes.push(
      <span
        key={`${tokenName}-${keyIndex}`}
        title={`Current value: ${currentValue}`}
        className="rounded-md bg-amber-100 px-1.5 py-0.5 font-mono text-[0.95em] text-amber-900 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-100 dark:ring-amber-800/70"
      >
        {rawToken}
      </span>,
    );

    lastIndex = match.index + rawToken.length;
    keyIndex += 1;
  }

  if (lastIndex < script.length) {
    nodes.push(script.slice(lastIndex));
  }

  return nodes;
}

function ScriptCard({
  section,
  isOpen,
  onToggle,
  onCopy,
  copied,
  placeholderValues,
}: {
  section: CallScriptSection;
  isOpen: boolean;
  onToggle: () => void;
  onCopy: () => void;
  copied: boolean;
  placeholderValues: Record<string, string>;
}) {
  const accent = ACCENT_CLASSES[section.accent || 'slate'];
  const safeEyebrow = sanitizeLegacyCopy(section.eyebrow);
  const safeTitle = sanitizeLegacyCopy(section.title);
  const safeBody = sanitizeLegacyCopy(section.body);

  return (
    <div className="rounded-[20px] border border-gray-200 bg-white/95 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/85">
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-start justify-between gap-4 rounded-[20px] border-b px-5 py-4 text-left transition ${
          isOpen ? accent : 'border-transparent bg-transparent text-gray-800 dark:text-gray-100'
        }`}
      >
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
            {safeEyebrow}
          </div>
          <h4 className="mt-2 text-base font-semibold leading-tight text-gray-900 dark:text-gray-100">
            {safeTitle}
          </h4>
        </div>
        <ChevronDown
          size={18}
          className={`mt-1 shrink-0 text-gray-500 transition-transform dark:text-gray-300 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen ? (
        <div className="px-5 py-5">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-gray-200 bg-white px-3.5 py-2 text-[11px] font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-950 dark:text-gray-200 dark:hover:bg-slate-800 sm:w-auto"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy to Clipboard'}
            </button>
            {section.filename ? (
              <button
                type="button"
                onClick={() => downloadTextFile(safeBody, section.filename || 'pbk_script')}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-gray-200 bg-white px-3.5 py-2 text-[11px] font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-950 dark:text-gray-200 dark:hover:bg-slate-800 sm:w-auto"
              >
                <Download size={13} />
                Download
              </button>
            ) : null}
          </div>

          <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-gray-700 dark:text-gray-200">
            {renderHighlightedScript(safeBody, placeholderValues)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CallScriptSections({
  deal,
  activePath,
  sections,
  storageScope,
}: CallScriptSectionsProps) {
  const placeholderValues = useMemo(
    () => buildPlaceholderValues(deal, activePath),
    [deal, activePath],
  );
  const defaultOpenState = useMemo(
    () =>
      sections.reduce<Record<string, boolean>>((acc, section) => {
        acc[section.id] = Boolean(section.defaultOpen);
        return acc;
      }, {}),
    [sections],
  );
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(defaultOpenState);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    setOpenSections(defaultOpenState);
  }, [defaultOpenState, storageScope]);

  useEffect(() => {
    if (!copiedId) return;
    const timeout = window.setTimeout(() => setCopiedId(null), 1600);
    return () => window.clearTimeout(timeout);
  }, [copiedId]);

  const toggleSection = (id: string) => {
    setOpenSections((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const copySection = async (section: CallScriptSection) => {
    const safeBody = sanitizeLegacyCopy(section.body);

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(safeBody);
      }
      setCopiedId(section.id);
    } catch (error) {
      console.error('Copy failed', error);
    }
  };

  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <ScriptCard
          key={`${storageScope}-${section.id}`}
          section={section}
          isOpen={Boolean(openSections[section.id])}
          onToggle={() => toggleSection(section.id)}
          onCopy={() => copySection(section)}
          copied={copiedId === section.id}
          placeholderValues={placeholderValues}
        />
      ))}
    </div>
  );
}
