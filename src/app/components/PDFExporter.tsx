import { DealData } from '../types';
import { Download, FileText } from 'lucide-react';
import { formatCurrency, formatDate } from '../utils/formatting';
import { downloadTextFile } from '../utils/fileExport';

interface PDFExporterProps {
  deal: DealData;
}

export function PDFExporter({ deal }: PDFExporterProps) {
  const generateDealReport = () => {
    const today = formatDate();

    return `
═══════════════════════════════════════════════════════════════════
                    PBK DEAL ANALYSIS REPORT
                    Probono Key Realty
═══════════════════════════════════════════════════════════════════

REPORT DATE: ${today}
PROPERTY ADDRESS: ${deal.address || 'N/A'}
ANALYST: [YOUR NAME]

───────────────────────────────────────────────────────────────────
PROPERTY OVERVIEW
───────────────────────────────────────────────────────────────────

Property Type:        ${deal.type === 'house' ? 'Single Family Residence' : 'Land/Lot'}
Contact Type:         ${deal.contact === 'owner' ? 'Owner/FSBO' : 'Realtor Listed'}
List Price:           ${formatCurrency(deal.price)}
${deal.type === 'house' ? `
Bedrooms:             ${deal.beds || 'N/A'}
Bathrooms:            ${deal.baths || 'N/A'}
Square Footage:       ${deal.sqft?.toLocaleString() || 'N/A'}
Year Built:           ${deal.year || 'N/A'}
Days on Market:       ${deal.dom || 'N/A'}
` : `
Lot Size:             ${deal.lotSize} acres
Target Zip Code:      ${deal.zipCode || 'N/A'}
`}

${deal.type === 'house' ? `───────────────────────────────────────────────────────────────────
VALUATION ANALYSIS
───────────────────────────────────────────────────────────────────

After-Repair Value (ARV):        ${formatCurrency(deal.arv)}
Estimated Repairs (Mid):         ${formatCurrency(deal.repairs.mid)}
Property Condition:              ${deal.repairs.condition || 'N/A'}

COMPARABLE SALES:
  Comp A: ${deal.comps.A.address || 'N/A'} - ${formatCurrency(deal.comps.A.price)} (${deal.comps.A.date || 'N/A'})
  Comp B: ${deal.comps.B.address || 'N/A'} - ${formatCurrency(deal.comps.B.price)} (${deal.comps.B.date || 'N/A'})
  Comp C: ${deal.comps.C.address || 'N/A'} - ${formatCurrency(deal.comps.C.price)} (${deal.comps.C.date || 'N/A'})

───────────────────────────────────────────────────────────────────
INVESTMENT ANALYSIS
───────────────────────────────────────────────────────────────────

Maximum Allowable Offer (70%):   ${formatCurrency(deal.arv * 0.70 - deal.repairs.mid)}
Retail Buyer Price (88%):        ${formatCurrency(deal.maoRBP)}
Current List Price:              ${formatCurrency(deal.price)}

REPAIR BREAKDOWN:
  Low Estimate:                  ${formatCurrency(deal.repairs.low)}
  Mid Estimate:                  ${formatCurrency(deal.repairs.mid)}
  High Estimate:                 ${formatCurrency(deal.repairs.high)}

CREATIVE FINANCE OPTIONS:
  Monthly Rent Estimate:         ${formatCurrency(deal.rent)}
  Seller Mortgage Balance:       ${formatCurrency(deal.balance)}
  Interest Rate:                 ${deal.rate}%
  Assignment Fee Target:         ${formatCurrency(deal.fee)}
` : `───────────────────────────────────────────────────────────────────
LAND ANALYSIS
───────────────────────────────────────────────────────────────────

Builder Price per ¼ acre:        ${formatCurrency(deal.builderPrice)}
Lot Units (0.25 ac each):        ${(parseFloat(deal.lotSize) / 0.25).toFixed(2)}
Builder Total Value:             ${formatCurrency(deal.builderTotal)}
Recommended Offer:               ${formatCurrency(deal.offer)}
Assignment Spread:               ${formatCurrency(deal.builderTotal - deal.offer)} (${((deal.builderTotal - deal.offer) / deal.builderTotal * 100).toFixed(1)}%)
`}

───────────────────────────────────────────────────────────────────
DEAL VERDICT
───────────────────────────────────────────────────────────────────

${deal.verdict === 'green' ? '✓ GO - STRONG DEAL' : deal.verdict === 'yellow' ? '⚠ MAYBE - MARGINAL DEAL' : deal.verdict === 'red' ? '✗ NO GO - OVERPRICED' : '- NO VERDICT'}

${deal.verdict === 'green' ? 
  'This property presents an excellent investment opportunity with strong profit margins.' :
  deal.verdict === 'yellow' ?
  'This deal is workable but requires negotiation to achieve acceptable margins.' :
  deal.verdict === 'red' ?
  'Current pricing exceeds maximum allowable offer. Pass or negotiate significantly.' :
  'Complete property analysis to generate verdict.'}

───────────────────────────────────────────────────────────────────
STRATEGY RECOMMENDATION
───────────────────────────────────────────────────────────────────

${deal.type === 'house' ? 
  deal.balance > 0 && deal.rate < 6 ?
    'RECOMMENDED: Creative Finance / Subject-To\n' +
    'The existing mortgage balance and favorable interest rate make this an\n' +
    'excellent candidate for a Subject-To acquisition or seller financing.\n\n' +
    'PITCH APPROACH:\n' +
    '1. Discuss seller\'s motivation and timeline\n' +
    '2. Present benefits of quick close without realtor fees\n' +
    '3. Offer to take over payments or structure seller financing\n' +
    '4. Highlight cash flow potential with rental income' :
    'RECOMMENDED: Wholesale Assignment\n' +
    'Target retail buyer or fix-and-flip investor.\n\n' +
    'PITCH APPROACH:\n' +
    '1. Secure property under contract at or below MAO RBP\n' +
    '2. Market to cash buyer network\n' +
    '3. Assignment fee: ' + formatCurrency(deal.fee) + '\n' +
    '4. Close within 14-30 days'
  :
  'RECOMMENDED: Builder Assignment\n' +
  'Connect with local builders paying ' + formatCurrency(deal.builderPrice) + ' per ¼ acre.\n\n' +
  'PITCH APPROACH:\n' +
  '1. Secure lot under contract at ' + formatCurrency(deal.offer) + '\n' +
  '2. Verify zoning and utilities access\n' +
  '3. Present to builder network\n' +
  '4. Assignment spread: ' + formatCurrency(deal.builderTotal - deal.offer)
}

───────────────────────────────────────────────────────────────────
NEXT STEPS
───────────────────────────────────────────────────────────────────

☐ Contact seller to verify details and motivation
☐ Schedule property showing/inspection
☐ Confirm repair estimates with contractor
☐ Submit formal offer within 24-48 hours
☐ Line up end buyer or builder
☐ Open escrow and initiate due diligence

───────────────────────────────────────────────────────────────────

This report is for informational purposes only and does not constitute
legal, financial, or investment advice. Consult with appropriate
professionals before making any investment decisions.

Probono Key Realty | (949) 204-0072 | info@probonokeyrealty.com
© ${new Date().getFullYear()} Probono Key Realty. All Rights Reserved.

═══════════════════════════════════════════════════════════════════
`;
  };

  const generateOfferPackage = () => {
    const today = new Date().toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    });

    return `
═══════════════════════════════════════════════════════════════════
                    OFFICIAL OFFER PACKAGE
                    ${deal.address || '[PROPERTY ADDRESS]'}
═══════════════════════════════════════════════════════════════════

DATE: ${today}
TO: Seller of ${deal.address || '[PROPERTY ADDRESS]'}
FROM: [YOUR NAME/COMPANY]

Dear Property Owner,

Thank you for the opportunity to present an offer on your property.
We have completed a thorough analysis and are prepared to move forward
with a quick, hassle-free transaction.

───────────────────────────────────────────────────────────────────
OFFER SUMMARY
───────────────────────────────────────────────────────────────────

Property Address:         ${deal.address || '[PROPERTY ADDRESS]'}
Purchase Price:           ${formatCurrency(deal.type === 'house' ? deal.maoRBP : deal.offer)}
Earnest Money Deposit:    $1,000 (refundable during inspection period)
Closing Timeline:         14-30 days (flexible to your needs)
Purchase Terms:           Cash / As-Is Condition

───────────────────────────────────────────────────────────────────
WHY THIS OFFER MAKES SENSE
───────────────────────────────────────────────────────────────────

✓ QUICK CLOSE
  We can close in as little as 14 days - no waiting for buyer financing

✓ NO REPAIRS NEEDED
  We purchase the property in as-is condition - save time and money

✓ CASH PURCHASE
  No financing contingencies or deal falling through at the last minute

✓ NO REALTOR FEES
  No 6% commission to pay - you keep more of the sale price

✓ CERTAINTY & CONVENIENCE
  We handle all paperwork and make the process simple for you

───────────────────────────────────────────────────────────────────
OUR ANALYSIS
───────────────────────────────────────────────────────────────────

${deal.type === 'house' ? `
Current Market Value (ARV):      ${formatCurrency(deal.arv)}
Estimated Repair Costs:          ${formatCurrency(deal.repairs.mid)}
Holding & Transaction Costs:     ${formatCurrency(deal.arv * 0.10)}
Our Maximum Offer:               ${formatCurrency(deal.maoRBP)}

