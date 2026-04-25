import { DealData } from '../types';
import { Brain, TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface DealScoringProps {
  deal: DealData;
}

export function DealScoring({ deal }: DealScoringProps) {
  // Calculate deal score (0-100)
  const calculateDealScore = (): number => {
    let score = 0;
    const factors = [];

    // Price vs ARV (30 points)
    if (deal.price > 0 && deal.arv > 0) {
      const priceRatio = deal.price / deal.arv;
      if (priceRatio <= 0.70) {
        score += 30;
        factors.push('Excellent price point (≤70% ARV)');
      } else if (priceRatio <= 0.80) {
        score += 25;
        factors.push('Good price point (70-80% ARV)');
      } else if (priceRatio <= 0.88) {
        score += 20;
        factors.push('Fair price point (80-88% ARV)');
      } else if (priceRatio <= 0.95) {
        score += 10;
        factors.push('Marginal price point (88-95% ARV)');
      } else {
        factors.push('⚠ Price exceeds 95% ARV');
      }
    }

    // Days on Market (15 points)
    if (deal.dom >= 0) {
      if (deal.dom > 90) {
        score += 15;
        factors.push('High motivation (90+ days on market)');
      } else if (deal.dom > 60) {
        score += 12;
        factors.push('Good motivation (60-90 days)');
      } else if (deal.dom > 30) {
        score += 8;
        factors.push('Moderate motivation (30-60 days)');
      } else if (deal.dom > 0) {
        score += 5;
        factors.push('Fresh listing (<30 days)');
      }
    }

    // Repair Condition (20 points)
    if (deal.repairs.mid > 0 && deal.arv > 0) {
      const repairRatio = deal.repairs.mid / deal.arv;
      if (repairRatio < 0.05) {
        score += 20;
        factors.push('Minimal repairs needed (<5% ARV)');
      } else if (repairRatio < 0.15) {
        score += 15;
        factors.push('Light repairs needed (5-15% ARV)');
      } else if (repairRatio < 0.25) {
        score += 10;
        factors.push('Moderate repairs (15-25% ARV)');
      } else {
        score += 5;
        factors.push('Heavy rehab required (>25% ARV)');
      }
    } else if (deal.type === 'land') {
      score += 20;
      factors.push('Land deal - no repair risk');
    }

    // Contact Type (10 points)
    if (deal.contact === 'owner') {
      score += 10;
      factors.push('Direct to owner (FSBO)');
    } else {
      score += 5;
      factors.push('Listed with agent');
    }

    // Creative Finance Opportunity (15 points)
    if (deal.type === 'house') {
      if (deal.balance > 0 && deal.rate > 0 && deal.rate < 6) {
        score += 15;
        factors.push(`Excellent Sub-To opportunity (${deal.rate}% rate)`);
      } else if (deal.balance > 0 && deal.rate > 0 && deal.rate < 7) {
        score += 10;
        factors.push(`Good Sub-To opportunity (${deal.rate}% rate)`);
      } else if (deal.balance > 0) {
        score += 5;
        factors.push('Potential creative finance');
      }
    }

    // Cash Flow Potential (10 points)
    if (deal.rent > 0 && deal.balance > 0 && deal.rate > 0) {
      const monthlyPayment = (deal.balance * (deal.rate / 100 / 12)) / (1 - Math.pow(1 + (deal.rate / 100 / 12), -360));
      const cashFlow = deal.rent - monthlyPayment - 300; // 300 for expenses
      if (cashFlow > 300) {
        score += 10;
        factors.push(`Strong cash flow ($${Math.round(cashFlow)}/mo)`);
      } else if (cashFlow > 100) {
        score += 7;
        factors.push(`Positive cash flow ($${Math.round(cashFlow)}/mo)`);
      } else if (cashFlow > 0) {
        score += 3;
        factors.push('Break-even cash flow');
      }
    }

    return Math.min(score, 100);
  };

  const score = calculateDealScore();

  const getScoreColor = (score: number): string => {
    if (score >= 80) return 'text-green-600 dark:text-green-400';
    if (score >= 60) return 'text-blue-600 dark:text-blue-400';
    if (score >= 40) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  const getScoreGrade = (score: number): string => {
    if (score >= 90) return 'A+';
    if (score >= 80) return 'A';
    if (score >= 70) return 'B';
    if (score >= 60) return 'C';
    if (score >= 50) return 'D';
    return 'F';
  };

  const getScoreRing = (score: number): string => {
    if (score >= 80) return 'stroke-green-500';
    if (score >= 60) return 'stroke-blue-500';
    if (score >= 40) return 'stroke-yellow-500';
    return 'stroke-red-500';
  };

  const circumference = 2 * Math.PI * 30; // radius = 30
  const strokeDashoffset = circumference - (score / 100) * circumference;

  // Identify deal killers
  const dealKillers = [];
  if (deal.price > 0 && deal.arv > 0 && deal.price > deal.arv) {
    dealKillers.push('Price exceeds ARV');
  }
  if (deal.type === 'house' && deal.repairs.mid > deal.arv * 0.3) {
    dealKillers.push('Repairs exceed 30% of ARV');
  }
  if (deal.type === 'land' && deal.builderTotal > 0 && deal.offer >= deal.builderTotal) {
    dealKillers.push('No spread for assignment');
  }

  // Identify deal strengths
  const strengths = [];
  if (deal.price > 0 && deal.arv > 0 && deal.price <= deal.arv * 0.70) {
    strengths.push('Price at or below 70% ARV - excellent margin');
  }
  if (deal.dom >= 90) {
    strengths.push('High DOM indicates motivated seller');
  }
  if (deal.contact === 'owner') {
    strengths.push('Direct to seller - faster negotiations');
  }
  if (deal.balance > 0 && deal.rate < 6) {
    strengths.push('Low interest rate - great for Sub-To');
  }
  if (deal.type === 'land' && deal.builderTotal > 0 && (deal.builderTotal - deal.offer) / deal.builderTotal >= 0.20) {
    strengths.push('20%+ spread on land deal');
  }

  return (
    <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
        <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
          AI Deal Scoring
        </h3>
      </div>

      <div className="flex items-start gap-4 mb-4">
        {/* Score Ring */}
        <div className="flex-shrink-0">
          <div className="relative w-24 h-24">
            <svg className="transform -rotate-90 w-24 h-24">
              <circle
                cx="48"
                cy="48"
                r="30"
                stroke="currentColor"
                strokeWidth="6"
                fill="none"
                className="text-gray-200 dark:text-slate-700"
              />
              <circle
                cx="48"
                cy="48"
                r="30"
                stroke="currentColor"
                strokeWidth="6"
                fill="none"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                className={`${getScoreRing(score)} transition-all duration-1000 ease-out`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className={`text-2xl font-extrabold ${getScoreColor(score)}`}>
                  {score}
                </div>
                <div className="text-[9px] font-semibold text-gray-500 dark:text-gray-400">
                  / 100
                </div>
              </div>
            </div>
          </div>
          <div className="text-center mt-1">
            <div className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
              score >= 80 ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
              score >= 60 ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
              score >= 40 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
              'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
            }`}>
              Grade: {getScoreGrade(score)}
            </div>
          </div>
        </div>

        {/* AI Analysis */}
        <div className="flex-1">
          <div className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3 mb-2">
            <div className="flex items-center gap-2 mb-2">
              <Brain size={14} className="text-blue-600 dark:text-blue-400" />
              <div className="text-[10px] font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                AI Recommendation
              </div>
            </div>
            <div className="text-[12px] text-blue-900 dark:text-blue-100 leading-relaxed">
              {score >= 80 ? (
                <>
                  <strong>STRONG DEAL - PROCEED WITH CONFIDENCE</strong><br />
                  This property scores in the top tier. Multiple profit pathways available. 
                  Move quickly to secure before other investors.
                </>
              ) : score >= 60 ? (
                <>
                  <strong>GOOD DEAL - WORTH PURSUING</strong><br />
                  Solid fundamentals with good profit potential. Review strategy options 
                  and present offer within 24-48 hours.
                </>
              ) : score >= 40 ? (
                <>
                  <strong>MARGINAL DEAL - NEGOTIATE HARD</strong><br />
                  Deal has potential but needs better terms. Focus on price reduction 
                  or creative finance to improve margins.
                </>
              ) : (
                <>
                  <strong>WEAK DEAL - PASS OR LOWBALL</strong><br />
                  Multiple red flags present. Only proceed with significant price 
                  concessions or unique opportunity factors.
                </>
              )}
            </div>
          </div>

          <div className="text-[10px] text-gray-600 dark:text-gray-400">
            Confidence Level: <strong className={getScoreColor(score)}>
              {score >= 80 ? 'Very High' : score >= 60 ? 'High' : score >= 40 ? 'Moderate' : 'Low'}
            </strong>
          </div>
        </div>
      </div>

      {/* Deal Killers */}
      {dealKillers.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle size={12} className="text-red-500" />
            <div className="text-[10px] font-bold uppercase tracking-wide text-red-600 dark:text-red-400">
              Deal Killers
            </div>
          </div>
          <div className="space-y-1">
            {dealKillers.map((killer, i) => (
              <div key={i} className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border-l-3 border-red-500 rounded px-2.5 py-1.5">
                <span className="text-red-500 text-[10px] mt-0.5">⚠</span>
                <span className="text-[11px] text-red-800 dark:text-red-300">{killer}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Deal Strengths */}
      {strengths.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 mb-2">
            <CheckCircle2 size={12} className="text-green-500" />
            <div className="text-[10px] font-bold uppercase tracking-wide text-green-600 dark:text-green-400">
              Deal Strengths
            </div>
          </div>
          <div className="space-y-1">
            {strengths.map((strength, i) => (
              <div key={i} className="flex items-start gap-2 bg-green-50 dark:bg-green-900/20 border-l-3 border-green-500 rounded px-2.5 py-1.5">
                <span className="text-green-500 text-[10px] mt-0.5">✓</span>
                <span className="text-[11px] text-green-800 dark:text-green-300">{strength}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scoring Factors */}
      <div className="border-t border-gray-200 dark:border-slate-700 pt-3">
        <div className="flex items-center gap-1.5 mb-2">
          <TrendingUp size={12} className="text-blue-500" />
          <div className="text-[10px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-400">
            Scoring Factors
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 text-[10px] text-gray-600 dark:text-gray-400">
          <div>• Price vs ARV: {score >= 20 ? '✓' : '✗'} (max 30 pts)</div>
          <div>• Days on Market: {score >= 5 ? '✓' : '✗'} (max 15 pts)</div>
          <div>• Repair Condition: {score >= 5 ? '✓' : '✗'} (max 20 pts)</div>
          <div>• Contact Type: {deal.contact === 'owner' ? '✓' : '○'} (max 10 pts)</div>
          <div>• Creative Finance: {deal.balance > 0 ? '✓' : '○'} (max 15 pts)</div>
          <div>• Cash Flow: {deal.rent > 0 ? '✓' : '○'} (max 10 pts)</div>
        </div>
      </div>
    </div>
  );
}
