import { useState } from 'react';
import { DealData, PBKPath } from '../types';
import {
  AlertCircle,
  ArrowUpRight,
  Building2,
  Calendar,
  Check,
  Circle,
  DollarSign,
  FileText,
  Home,
  Mail,
  Phone,
  ShieldCheck,
  TrendingUp,
  User,
} from 'lucide-react';
import { getLiveCallSupport } from '../utils/pbk';

type LiveInputPath = 'cash' | 'creative_finance' | 'subject_to' | 'rbp' | 'land';

interface LiveCallInputsProps {
  deal: DealData;
  onDealChange: (updates: Partial<DealData>) => void;
  selectedPath?: LiveInputPath;
  canonicalPath?: PBKPath;
}

interface ConfirmBadgeProps {
  confirmed: boolean;
  complete: boolean;
  onClick: () => void;
  title: string;
}

const LIVE_PATH_NAMES: Record<LiveInputPath, string> = {
  cash: 'Cash Wholesale',
  creative_finance: 'Creative Finance',
  subject_to: 'Mortgage Takeover (Subject-To)',
  rbp: 'Retail Buyer Program',
  land: 'Land / Builder Assignment',
};

const LIVE_PATH_COLORS: Record<LiveInputPath, string> = {
  cash: 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400 border-green-200 dark:border-green-800',
  creative_finance:
    'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400 border-blue-200 dark:border-blue-800',
  subject_to:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400 border-purple-200 dark:border-purple-800',
  rbp: 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  land: 'bg-slate-100 text-slate-700 dark:bg-slate-900/20 dark:text-slate-300 border-slate-200 dark:border-slate-700',
};

const BANNER_TONE_CLASSES = {
  success:
    'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/15 dark:text-emerald-300',
  warning:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/15 dark:text-amber-300',
  info: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-900/15 dark:text-blue-300',
};

function resolveCanonicalPath(
  selectedPath: LiveInputPath,
  deal: Pick<DealData, 'type' | 'contact'>,
  explicitPath?: PBKPath,
): PBKPath {
  if (explicitPath) return explicitPath;
  if (selectedPath === 'creative_finance') return 'cf';
  if (selectedPath === 'subject_to') return 'mt';
  if (selectedPath === 'rbp') return 'rbp';
  if (selectedPath === 'land') {
    if (deal.type === 'land' && deal.contact === 'realtor') return 'land-agent';
    return 'land-owner';
  }
  return 'cash';
}

function getMotivationLevel(score: number): string {
  if (score <= 2) return 'Exploring';
  if (score === 3) return 'Interested';
  if (score === 4) return 'Motivated';
  return 'Urgent';
}

function getPhoneStatusLabel(status: 'missing' | 'needs-verification' | 'verified'): string {
  if (status === 'verified') return 'Verified';
  if (status === 'needs-verification') return 'Unverified';
  return 'Missing';
}

function ConfirmBadge({ confirmed, complete, onClick, title }: ConfirmBadgeProps) {
  const baseClasses =
    'inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border transition-all';
  const stateClasses = confirmed
    ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm shadow-emerald-500/30'
    : complete
      ? 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
      : 'border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500';

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`${baseClasses} ${stateClasses}`}
    >
      {confirmed ? <Check size={11} /> : <Circle size={10} />}
    </button>
  );
}

