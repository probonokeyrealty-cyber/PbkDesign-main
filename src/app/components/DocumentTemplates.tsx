import { useState } from 'react';
import { DealData } from '../types';
import { FileText, Download, Copy, Check } from 'lucide-react';
import { formatCurrency, formatDate } from '../utils/formatting';
import { downloadTextFile, copyToClipboard } from '../utils/fileExport';

interface DocumentTemplatesProps {
  deal: DealData;
}

export function DocumentTemplates({ deal }: DocumentTemplatesProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const today = formatDate();

  const templates = {
    purchase: {
      title: 'Purchase Agreement',
      icon: '📄',
      content: `REAL ESTATE PURCHASE AGREEMENT

This Purchase Agreement ("Agreement") is made on ${today}, between:

SELLER: [SELLER NAME]
Property Address: ${deal.address || '[PROPERTY ADDRESS]'}

BUYER: [YOUR NAME/COMPANY]
Contact: [YOUR CONTACT INFO]

PURCHASE TERMS:
Purchase Price: ${formatCurrency(deal.price)}
Earnest Money Deposit: $1,000 (to be held in escrow)
Closing Date: [DATE - typically 30-45 days]

PROPERTY DETAILS:
Type: ${deal.type === 'house' ? 'Single Family Residence' : 'Land/Lot'}
${deal.type === 'house' ? `Bedrooms: ${deal.beds}\nBathrooms: ${deal.baths}\nSquare Feet: ${deal.sqft?.toLocaleString()}` : `Lot Size: ${deal.lotSize} acres`}

CONDITIONS:
1. Property sold AS-IS, WHERE-IS with all faults
2. Buyer has the right to inspect property within 10 days
3. Subject to clear title and standard exceptions
4. Buyer may assign this contract to qualified buyer
5. Seller to provide clear and marketable title

CONTINGENCIES:
- Satisfactory property inspection
- Clear title report
- Buyer's ability to secure financing (if applicable)

The parties agree to the terms outlined above.

SELLER: ___________________________ DATE: ___________

BUYER: ___________________________ DATE: ___________

---
This is a template only. Consult with a real estate attorney before use.
Probono Key Realty © ${new Date().getFullYear()}`,
    },
    assignment: {
      title: 'Assignment Contract',
      icon: '🔄',
      content: `ASSIGNMENT OF PURCHASE AGREEMENT

Date: ${today}

ASSIGNOR (Original Buyer): [YOUR NAME/COMPANY]
ASSIGNEE (New Buyer): [END BUYER NAME]

Property Address: ${deal.address || '[PROPERTY ADDRESS]'}

RECITALS:
Assignor entered into a Purchase Agreement dated [DATE] with the Seller for the above property at a purchase price of ${formatCurrency(deal.price)}.

ASSIGNMENT TERMS:
1. Assignment Fee: ${formatCurrency(deal.fee || 8000)}
2. Assignor assigns all rights, title, and interest in the Purchase Agreement to Assignee
3. Assignee assumes all obligations under the original Purchase Agreement
4. Assignment Fee is due at closing
5. Assignee shall complete the purchase directly with the Seller

REPRESENTATIONS:
- Assignor warrants having the right to assign this contract
- Assignee has reviewed and accepts the original Purchase Agreement
- All parties consent to this assignment

ASSIGNOR: ___________________________ DATE: ___________

ASSIGNEE: ___________________________ DATE: ___________

SELLER CONSENT: _____________________ DATE: ___________

---
This is a template only. Consult with a real estate attorney before use.
Probono Key Realty © ${new Date().getFullYear()}`,
    },
    seller_questionnaire: {
      title: 'Seller Questionnaire',
      icon: '📋',
      content: `SELLER PROPERTY QUESTIONNAIRE

Property Address: ${deal.address || '[PROPERTY ADDRESS]'}
Date: ${today}
Seller Name: ___________________________

PROPERTY INFORMATION:
1. How long have you owned this property? ___________
2. Is the property currently occupied? ☐ Yes ☐ No
3. Are you the sole owner? ☐ Yes ☐ No
   If no, list other owners: ___________________________

MOTIVATION & TIMELINE:
4. Why are you selling? ___________________________
5. When do you need to close? ___________________________
6. What's your ideal timeline? ___________________________
7. What price would you accept for a quick cash close? ___________

PROPERTY CONDITION:
8. Are there any known defects or issues? ☐ Yes ☐ No
   If yes, please describe: ___________________________
9. What repairs or updates are needed?
   ${deal.type === 'house' ? `
   ☐ Roof          ☐ HVAC         ☐ Plumbing
   ☐ Electrical    ☐ Foundation   ☐ Kitchen
   ☐ Bathrooms     ☐ Flooring     ☐ Paint
   ☐ Other: ___________________________` : `
   ☐ Clearing      ☐ Grading      ☐ Utilities
   ☐ Access Road   ☐ Survey       ☐ Other: ___________`}

10. Estimated repair costs: ___________

FINANCIAL INFORMATION:
11. Current mortgage balance: ___________
12. Monthly mortgage payment: ___________
13. Interest rate: ___________
14. Are payments current? ☐ Yes ☐ No
15. Any liens or encumbrances? ☐ Yes ☐ No
16. Property taxes (annual): ___________

ADDITIONAL INFORMATION:
17. Why is this a good deal for an investor? ___________________________
18. What's the best feature of this property? ___________________________
19. Preferred contact method: ☐ Phone ☐ Email ☐ Text
20. Best time to reach you: ___________________________

Thank you for your time!

For questions, contact: [YOUR NAME]
Phone: [YOUR PHONE] | Email: [YOUR EMAIL]

---
Probono Key Realty © ${new Date().getFullYear()}`,
    },
    offer_letter: {
      title: 'Offer Letter',
      icon: '💼',
      content: `LETTER OF INTENT TO PURCHASE

${today}

Dear [SELLER NAME],

Thank you for the opportunity to present an offer on your property at ${deal.address || '[PROPERTY ADDRESS]'}.

OFFER SUMMARY:
Purchase Price: ${formatCurrency(deal.maoRBP || deal.price)}
Earnest Money: $1,000
Closing Timeline: 14-30 days (flexible to your needs)
Purchase Type: Cash / As-Is

WHY OUR OFFER MAKES SENSE:
✓ Quick Close: We can close in as little as 14 days
✓ No Repairs Needed: We buy the property as-is
✓ Cash Purchase: No financing contingencies
✓ No Realtor Fees: You keep more of the sale price
✓ Certainty: We have the funds ready to close

${deal.type === 'house' ? `
PROPERTY ANALYSIS:
After-Repair Value (ARV): ${formatCurrency(deal.arv)}
Estimated Repairs: ${formatCurrency(deal.repairs.mid)}
Our Maximum Offer: ${formatCurrency(deal.maoRBP)}

This offer factors in repair costs, holding costs, and provides you with a fast, guaranteed sale.` : `
LAND ANALYSIS:
Builder Value: ${formatCurrency(deal.builderTotal)}
Our Offer: ${formatCurrency(deal.offer)}

This offer provides you with immediate liquidity while we handle finding the right builder.`}

NEXT STEPS:
1. Review this offer at your convenience
2. Call me with questions: [YOUR PHONE]
3. Sign the Purchase Agreement to move forward
4. We'll open escrow within 24 hours

I'm committed to making this process as smooth as possible for you. I understand this is an important decision, and I'm here to answer any questions.

Looking forward to working with you!

Best regards,

[YOUR NAME]
[YOUR COMPANY]
Phone: [YOUR PHONE]
Email: [YOUR EMAIL]

---
Probono Key Realty © ${new Date().getFullYear()}`,
    },
    comps_report: {
      title: 'Comparable Sales Report',
      icon: '📊',
      content: `COMPARABLE SALES ANALYSIS

Property: ${deal.address || '[PROPERTY ADDRESS]'}
Analysis Date: ${today}
Prepared by: [YOUR NAME/COMPANY]

SUBJECT PROPERTY:
Address: ${deal.address || '[PROPERTY ADDRESS]'}
Type: ${deal.type === 'house' ? 'Single Family Residence' : 'Land/Lot'}
${deal.type === 'house' ? `Beds/Baths: ${deal.beds}/${deal.baths}
Square Feet: ${deal.sqft?.toLocaleString()}
Year Built: ${deal.year}` : `Lot Size: ${deal.lotSize} acres`}
List Price: ${formatCurrency(deal.price)}

${deal.type === 'house' ? `COMPARABLE SALES:

Comp A: ${deal.comps.A.address || '[Address]'}
Sold Price: ${formatCurrency(deal.comps.A.price)}
Sold Date: ${deal.comps.A.date || '[Date]'}

Comp B: ${deal.comps.B.address || '[Address]'}
Sold Price: ${formatCurrency(deal.comps.B.price)}
Sold Date: ${deal.comps.B.date || '[Date]'}

Comp C: ${deal.comps.C.address || '[Address]'}
Sold Price: ${formatCurrency(deal.comps.C.price)}
Sold Date: ${deal.comps.C.date || '[Date]'}

VALUATION ANALYSIS:
After-Repair Value (ARV): ${formatCurrency(deal.arv)}
(Average of comparable sales)

Estimated Repairs: ${formatCurrency(deal.repairs.mid)}
Property Condition: ${deal.repairs.condition}

OFFER RECOMMENDATION:
Maximum Allowable Offer (70%): ${formatCurrency(deal.arv * 0.70 - deal.repairs.mid)}
Retail Buyer Price (88% RBP): ${formatCurrency(deal.maoRBP)}

CONCLUSION:
${deal.price <= deal.maoRBP 
  ? `At the current list price of ${formatCurrency(deal.price)}, this property represents a strong investment opportunity with built-in equity for a retail buyer.`
  : `The current list price of ${formatCurrency(deal.price)} exceeds our maximum offer of ${formatCurrency(deal.maoRBP)}. Negotiation recommended.`}` : `
MARKET ANALYSIS:
Builder Price per ¼ acre: ${formatCurrency(deal.builderPrice)}
Total Lot Units: ${(parseFloat(deal.lotSize) / 0.25).toFixed(2)}
Builder Total Value: ${formatCurrency(deal.builderTotal)}

OFFER RECOMMENDATION:
Recommended Offer: ${formatCurrency(deal.offer)}
Target Spread: ${formatCurrency(deal.builderTotal - deal.offer)}

CONCLUSION:
This land opportunity provides a ${((deal.builderTotal - deal.offer) / deal.builderTotal * 100).toFixed(1)}% spread for assignment to qualified builders.`}

---
This analysis is for informational purposes only.
Probono Key Realty © ${new Date().getFullYear()}`,
    },
  };

  const copyToClipboard = (content: string) => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadDocument = (template: keyof typeof templates) => {
    const content = templates[template].content;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${templates[template].title.replace(/\s+/g, '_')}_${deal.address?.replace(/[^a-zA-Z0-9]/g, '_') || 'Template'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-3.5">
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
          <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
            Document Templates
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
          {Object.entries(templates).map(([key, template]) => (
            <button
              key={key}
              onClick={() => setSelectedTemplate(selectedTemplate === key ? null : key)}
              className={`p-3 rounded-lg border text-left transition-all ${
                selectedTemplate === key
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 hover:border-blue-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">{template.icon}</span>
                <div className="flex-1">
                  <div className="text-[12px] font-semibold text-gray-900 dark:text-gray-100">
                    {template.title}
                  </div>
                </div>
                <FileText size={16} className="text-gray-400" />
              </div>
            </button>
          ))}
        </div>

        {selectedTemplate && (
          <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
            <div className="bg-gray-100 dark:bg-slate-900 px-4 py-2 flex items-center justify-between">
              <span className="text-[12px] font-semibold text-gray-900 dark:text-gray-100">
                {templates[selectedTemplate as keyof typeof templates].title}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => copyToClipboard(templates[selectedTemplate as keyof typeof templates].content)}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-blue-500 text-white text-[11px] font-medium hover:bg-blue-600 transition-all"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={() => downloadDocument(selectedTemplate as keyof typeof templates)}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-green-500 text-white text-[11px] font-medium hover:bg-green-600 transition-all"
                >
                  <Download size={12} />
                  Download
                </button>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-800 p-4 max-h-96 overflow-y-auto">
              <pre className="text-[11px] text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-mono leading-relaxed">
                {templates[selectedTemplate as keyof typeof templates].content}
              </pre>
            </div>
          </div>
        )}
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3">
        <div className="text-[11px] text-blue-800 dark:text-blue-300 leading-relaxed">
          <strong>⚠️ Legal Disclaimer:</strong> These templates are provided for informational purposes only and do not constitute legal advice. Always consult with a qualified real estate attorney in your jurisdiction before using any legal documents.
        </div>
      </div>
    </div>
  );
}