This offer accounts for all costs involved in bringing the property
to retail condition and provides a fair price for a quick sale.
` : `
Builder Market Value:            ${formatCurrency(deal.builderTotal)}
Our Offer:                       ${formatCurrency(deal.offer)}
Time to Close:                   14-21 days

This offer provides immediate liquidity while we handle the process
of connecting with qualified builders.
`}

───────────────────────────────────────────────────────────────────
NEXT STEPS
───────────────────────────────────────────────────────────────────

1. REVIEW this offer at your convenience
2. CALL us with any questions: [YOUR PHONE]
3. SIGN the attached Purchase Agreement
4. We'll open escrow within 24 hours

We understand that selling your property is an important decision.
We're committed to making this process as smooth and stress-free as
possible. Our team is ready to answer any questions you may have.

───────────────────────────────────────────────────────────────────
CONTACT INFORMATION
───────────────────────────────────────────────────────────────────

[YOUR NAME]
[YOUR COMPANY]
Phone: [YOUR PHONE]
Email: [YOUR EMAIL]

Best time to reach: [TIME PREFERENCE]

We look forward to working with you and creating a win-win solution!

Sincerely,

[YOUR SIGNATURE]
[YOUR NAME]
[YOUR TITLE]

───────────────────────────────────────────────────────────────────

Probono Key Realty | (949) 204-0072 | info@probonokeyrealty.com
© ${new Date().getFullYear()} Probono Key Realty. All Rights Reserved.

═══════════════════════════════════════════════════════════════════
`;
  };

  const downloadDeliverable = (type: 'report' | 'offer', label: string) => {
    const content = type === 'report' ? generateDealReport() : generateOfferPackage();
    const filename = `${label}_${deal.address?.replace(/[^a-zA-Z0-9]/g, '_') || 'Document'}_${new Date().toISOString().split('T')[0]}.txt`;
    
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadAllDeliverables = () => {
    // Download both deliverables
    downloadDeliverable('report', 'Deliverable_A_Deal_Analysis');
    setTimeout(() => {
      downloadDeliverable('offer', 'Deliverable_B_Offer_Package');
    }, 500);
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
        <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
          PDF Deliverables
        </h3>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3 mb-3">
        <div className="text-[11px] text-blue-800 dark:text-blue-300 leading-relaxed">
          <strong>📦 Professional Deal Packages</strong><br />
          Generate investor-grade deliverables ready to share with sellers, buyers, and team members.
        </div>
      </div>

      <div className="space-y-2 mb-4">
        {/* Deliverable A - Deal Analysis Report */}
        <div className="border border-gray-200 dark:border-slate-700 rounded-lg p-3 bg-gradient-to-r from-gray-50 to-white dark:from-slate-900 dark:to-slate-800">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center text-white font-bold text-lg">
              A
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-gray-900 dark:text-gray-100 mb-1">
                Deliverable A: Complete Deal Analysis
              </div>
              <div className="text-[11px] text-gray-600 dark:text-gray-400 mb-2 leading-relaxed">
                Comprehensive property analysis including ARV calculation, repair estimates, 
                comparable sales, investment metrics, and strategic recommendations.
              </div>
              <button
                onClick={() => downloadDeliverable('report', 'Deliverable_A_Deal_Analysis')}
                className="flex items-center gap-2 px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all text-[11px] font-medium"
              >
                <Download size={14} />
                Download Deliverable A
              </button>
            </div>
          </div>
        </div>

        {/* Deliverable B - Offer Package */}
        <div className="border border-gray-200 dark:border-slate-700 rounded-lg p-3 bg-gradient-to-r from-gray-50 to-white dark:from-slate-900 dark:to-slate-800">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center text-white font-bold text-lg">
              B
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-gray-900 dark:text-gray-100 mb-1">
                Deliverable B: Professional Offer Package
              </div>
              <div className="text-[11px] text-gray-600 dark:text-gray-400 mb-2 leading-relaxed">
                Ready-to-present offer letter with property analysis, benefits breakdown, 
                and next steps. Perfect for seller presentations.
              </div>
              <button
                onClick={() => downloadDeliverable('offer', 'Deliverable_B_Offer_Package')}
                className="flex items-center gap-2 px-3 py-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-all text-[11px] font-medium"
              >
                <Download size={14} />
                Download Deliverable B
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Download All Button */}
      <button
        onClick={downloadAllDeliverables}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all text-[13px] font-bold shadow-lg"
      >
        <FileText size={16} />
        Download All Deliverables (A + B)
      </button>

      <div className="mt-3 text-[10px] text-gray-500 dark:text-gray-400 text-center">
        Deliverables are downloaded as formatted text files. Use "Save as PDF" in your text editor or word processor.
      </div>
    </div>
  );
}