export function LiveCallInputs({
  deal,
  onDealChange,
  selectedPath: propSelectedPath,
  canonicalPath,
}: LiveCallInputsProps) {
  const [localSelectedPath, setLocalSelectedPath] = useState<LiveInputPath>('cash');

  const selectedPath = propSelectedPath || localSelectedPath;
  const effectiveCanonicalPath = resolveCanonicalPath(selectedPath, deal, canonicalPath);
  const agreedPrice = deal.agreedPrice || deal.rbpPriceConfirm || deal.price || 0;
  const showLandSellerCosts = effectiveCanonicalPath === 'rbp-land';
  const confirmedTerms = deal.confirmedTerms || {};
  const liveCallSupport = getLiveCallSupport(
    {
      ...deal,
      selectedPath: effectiveCanonicalPath,
    },
    effectiveCanonicalPath,
  );
  const confirmedCount = liveCallSupport.checklist.filter((item) => item.confirmed).length;
  const completedCount = liveCallSupport.checklist.filter((item) => item.complete).length;

  const handleChange = <K extends keyof DealData>(
    field: K,
    value: DealData[K],
    confirmKey?: string,
  ) => {
    const updates: Partial<DealData> = {
      [field]: value,
    } as Pick<DealData, K>;

    if (confirmKey) {
      updates.confirmedTerms = {
        ...confirmedTerms,
        [confirmKey]: false,
      };
    }

    onDealChange(updates);
  };

  const toggleConfirmed = (key: string) => {
    onDealChange({
      confirmedTerms: {
        ...confirmedTerms,
        [key]: !confirmedTerms[key],
      },
    });
  };

  const handlePhoneChange = (value: string) => {
    onDealChange({
      sellerPhone: value,
      sellerPhoneVerified: false,
      confirmedTerms: {
        ...confirmedTerms,
        phoneVerified: false,
      },
    });
  };

  const handleVerifyPhone = () => {
    if (!(deal.sellerPhone || '').trim()) return;

    onDealChange({
      sellerPhoneVerified: true,
      confirmedTerms: {
        ...confirmedTerms,
        phoneVerified: true,
      },
    });
  };

  const handleMotivationChange = (score: number) => {
    onDealChange({
      motivationScore: score,
      motivationLevel: getMotivationLevel(score),
    });
  };

  const phoneStatusTone =
    liveCallSupport.phoneStatus === 'verified'
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
      : liveCallSupport.phoneStatus === 'needs-verification'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
        : 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400';

  return (
    <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-1 h-3 bg-green-500 rounded-sm"></div>
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-green-500">
              Live Call Capture
            </h3>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              Seller details, agreed terms, and path-specific confirmations
            </div>
          </div>
        </div>

        <div
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
            LIVE_PATH_COLORS[selectedPath]
          }`}
        >
          Path: {liveCallSupport.pathLabel}
        </div>
      </div>

      {!propSelectedPath ? (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {(['cash', 'creative_finance', 'subject_to', 'rbp', 'land'] as const).map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => setLocalSelectedPath(path)}
              className={`text-[9px] font-semibold px-2 py-1 rounded border transition-all ${
                selectedPath === path
                  ? LIVE_PATH_COLORS[path]
                  : 'bg-gray-50 text-gray-500 dark:bg-slate-900 dark:text-gray-400 border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-800'
              }`}
            >
              {path === 'cash'
                ? 'CASH'
                : path === 'creative_finance'
                  ? 'CF'
                  : path === 'subject_to'
                    ? 'MT'
                    : path === 'rbp'
                      ? 'RBP'
                      : 'LAND'}
            </button>
          ))}
        </div>
      ) : null}

      <div
        className={`mb-4 rounded-xl border px-3 py-3 ${BANNER_TONE_CLASSES[liveCallSupport.bannerTone]}`}
      >
        <div className="flex items-start gap-2">
          <ShieldCheck size={16} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] mb-1">
              {liveCallSupport.bannerTitle}
            </div>
            <div className="text-[12px] leading-relaxed">{liveCallSupport.bannerMessage}</div>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
              <span className="rounded-full bg-white/70 dark:bg-slate-950/30 px-2 py-1">
                Checklist: {confirmedCount}/{liveCallSupport.checklist.length} confirmed
              </span>
              <span className="rounded-full bg-white/70 dark:bg-slate-950/30 px-2 py-1">
                Complete: {completedCount}/{liveCallSupport.checklist.length}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
            Seller Information
          </div>

          <div>
            <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
              <span className="flex items-center gap-1.5">
                <User size={12} />
                Seller Name <span className="text-red-500">*</span>
              </span>
              <ConfirmBadge
                confirmed={Boolean(confirmedTerms.sellerName)}
                complete={Boolean((deal.sellerName || '').trim())}
                onClick={() => toggleConfirmed('sellerName')}
                title="Confirm seller name"
              />
            </label>
            <input
              type="text"
              value={deal.sellerName || ''}
              onChange={(e) => handleChange('sellerName', e.target.value, 'sellerName')}
              placeholder="John Smith"
              className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
              <Mail size={12} />
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={deal.sellerEmail || ''}
              onChange={(e) => handleChange('sellerEmail', e.target.value)}
              placeholder="john@example.com"
              className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-400">
                <Phone size={12} />
                Phone <span className="text-red-500">*</span>
              </label>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${phoneStatusTone}`}>
                {getPhoneStatusLabel(liveCallSupport.phoneStatus)}
              </span>
            </div>
            <input
              type="tel"
              value={deal.sellerPhone || ''}
              onChange={(e) => handlePhoneChange(e.target.value)}
              placeholder="(555) 123-4567"
              className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleVerifyPhone}
                disabled={!(deal.sellerPhone || '').trim()}
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 transition-all disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-900/15 dark:text-emerald-300"
              >
                <ShieldCheck size={12} />
                Mark Verified
              </button>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">
                Soft check only. Recommended before sending docs.
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
            Timeline & Deal Terms
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
              <TrendingUp size={12} />
              Motivation Score (1-5)
            </label>
            <div className="grid grid-cols-5 gap-1">
              {[1, 2, 3, 4, 5].map((score) => (
                <button
                  key={score}
                  type="button"
                  onClick={() => handleMotivationChange(score)}
                  className={`rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-all ${
                    (deal.motivationScore || 3) === score
                      ? 'border-blue-500 bg-blue-500 text-white shadow-sm'
                      : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {score}
                </button>
              ))}
            </div>
            <div className="mt-1 text-[10px] font-medium text-gray-500 dark:text-gray-400">
              {getMotivationLevel(deal.motivationScore || 3)}
            </div>
          </div>

          <div>
            <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
              <span className="flex items-center gap-1.5">
                <DollarSign size={12} />
                Agreed Price <span className="text-red-500">*</span>
              </span>
              <ConfirmBadge
                confirmed={Boolean(confirmedTerms.agreedPrice)}
                complete={agreedPrice > 0}
                onClick={() => toggleConfirmed('agreedPrice')}
                title="Confirm agreed price"
              />
            </label>
            <div className="relative">
              <span className="absolute left-2.5 top-1.5 text-[12px] text-gray-500">$</span>
              <input
                type="number"
                value={deal.agreedPrice || ''}
                onChange={(e) => handleChange('agreedPrice', parseFloat(e.target.value) || 0, 'agreedPrice')}
                placeholder={deal.price > 0 ? String(deal.price) : '250000'}
                className="w-full pl-6 pr-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          <div>
            <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
              <span className="flex items-center gap-1.5">
                <Calendar size={12} />
                Close Timeline <span className="text-red-500">*</span>
              </span>
              <ConfirmBadge
                confirmed={Boolean(confirmedTerms.timeline)}
                complete={Boolean((deal.timeline || '').trim())}
                onClick={() => toggleConfirmed('timeline')}
                title="Confirm close timeline"
              />
            </label>
            <select
              value={deal.timeline || ''}
              onChange={(e) => handleChange('timeline', e.target.value, 'timeline')}
              className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="">Select...</option>
              <option value="15-30 Days">15-30 Days</option>
              <option value="30-45 Days">30-45 Days</option>
              <option value="30-60 Days+">30-60 Days+</option>
              <option value="Flexible / No Rush">Flexible / No Rush</option>
            </select>
          </div>

          <div>
            <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
              <span className="flex items-center gap-1.5">
                <DollarSign size={12} />
                Earnest Deposit
              </span>
              <ConfirmBadge
                confirmed={Boolean(confirmedTerms.earnestDeposit)}
                complete={Boolean((deal.earnestDeposit || '').trim())}
                onClick={() => toggleConfirmed('earnestDeposit')}
                title="Confirm earnest deposit"
              />
            </label>
            <input
              type="text"
              value={deal.earnestDeposit || ''}
              onChange={(e) => handleChange('earnestDeposit', e.target.value, 'earnestDeposit')}
              placeholder="Delivered within 3 business days"
              className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>
      </div>

      {selectedPath === 'creative_finance' ? (
        <div className="mt-4 p-3 rounded-lg border-2 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/10">
          <div className="text-[10px] font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400 mb-2 flex items-center gap-1.5">
            <Building2 size={14} />
            Creative Finance Terms
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
                <span>Down Payment</span>
                <ConfirmBadge
                  confirmed={Boolean(confirmedTerms.cfDownPayment)}
                  complete={(deal.cfDownPayment || 0) > 0}
                  onClick={() => toggleConfirmed('cfDownPayment')}
                  title="Confirm down payment"
                />
              </label>
              <div className="relative">
                <span className="absolute left-2.5 top-1.5 text-[12px] text-gray-500">$</span>
                <input
                  type="number"
                  value={deal.cfDownPayment || ''}
                  onChange={(e) => handleChange('cfDownPayment', parseFloat(e.target.value) || 0, 'cfDownPayment')}
                  placeholder="0"
                  className="w-full pl-6 pr-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>

            <div>
              <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
                <span>Interest Rate (%)</span>
                <ConfirmBadge
                  confirmed={Boolean(confirmedTerms.cfRate)}
                  complete={(deal.cfRate || 0) > 0}
                  onClick={() => toggleConfirmed('cfRate')}
                  title="Confirm interest rate"
                />
              </label>
              <input
                type="number"
                step="0.1"
                value={deal.cfRate || ''}
                onChange={(e) => handleChange('cfRate', parseFloat(e.target.value) || 0, 'cfRate')}
                placeholder="5.0"
                className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
                <span>Term (years)</span>
                <ConfirmBadge
                  confirmed={Boolean(confirmedTerms.cfTerm)}
                  complete={(deal.cfTerm || 0) > 0}
                  onClick={() => toggleConfirmed('cfTerm')}
                  title="Confirm term length"
                />
              </label>
              <select
                value={deal.cfTerm || 30}
                onChange={(e) => handleChange('cfTerm', parseInt(e.target.value, 10), 'cfTerm')}
                className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="5">5 years</option>
                <option value="7">7 years</option>
                <option value="10">10 years</option>
                <option value="15">15 years</option>
                <option value="30">30 years</option>
              </select>
            </div>

            <div>
              <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
                <span>Financing Type</span>
                <ConfirmBadge
                  confirmed={Boolean(confirmedTerms.cfType)}
                  complete={Boolean(deal.cfType)}
                  onClick={() => toggleConfirmed('cfType')}
                  title="Confirm CF structure"
                />
              </label>
              <select
                value={deal.cfType || 'carry'}
                onChange={(e) => handleChange('cfType', e.target.value as DealData['cfType'], 'cfType')}
                className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="carry">Seller Carry Note</option>
                <option value="subto">Subject-To (assume existing)</option>
                <option value="wrap">Wrap Mortgage</option>
              </select>
            </div>
          </div>
        </div>
      ) : null}

      {selectedPath === 'subject_to' ? (
        <div className="mt-4 p-3 rounded-lg border-2 border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/10">
          <div className="text-[10px] font-bold uppercase tracking-wide text-purple-600 dark:text-purple-400 mb-2 flex items-center gap-1.5">
            <Home size={14} />
            Mortgage Takeover Details
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
                <span>Upfront Cash to Seller</span>
                <ConfirmBadge
                  confirmed={Boolean(confirmedTerms.mtUpfront)}
                  complete={(deal.mtUpfront || 0) > 0 || Boolean(confirmedTerms.mtUpfront)}
                  onClick={() => toggleConfirmed('mtUpfront')}
                  title="Confirm upfront cash"
                />
              </label>
              <div className="relative">
                <span className="absolute left-2.5 top-1.5 text-[12px] text-gray-500">$</span>
                <input
                  type="number"
                  value={deal.mtUpfront || ''}
                  onChange={(e) => handleChange('mtUpfront', parseFloat(e.target.value) || 0, 'mtUpfront')}
                  placeholder="0"
                  className="w-full pl-6 pr-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>

            <div>
              <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
                <span>Existing Loan Balance (Confirm)</span>
                <ConfirmBadge
                  confirmed={Boolean(confirmedTerms.mtBalanceConfirm)}
                  complete={(deal.mtBalanceConfirm || 0) > 0}
                  onClick={() => toggleConfirmed('mtBalanceConfirm')}
                  title="Confirm existing loan balance"
                />
              </label>
              <div className="relative">
                <span className="absolute left-2.5 top-1.5 text-[12px] text-gray-500">$</span>
                <input
                  type="number"
                  value={deal.mtBalanceConfirm || ''}
                  onChange={(e) =>
                    handleChange('mtBalanceConfirm', parseFloat(e.target.value) || 0, 'mtBalanceConfirm')
                  }
                  placeholder="0"
                  className="w-full pl-6 pr-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>

            <div>
              <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
                <span>Existing Interest Rate (Confirm)</span>
                <ConfirmBadge
                  confirmed={Boolean(confirmedTerms.mtRateConfirm)}
                  complete={(deal.mtRateConfirm || 0) > 0}
                  onClick={() => toggleConfirmed('mtRateConfirm')}
                  title="Confirm existing rate"
                />
              </label>
              <input
                type="number"
                step="0.1"
                value={deal.mtRateConfirm || ''}
                onChange={(e) =>
                  handleChange('mtRateConfirm', parseFloat(e.target.value) || 0, 'mtRateConfirm')
                }
                placeholder="3.5"
                className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
                <span>Takeover Type</span>
                <ConfirmBadge
                  confirmed={Boolean(confirmedTerms.mtType)}
                  complete={Boolean(deal.mtType)}
                  onClick={() => toggleConfirmed('mtType')}
                  title="Confirm MT structure"
                />
              </label>
              <select
                value={deal.mtType || 'subto'}
                onChange={(e) => handleChange('mtType', e.target.value as DealData['mtType'], 'mtType')}
                className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="subto">Subject-To (loan stays in seller name)</option>
                <option value="assume">Formal Assumption</option>
                <option value="carry-gap">Sub-To + Seller Carry Gap</option>
              </select>
            </div>
          </div>
        </div>
      ) : null}

      {selectedPath === 'rbp' ? (
        <div className="mt-4 p-3 rounded-lg border-2 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10">
          <div className="text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-1.5">
            <Building2 size={14} />
            Retail Buyer Program Details
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
                <span>RBP Price (Confirm)</span>
                <ConfirmBadge
                  confirmed={Boolean(confirmedTerms.rbpPriceConfirm)}
                  complete={(deal.rbpPriceConfirm || 0) > 0}
                  onClick={() => toggleConfirmed('rbpPriceConfirm')}
                  title="Confirm RBP price"
                />
              </label>
              <div className="relative">
                <span className="absolute left-2.5 top-1.5 text-[12px] text-gray-500">$</span>
                <input
                  type="number"
                  value={deal.rbpPriceConfirm || ''}
                  onChange={(e) =>
                    handleChange('rbpPriceConfirm', parseFloat(e.target.value) || 0, 'rbpPriceConfirm')
                  }
                  placeholder="0"
                  className="w-full pl-6 pr-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>

            <div>
              <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
                <span>Buyer Type</span>
                <ConfirmBadge
                  confirmed={Boolean(confirmedTerms.rbpBuyerType)}
                  complete={Boolean(deal.rbpBuyerType)}
                  onClick={() => toggleConfirmed('rbpBuyerType')}
                  title="Confirm buyer type"
                />
              </label>
              <select
                value={deal.rbpBuyerType || 'retail'}
                onChange={(e) => handleChange('rbpBuyerType', e.target.value, 'rbpBuyerType')}
                className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="retail">Pre-qualified retail buyer (FHA, VA, or conventional)</option>
                <option value="fha">FHA buyer (3.5% min down)</option>
                <option value="va">VA buyer (0% down, veteran/military)</option>
                <option value="usda">USDA buyer (0% down, qualifying area)</option>
                <option value="conv">Conventional buyer (3-20% down)</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
                <span>Seller Costs Covered</span>
                <ConfirmBadge
                  confirmed={Boolean(confirmedTerms.rbpSellerCosts)}
                  complete={Boolean((deal.rbpSellerCosts || '').trim())}
                  onClick={() => toggleConfirmed('rbpSellerCosts')}
                  title="Confirm seller costs"
                />
              </label>
              <input
                type="text"
                value={deal.rbpSellerCosts || ''}
                onChange={(e) => handleChange('rbpSellerCosts', e.target.value, 'rbpSellerCosts')}
                placeholder="$0 - all repairs, inspections, commissions & closing costs covered"
                className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div className="md:col-span-2">
              <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
                <span>Cash Alternative Offer</span>
                <ConfirmBadge
                  confirmed={Boolean(confirmedTerms.rbpCashAlternative)}
                  complete={(deal.rbpCashAlternative || 0) > 0}
                  onClick={() => toggleConfirmed('rbpCashAlternative')}
                  title="Confirm cash alternative"
                />
              </label>
              <div className="relative">
                <span className="absolute left-2.5 top-1.5 text-[12px] text-gray-500">$</span>
                <input
                  type="number"
                  value={deal.rbpCashAlternative || ''}
                  onChange={(e) =>
                    handleChange('rbpCashAlternative', parseFloat(e.target.value) || 0, 'rbpCashAlternative')
                  }
                  placeholder="0"
                  className="w-full pl-6 pr-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedPath === 'cash' ? (
        <div className="mt-4 p-3 rounded-lg border-2 border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10">
          <div className="text-[10px] font-bold uppercase tracking-wide text-green-600 dark:text-green-400 mb-2 flex items-center gap-1.5">
            <DollarSign size={14} />
            Cash Wholesale Terms
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
                <span>As-Is Purchase</span>
                <ConfirmBadge
                  confirmed={Boolean(confirmedTerms.cashAsIs)}
                  complete={Boolean(deal.cashAsIs)}
                  onClick={() => toggleConfirmed('cashAsIs')}
                  title="Confirm as-is terms"
                />
              </label>
              <select
                value={deal.cashAsIs || 'yes'}
                onChange={(e) => handleChange('cashAsIs', e.target.value as DealData['cashAsIs'], 'cashAsIs')}
                className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="yes">Yes - all-cash, no contingencies</option>
                <option value="inspection">With inspection period</option>
              </select>
            </div>

            <div>
              <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
                <span>Close Period</span>
                <ConfirmBadge
                  confirmed={Boolean(confirmedTerms.cashClosePeriod)}
                  complete={Boolean(deal.cashClosePeriod)}
                  onClick={() => toggleConfirmed('cashClosePeriod')}
                  title="Confirm close period"
                />
              </label>
              <select
                value={deal.cashClosePeriod || '21'}
                onChange={(e) =>
                  handleChange('cashClosePeriod', e.target.value as DealData['cashClosePeriod'], 'cashClosePeriod')
                }
                className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="21">21 days or less</option>
                <option value="30">30 days</option>
                <option value="45">45 days</option>
              </select>
            </div>
          </div>
        </div>
      ) : null}

      {selectedPath === 'land' ? (
        <div className="mt-4 p-3 rounded-lg border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/10">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-2 flex items-center gap-1.5">
            <Building2 size={14} />
            Land Assignment Details
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
                <span>Lot Size (Confirm)</span>
                <ConfirmBadge
                  confirmed={Boolean(confirmedTerms.landLotSizeConfirm)}
                  complete={Boolean((deal.landLotSizeConfirm || '').trim())}
                  onClick={() => toggleConfirmed('landLotSizeConfirm')}
                  title="Confirm lot size"
                />
              </label>
              <input
                type="text"
                value={deal.landLotSizeConfirm || ''}
                onChange={(e) => handleChange('landLotSizeConfirm', e.target.value, 'landLotSizeConfirm')}
                placeholder="0.25 acres"
                className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
                <span>Buyer Type</span>
                <ConfirmBadge
                  confirmed={Boolean(confirmedTerms.landBuyerType)}
                  complete={Boolean(deal.landBuyerType)}
                  onClick={() => toggleConfirmed('landBuyerType')}
                  title="Confirm buyer type"
                />
              </label>
              <select
                value={deal.landBuyerType || 'retail'}
                onChange={(e) => handleChange('landBuyerType', e.target.value, 'landBuyerType')}
                className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="retail">Pre-qualified retail buyer (FHA, VA, or conventional)</option>
                <option value="builder">Builder / developer buyer</option>
                <option value="fha">FHA buyer</option>
                <option value="conv">Conventional buyer</option>
              </select>
            </div>

            {showLandSellerCosts ? (
              <div className="md:col-span-2">
                <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
                  <span>Seller Costs Covered</span>
                  <ConfirmBadge
                    confirmed={Boolean(confirmedTerms.landSellerCosts)}
                    complete={Boolean((deal.landSellerCosts || '').trim())}
                    onClick={() => toggleConfirmed('landSellerCosts')}
                    title="Confirm land seller costs"
                  />
                </label>
                <input
                  type="text"
                  value={deal.landSellerCosts || ''}
                  onChange={(e) => handleChange('landSellerCosts', e.target.value, 'landSellerCosts')}
                  placeholder="$0 - all fees, commissions & closing costs covered"
                  className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/50">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Confirm Terms Before Generating Docs
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Match the live call workflow from v5 while keeping the modern UI.
            </div>
          </div>
          <div className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600 shadow-sm dark:bg-slate-800 dark:text-slate-300">
            {confirmedCount}/{liveCallSupport.checklist.length} confirmed
          </div>
        </div>

        <div className="space-y-2">
          {liveCallSupport.checklist.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => toggleConfirmed(item.id)}
              className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition-all ${
                item.confirmed
                  ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/15'
                  : item.complete
                    ? 'border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-blue-800 dark:hover:bg-blue-900/10'
                    : 'border-slate-200 bg-slate-100/70 dark:border-slate-700 dark:bg-slate-900/60'
              }`}
            >
              <div
                className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border ${
                  item.confirmed
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : item.complete
                      ? 'border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300'
                      : 'border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-500'
                }`}
              >
                {item.confirmed ? <Check size={12} /> : <Circle size={10} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium text-gray-800 dark:text-gray-100">
                  {item.label}
                </div>
                <div className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                  {item.confirmed
                    ? 'Confirmed'
                    : item.complete
                      ? 'Ready to confirm'
                      : 'Needs capture before docs'}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <a
        href="https://www.doubleclose.com/proof-of-funds-request/"
        target="_blank"
        rel="noreferrer"
        className="mt-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-3 py-3 text-left transition-all hover:border-amber-300 hover:shadow-sm dark:border-amber-800 dark:from-amber-900/15 dark:to-orange-900/10"
      >
        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-amber-600 shadow-sm dark:bg-slate-800 dark:text-amber-300">
          <ShieldCheck size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
            Proof of Funds
          </div>
          <div className="mt-1 text-[12px] text-amber-800 dark:text-amber-200">
            Request proof of funds from DoubleClose before you send the package.
          </div>
          <div className="mt-1 text-[10px] text-amber-700/80 dark:text-amber-300/80">
            doubleclose.com - opens in a new tab
          </div>
        </div>
        <ArrowUpRight size={16} className="shrink-0 text-amber-700 dark:text-amber-300" />
      </a>

      <div className="mt-4 space-y-3">
        <div>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
            <FileText size={12} />
            Notes
          </label>
          <textarea
            value={deal.notes || ''}
            onChange={(e) => handleChange('notes', e.target.value)}
            placeholder="Key information from the call..."
            rows={3}
            className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
              <AlertCircle size={12} />
              Price Reductions
            </label>
            <div className="relative">
              <span className="absolute left-2.5 top-1.5 text-[12px] text-gray-500">$</span>
              <input
                type="number"
                value={deal.reductions || ''}
                onChange={(e) => handleChange('reductions', parseFloat(e.target.value) || 0)}
                placeholder="0"
                className="w-full pl-6 pr-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-400 mb-1">
              <Home size={12} />
              Vacant Status
            </label>
            <select
              value={deal.vacantStatus || ''}
              onChange={(e) => handleChange('vacantStatus', e.target.value)}
              className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-slate-700 rounded-md bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="">Select...</option>
              <option value="Vacant">Vacant</option>
              <option value="Owner Occupied">Owner Occupied</option>
              <option value="Tenant Occupied">Tenant Occupied</option>
              <option value="Partially Vacant">Partially Vacant</option>
            </select>
          </div>
        </div>
      </div>

      {deal.sellerName && agreedPrice > 0 ? (
        <div className="mt-4 p-3 rounded-lg bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900/20 dark:to-gray-800/20 border border-gray-200 dark:border-gray-700">
          <div className="text-[10px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-2">
            Deal Confirmation Summary
          </div>
          <div className="text-[11px] text-gray-700 dark:text-gray-300 space-y-1">
            <div>
              <strong>Path:</strong> {LIVE_PATH_NAMES[selectedPath]}
            </div>
            <div>
              <strong>Seller:</strong> {deal.sellerName}
            </div>
            {deal.address ? (
              <div>
                <strong>Property:</strong> {deal.address}
              </div>
            ) : null}
            <div>
              <strong>Agreed Price:</strong> ${agreedPrice.toLocaleString()}
            </div>
            {deal.timeline ? (
              <div>
                <strong>Timeline:</strong> {deal.timeline}
              </div>
            ) : null}
            <div>
              <strong>Phone:</strong> {getPhoneStatusLabel(liveCallSupport.phoneStatus)}
            </div>

            {selectedPath === 'creative_finance' && deal.cfDownPayment ? (
              <div>
                <strong>Down Payment:</strong> ${deal.cfDownPayment.toLocaleString()} @ {deal.cfRate}% /{' '}
                {deal.cfTerm}yr
              </div>
            ) : null}
            {selectedPath === 'subject_to' && deal.mtUpfront !== undefined ? (
              <div>
                <strong>Upfront:</strong> ${deal.mtUpfront.toLocaleString()} + Loan Takeover
              </div>
            ) : null}
            {selectedPath === 'rbp' && deal.rbpPriceConfirm ? (
              <>
                <div>
                  <strong>RBP Price:</strong> ${deal.rbpPriceConfirm.toLocaleString()}
                </div>
                {deal.rbpCashAlternative ? (
                  <div>
                    <strong>Cash Alternative:</strong> ${deal.rbpCashAlternative.toLocaleString()}
                  </div>
                ) : null}
              </>
            ) : null}
            {selectedPath === 'cash' && deal.cashClosePeriod ? (
              <div>
                <strong>Close:</strong> {deal.cashClosePeriod} days,{' '}
                {deal.cashAsIs === 'yes' ? 'As-Is' : 'With Inspection'}
              </div>
            ) : null}
            {selectedPath === 'land' && deal.landLotSizeConfirm ? (
              <>
                <div>
                  <strong>Lot Size:</strong> {deal.landLotSizeConfirm}
                </div>
                {showLandSellerCosts && deal.landSellerCosts ? (
                  <div>
                    <strong>Seller Costs:</strong> {deal.landSellerCosts}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {deal.motivationScore ? (
        <div className="mt-4 p-3 rounded-lg bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/10 dark:to-purple-900/10 border border-blue-200 dark:border-blue-800">
          <div className="text-[10px] font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400 mb-2">
            Recommended Action
          </div>
          <div className="text-[12px] text-gray-800 dark:text-gray-200">
            {deal.motivationScore === 1 || deal.motivationScore === 2
              ? 'Educate only. Leave the DIR. Set a 7-day follow-up. Do not push an LOI.'
              : deal.motivationScore === 3
                ? 'Present all 4 paths side-by-side. Issue a comparison page. Ask which timeline matters most.'
                : deal.motivationScore === 4
                  ? 'Present 1-2 best-fit paths. Issue LOI immediately after meeting. Follow up in 24 hrs.'
                  : 'Go directly to LOI on the dominant path. Close in the same meeting if possible. Urgency is already there - match it.'}
          </div>
          <div className="text-[10px] text-gray-600 dark:text-gray-400 mt-2 font-medium">
            Path Strategy:{' '}
            {deal.motivationScore === 1 || deal.motivationScore === 2
              ? 'No active path yet - build trust first.'
              : deal.motivationScore === 3
                ? 'Offer all paths. Let seller self-select.'
                : deal.motivationScore === 4
                  ? 'Lead with best-fit path. Cash as anchor.'
                  : 'Close path only. No path shopping.'}
          </div>
        </div>
      ) : null}
    </div>
  );
}
