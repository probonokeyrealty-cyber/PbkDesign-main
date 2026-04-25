# PBK Command Center - Migration Blueprint

**3-Column Format: Figma Element → Existing PBK → Decision**

---

## HOW TO USE THIS DOCUMENT

This is your **implementation checklist**. For every visual element:
1. Check if it exists in React
2. Check if it matches HTML functionality
3. Follow the decision (KEEP/WRAP/REPLACE/ADD)

Legend:
- ✅ **KEEP** = Working correctly, no changes needed
- 🔄 **WRAP** = Add enhancement without touching existing code
- ❌ **ADD** = Missing, needs to be built
- 🔁 **REPLACE** = Broken, needs rebuild (NONE in this project)
- 🔒 **LOCKED** = Formula/calculation, never touch

---

## SECTION 1: TOP BAR

| Figma Element | Existing PBK ID/Function | Decision |
|---------------|-------------------------|----------|
| PBK Logo | `TopBar.tsx` → Static "PBK DEAL COMMAND CENTER" | ✅ KEEP |
| Property Address Display | `TopBar.tsx` → `{deal.address}` | ✅ KEEP |
| Verdict Badge | `TopBar.tsx` → `{deal.verdict}` with color classes | ✅ KEEP |
| Print Button | `TopBar.tsx` → `window.print()` | ✅ KEEP |
| Save Button | `TopBar.tsx` → `localStorage.setItem()` | ✅ KEEP |
| Clear Button | `TopBar.tsx` → `setDeal(initialDealData)` | ✅ KEEP |
| Dark Mode Toggle | `TopBar.tsx` → `setDarkMode()` (React-only feature) | ✅ KEEP |
| Hamburger Menu (mobile) | `TopBar.tsx` → Panel toggle buttons | ✅ KEEP |

**Section Status:** ✅ Complete

---

## SECTION 2: LEFT PANEL (DEAL SNAPSHOT)

| Figma Element | Existing PBK ID/Function | Decision |
|---------------|-------------------------|----------|
| **Property Info Block** |
| Address Line | `LeftPanel.tsx` → `{deal.address}` | ✅ KEEP |
| Type Badge | `LeftPanel.tsx` → `{deal.type}` (house/land) | ✅ KEEP |
| List Price | `LeftPanel.tsx` → `formatCurrency(deal.price)` | ✅ KEEP |
| Beds/Baths/SF | `LeftPanel.tsx` → `{deal.beds} / {deal.baths}` | ✅ KEEP |
| Year Built | `LeftPanel.tsx` → `{deal.year}` | ✅ KEEP |
| Days on Market | `LeftPanel.tsx` → `{deal.dom}` | ✅ KEEP |
| **Valuations Block** |
| ARV | `LeftPanel.tsx` → `formatCurrency(deal.arv)` | ✅ KEEP 🔒 |
| MAO 60% | `LeftPanel.tsx` → `formatCurrency(deal.mao60)` | ✅ KEEP 🔒 |
| MAO RBP | `LeftPanel.tsx` → `formatCurrency(deal.maoRBP)` | ✅ KEEP 🔒 |
| MAO+Rep | `LeftPanel.tsx` → `formatCurrency(mao60 + repairs.mid)` | ✅ KEEP (enhancement) |
| **Repairs Block** |
| Low Estimate | `LeftPanel.tsx` → `formatCurrency(deal.repairs.low)` | ✅ KEEP |
| Mid Estimate | `LeftPanel.tsx` → `formatCurrency(deal.repairs.mid)` | ✅ KEEP |
| High Estimate | `LeftPanel.tsx` → `formatCurrency(deal.repairs.high)` | ✅ KEEP |
| Condition Badge | `LeftPanel.tsx` → `{deal.repairs.condition}` (C3-C6) | ✅ KEEP |
| **Profit Block** |
| Assignment Fee | `LeftPanel.tsx` → `formatCurrency(deal.fee)` | ✅ KEEP |
| Potential Profit | `LeftPanel.tsx` → `formatCurrency(maoRBP - price)` | ✅ KEEP 🔒 |
| **Financing Block** |
| Mortgage Balance | `LeftPanel.tsx` → `formatCurrency(deal.balance)` | ✅ KEEP |
| Interest Rate | `LeftPanel.tsx` → `{deal.rate}%` | ✅ KEEP |
| Monthly Payment | `LeftPanel.tsx` → `formatCurrency(monthlyPayment)` | ✅ KEEP 🔒 |
| Monthly Rent | `LeftPanel.tsx` → `formatCurrency(deal.rent)` | ✅ KEEP |

**Section Status:** ✅ Complete

---

## SECTION 3: ANALYZER TAB - HOUSE MODE

| Figma Element | Existing PBK ID/Function | Decision |
|---------------|-------------------------|----------|
| **House/Land Toggle** | `AnalyzerTab.tsx` → Tab system | ✅ KEEP |
| **Step 1: Property Details** |
| Property Address Input | `AnalyzerTab.tsx` → `<input value={deal.address}>` | ✅ KEEP |
| Property Type Dropdown | `AnalyzerTab.tsx` → `<select value={deal.type}>` | ✅ KEEP |
| Contact Type (Owner/Agent) | `AnalyzerTab.tsx` → `<select value={deal.contact}>` | ✅ KEEP |
| List Price Input | `AnalyzerTab.tsx` → `<input type="number" value={deal.price}>` | ✅ KEEP |
| Beds Input | `AnalyzerTab.tsx` → `<input type="number" value={deal.beds}>` | ✅ KEEP |
| Baths Input | `AnalyzerTab.tsx` → `<input type="number" value={deal.baths}>` | ✅ KEEP |
| Square Feet Input | `AnalyzerTab.tsx` → `<input type="number" value={deal.sqft}>` | ✅ KEEP |
| Year Built Input | `AnalyzerTab.tsx` → `<input type="number" value={deal.year}>` | ✅ KEEP |
| Days on Market Input | `AnalyzerTab.tsx` → `<input type="number" value={deal.dom}>` | ✅ KEEP |
| **Step 2: Comparable Sales** |
| Comp A Address | `AnalyzerTab.tsx` → `<input value={deal.comps.A.address}>` | ✅ KEEP |
| Comp A Price | `AnalyzerTab.tsx` → `<input value={deal.comps.A.price}>` | ✅ KEEP |
| Comp A Date | `AnalyzerTab.tsx` → `<input value={deal.comps.A.date}>` | ✅ KEEP |
| Comp A Link | `AnalyzerTab.tsx` → `<input value={deal.comps.A.link}>` | ✅ KEEP |
| (Same for Comp B) | `AnalyzerTab.tsx` → `deal.comps.B.*` | ✅ KEEP |
| (Same for Comp C) | `AnalyzerTab.tsx` → `deal.comps.C.*` | ✅ KEEP |
| ARV Display | `AnalyzerTab.tsx` → Calculated, displayed in panel | ✅ KEEP 🔒 |
| **Step 3: Repair Estimate** |
| Repair Calculator | `RepairCalculator.tsx` → Clickable labels | ✅ KEEP |
| Low Estimate | `RepairCalculator.tsx` → `{deal.repairs.low}` | ✅ KEEP |
| Mid Estimate | `RepairCalculator.tsx` → `{deal.repairs.mid}` | ✅ KEEP |
| High Estimate | `RepairCalculator.tsx` → `{deal.repairs.high}` | ✅ KEEP |
| Condition Output | `RepairCalculator.tsx` → Auto-calculated | ✅ KEEP |
| **Step 4: Financing** |
| Mortgage Balance | `AnalyzerTab.tsx` → `<input value={deal.balance}>` | ✅ KEEP |
| Interest Rate | `AnalyzerTab.tsx` → `<input value={deal.rate}>` | ✅ KEEP |
| Rent Estimate | `AnalyzerTab.tsx` → `<input value={deal.rent}>` | ✅ KEEP |
| Assignment Fee | `AnalyzerTab.tsx` → `<input value={deal.fee}>` | ✅ KEEP |

**Section Status:** ✅ Complete

---

## SECTION 4: ANALYZER TAB - LAND MODE

| Figma Element | Existing PBK ID/Function | Decision |
|---------------|-------------------------|----------|
| House/Land Toggle | `AnalyzerTab.tsx` → Same toggle as above | ✅ KEEP |
| Builder Price (¼ acre) | `LandAnalysis.tsx` → `<input value={deal.builderPrice}>` | ✅ KEEP |
| Builder Price (sq ft) | HTML: `l-price-sqft` | ❌ ADD (Phase 3) |
| Input Mode Toggle | Not in current React | ❌ ADD (Phase 3) |
| Lot Size (acres) | `LandAnalysis.tsx` → `<input value={deal.lotSize}>` | ✅ KEEP |
| Lot Size (sq ft) | Not in current React | ❌ ADD (Phase 3) |
| Builder Total Display | `LandAnalysis.tsx` → Calculated `builderTotal` | ✅ KEEP 🔒 |
| Units Display | `LandAnalysis.tsx` → `{units.toFixed(2)} units` | ✅ KEEP 🔒 |
| Your Offer Input | `LandAnalysis.tsx` → `<input value={deal.offer}>` | ✅ KEEP |
| Auto-Calculate Offer | `LandAnalysis.tsx` → `calculateLandOffer()` | ✅ KEEP 🔒 |
| Target Zip Code | `LandAnalysis.tsx` → `<input value={deal.zipCode}>` | ✅ KEEP |
| Deal Analysis Panel | `LandAnalysis.tsx` → Visual display | ✅ KEEP |
| Spread Display | `LandAnalysis.tsx` → `builderTotal - offer` | ✅ KEEP 🔒 |
| Spread % Display | `LandAnalysis.tsx` → Calculated percentage | ✅ KEEP 🔒 |
| Verdict Visual | `LandAnalysis.tsx` → Green/Yellow/Red based on % | ✅ KEEP |
| Strategy Tips Panel | `LandAnalysis.tsx` → Visual display | ✅ KEEP |

**Section Status:** ⚠️ Missing sq ft input mode (non-critical)

---

## SECTION 5: STRATEGY SELECTOR / PATH CARDS

| Figma Element | Existing PBK ID/Function | Decision |
|---------------|-------------------------|----------|
| Cash Wholesale Card | `StrategySelector.tsx` → Path option with icon | ✅ KEEP |
| Creative Finance Card | `StrategySelector.tsx` → Path option with icon | ✅ KEEP |
| Subject-To Card | `StrategySelector.tsx` → Path option with icon | ✅ KEEP |
| RBP Card | `StrategySelector.tsx` → Path option with icon | ✅ KEEP |
| Land Assignment Card | `StrategySelector.tsx` → Path option with icon | ✅ KEEP |
| Down Payment Display | `StrategySelector.tsx` → Per-path calculation | ✅ KEEP 🔒 |
| Monthly Payment Display | `StrategySelector.tsx` → Per-path calculation | ✅ KEEP 🔒 |
| Path Badges | `StrategySelector.tsx` → "FAST CASH", "SELLER TERMS", etc | ✅ KEEP |
| Comparison Table | `StrategySelector.tsx` → Matrix view (enhancement) | ✅ KEEP |
| Underwriting Rules | `StrategySelector.tsx` → Per-path rules (enhancement) | ✅ KEEP |
| Select Button | `StrategySelector.tsx` → Sets active path | ✅ KEEP |

**Section Status:** ✅ Complete (better than HTML)

---

## SECTION 6: CALL MODE TAB - SCRIPTS

| Figma Element | Existing PBK ID/Function | Decision |
|---------------|-------------------------|----------|
| Path Selector Tabs | `CallModeTab.tsx` → 5-tab system | ✅ KEEP (better than HTML) |
| Owner/Agent Toggle | HTML: implicit, React: missing | ❌ ADD (Phase 2) |
| Opening Script Card | `CallModeTab.tsx` → `pathScripts[path].opening` | ✅ KEEP |
| Acquisition Script Card | `CallModeTab.tsx` → `pathScripts[path].acquisition` | ✅ KEEP |
| Closing Script Card | `CallModeTab.tsx` → `pathScripts[path].closing` | ✅ KEEP |
| Expand/Collapse Toggle | `CallModeTab.tsx` → Accordion system | ✅ KEEP |
| Bracket Replacement | `CallModeTab.tsx` → `[field]` → actual values | ✅ KEEP |
| Download Button (per script) | `CallModeTab.tsx` → `downloadTextFile()` | ✅ KEEP |
| Copy Button | Not in current React | 🔄 ADD (optional enhancement) |
| Path Color Coding | `CallModeTab.tsx` → Color per path | ✅ KEEP |

**Section Status:** ⚠️ Need owner/agent variants

---

## SECTION 7: CALL MODE TAB - LIVE CALL INPUTS

| Figma Element | Existing PBK ID/Function | Decision |
|---------------|-------------------------|----------|
| **Universal Fields (Always Visible)** |
| Path Badge Display | `LiveCallInputs.tsx` → Shows active path | ✅ KEEP |
| Seller Name | `LiveCallInputs.tsx` → `<input value={deal.sellerName}>` | ✅ KEEP |
| Seller Email | `LiveCallInputs.tsx` → `<input value={deal.sellerEmail}>` | ✅ KEEP |
| Seller Phone | `LiveCallInputs.tsx` → `<input value={deal.sellerPhone}>` | ✅ KEEP |
| Agreed Offer Price | `LiveCallInputs.tsx` → `<input value={deal.price}>` | ✅ KEEP |
| Close Timeline | `LiveCallInputs.tsx` → `<select value={deal.timeline}>` | ✅ KEEP |
| Earnest Deposit | `LiveCallInputs.tsx` → `<input value={deal.earnestDeposit}>` | ✅ KEEP |
| Notes | HTML: `li-notes`, React: missing | ❌ ADD (Phase 1) |
| **Creative Finance Fields (path = 'creative_finance')** |
| Down Payment | `LiveCallInputs.tsx` → `<input value={deal.cfDownPayment}>` | ✅ KEEP |
| Interest Rate | `LiveCallInputs.tsx` → `<input value={deal.cfRate}>` | ✅ KEEP |
| Term (years) | `LiveCallInputs.tsx` → `<select value={deal.cfTerm}>` | ✅ KEEP |
| CF Type | HTML: `li-cf-type` (Carry/SubTo/Wrap), React: missing | ❌ ADD (Phase 1) |
| **Mortgage Takeover Fields (path = 'subject_to')** |
| Upfront Cash | HTML: `li-upfront`, React: missing | ❌ ADD (Phase 1) |
| Loan Balance Confirm | HTML: `li-balconf`, React: missing | ❌ ADD (Phase 1) |
| Existing Rate Confirm | HTML: `li-rateconf`, React: missing | ❌ ADD (Phase 1) |
| MT Type | HTML: `li-mt-type` (SubTo/Assume/Carry-Gap), React: missing | ❌ ADD (Phase 1) |
| **RBP Fields (path = 'rbp')** |
| RBP Price Confirm | HTML: `li-rbpconf`, React: missing | ❌ ADD (Phase 1) |
| Buyer Type | HTML: `li-buyertype`, React: missing | ❌ ADD (Phase 1) |
| Seller Costs | HTML: `li-sellercosts`, React: missing | ❌ ADD (Phase 1) |
| Earnest Terms (RBP) | Merged with universal earnest | ✅ KEEP |
| Cash Alternative | HTML: `li-cashalt`, React: missing | ❌ ADD (Phase 1) |
| **Cash Wholesale Fields (path = 'cash')** |
| As-Is Terms | HTML: `li-asis`, React: missing | ❌ ADD (Phase 1) |
| Close Period | HTML: `li-cashclose`, React: missing | ❌ ADD (Phase 1) |
| Earnest (Cash) | Merged with universal earnest | ✅ KEEP |
| **Land Fields (path = 'land')** |
| Lot Size Confirm | HTML: `li-szconf`, React: missing | ❌ ADD (Phase 1) |
| Buyer Type (Land) | HTML: `li-lbt`, React: missing | ❌ ADD (Phase 1) |
| Seller Costs (Land) | HTML: `li-lsc`, React: missing | ❌ ADD (Phase 1) |
| **Additional Fields** |
| Reductions | HTML: `li-reductions`, React: missing | ❌ ADD (Phase 1) |
| Vacant Status | HTML: `li-vacant`, React: missing | ❌ ADD (Phase 1) |
| Confirmation Block | HTML: `li-confirm-block`, React: missing | ❌ ADD (Phase 1) |

**Section Status:** 🔴 CRITICAL - Many fields missing (Phase 1 priority)

---

## SECTION 8: DOCUMENTS TAB

| Figma Element | Existing PBK ID/Function | Decision |
|---------------|-------------------------|----------|
| Path Detection | `PathDeliverables.tsx` → Detects active path | ✅ KEEP |
| LOI Template | `PathDeliverables.tsx` → `generateLOI(deal, path)` | ✅ KEEP |
| Seller Guide Template | `PathDeliverables.tsx` → `generateSellerGuide(deal, path)` | ✅ KEEP |
| Preview Panel | `PathDeliverables.tsx` → Live text preview | ✅ KEEP |
| Download LOI Button | `PathDeliverables.tsx` → `downloadTextFile()` | ✅ KEEP |
| Download SG Button | `PathDeliverables.tsx` → `downloadTextFile()` | ✅ KEEP |
| Generate PDF Button | `PDFExporter.tsx` → `generatePDF(deal)` | ✅ KEEP |
| PDF Preview | `PDFExporter.tsx` → jsPDF output | ✅ KEEP |
| Print Button | `PDFExporter.tsx` → `window.print()` | ✅ KEEP |
| Field Population | Template system → All `{deal.field}` values | 🔄 VERIFY (Phase 4) |
| Path-Specific Sections | Template system → Conditional rendering | 🔄 VERIFY (Phase 4) |

**Section Status:** ⚠️ Need to verify new fields appear (Phase 4)

---

## SECTION 9: RIGHT PANEL (ACTIONS & STATS)

| Figma Element | Existing PBK ID/Function | Decision |
|---------------|-------------------------|----------|
| Actions Section Header | `RightPanel.tsx` → Visual section | ✅ KEEP |
| Quick Documents Section | `RightPanel.tsx` → Button group | ✅ KEEP |
| Generate LOI Button | `RightPanel.tsx` → Links to PathDeliverables | ✅ KEEP |
| Generate Seller Guide Button | `RightPanel.tsx` → Links to PathDeliverables | ✅ KEEP |
| Generate PDF Button | `RightPanel.tsx` → Links to PDFExporter | ✅ KEEP |
| Quick Stats Section | `RightPanel.tsx` → Calculated displays | ✅ KEEP |
| Spread Under RBP | `RightPanel.tsx` → `maoRBP - price` | ✅ KEEP 🔒 |
| Spread % | `RightPanel.tsx` → Calculated percentage | ✅ KEEP 🔒 |
| Scripts Section | REMOVED (moved to CallModeTab) | ✅ CORRECT |

**Section Status:** ✅ Complete (correctly streamlined)

---

## SECTION 10: INVESTOR YIELD (ADVANCED)

| Figma Element | Existing PBK ID/Function | Decision |
|---------------|-------------------------|----------|
| Strategy Toggle | `InvestorYield.tsx` → Wholesale/FF/BRRRR tabs | ✅ KEEP |
| Wholesale ROI | `InvestorYield.tsx` → `calculateInvestorMetrics.wholesale()` | ✅ KEEP 🔒 |
| Profit Display | `InvestorYield.tsx` → Calculated from fee | ✅ KEEP 🔒 |
| ROI % Display | `InvestorYield.tsx` → `(profit / investment) * 100` | ✅ KEEP 🔒 |
| Fix & Flip Inputs | `InvestorYield.tsx` → Hold months, costs, etc | ✅ KEEP |
| Fix & Flip Profit | `InvestorYield.tsx` → `calculateInvestorMetrics.fixFlip()` | ✅ KEEP 🔒 |
| Annualized ROI | `InvestorYield.tsx` → Time-adjusted return | ✅ KEEP 🔒 |
| BRRRR Inputs | `InvestorYield.tsx` → Refinance assumptions | ✅ KEEP |
| BRRRR Cash Flow | `InvestorYield.tsx` → `calculateInvestorMetrics.brrrr()` | ✅ KEEP 🔒 |
| Cash-on-Cash % | `InvestorYield.tsx` → Calculated CoC | ✅ KEEP 🔒 |

**Section Status:** ✅ Complete

---

## SECTION 11: CRM / TRACKER TAB

| Figma Element | Existing PBK ID/Function | Decision |
|---------------|-------------------------|----------|
| Deal Scoring Component | `DealScoring.tsx` → Full component | ✅ KEEP (enhancement) |
| Motivation Score Slider | `DealScoring.tsx` → 1-5 scale | ✅ KEEP |
| Motivation Level Display | `DealScoring.tsx` → Text label | ✅ KEEP |
| Pipeline Stages | `CRMFeatures.tsx` → Stage tracking | ✅ KEEP (enhancement) |
| Deal History | `CRMFeatures.tsx` → Historical tracking | ✅ KEEP (enhancement) |
| Notes Section | `CRMFeatures.tsx` → Free text | ✅ KEEP |

**Section Status:** ✅ Complete (enhanced beyond HTML)

---

## CALCULATION ENGINE (NEVER TOUCH)

| Formula | HTML Function | React Function | Decision |
|---------|---------------|----------------|----------|
| ARV | `calcARV()` | `calculateARV(comps)` | 🔒 LOCKED ✅ |
| MAO 60% | `mao60 = arv*0.6 - fee` | `calculateMAO.wholesale(arv, fee)` | 🔒 LOCKED ✅ |
| MAO RBP | `maorbp = arv*0.88` | `calculateMAO.rbp(arv)` | 🔒 LOCKED ✅ |
| MAO After Repairs | `maoar = arv*0.65 - repairs - fee` | `calculateMAO.afterRepairs(arv, rep, fee)` | 🔒 LOCKED ✅ |
| Verdict | `if price <= maoRBP...` | `calculateVerdict(price, arv, maoRBP)` | 🔒 LOCKED ✅ |
| Monthly Payment | `PITI with 80% LTV` | `calculateMonthlyPayment(bal, rate, years, 80)` | 🔒 LOCKED ✅ |
| Land Offer | `if total > 50K ? 8K : ...` | `calculateLandOffer(builderTotal)` | 🔒 LOCKED ✅ |
| Wholesale ROI | `(fee / price) * 100` | `calculateInvestorMetrics.wholesale()` | 🔒 LOCKED ✅ |
| Fix & Flip ROI | Complex multi-step | `calculateInvestorMetrics.fixFlip()` | 🔒 LOCKED ✅ |
| BRRRR CoC | Complex refinance calc | `calculateInvestorMetrics.brrrr()` | 🔒 LOCKED ✅ |

**Formula Status:** 🔒 ALL LOCKED - Audited 2026-04-16 - DO NOT MODIFY

---

## IMPLEMENTATION PRIORITY MATRIX

| Section | Status | Priority | Phase | Hours |
|---------|--------|----------|-------|-------|
| Top Bar | ✅ Complete | - | - | 0 |
| Left Panel | ✅ Complete | - | - | 0 |
| Right Panel | ✅ Complete | - | - | 0 |
| Analyzer (House) | ✅ Complete | - | - | 0 |
| Analyzer (Land) | ⚠️ Missing sq ft | LOW | 3 | 1-2 |
| Strategy Selector | ✅ Complete | - | - | 0 |
| Call Mode Scripts | ⚠️ Need variants | MEDIUM | 2 | 2-3 |
| **Live Call Inputs** | 🔴 **Incomplete** | **HIGH** | **1** | **2-3** |
| Documents | ⚠️ Need verification | MEDIUM | 4 | 2-3 |
| Investor Yield | ✅ Complete | - | - | 0 |
| CRM/Tracker | ✅ Complete | - | - | 0 |
| **Formulas** | ✅ **Locked** | **PROTECTED** | **-** | **0** |

---

## QUICK REFERENCE: WHAT'S MISSING

### 🔴 HIGH PRIORITY (Phase 1)
```
LiveCallInputs.tsx needs:
├── Creative Finance Type dropdown
├── Mortgage Takeover fields (upfront, balance, rate, type)
├── RBP fields (price confirm, buyer type, costs, cash alt)
├── Cash fields (as-is terms, close period)
├── Land fields (lot confirm, buyer type, costs)
├── Universal: Notes textarea
├── Universal: Reductions input
├── Universal: Vacant status
└── Confirmation summary block
```

### ⚠️ MEDIUM PRIORITY (Phase 2 & 4)
```
CallModeTab.tsx needs:
└── Owner/Agent script toggle + variants

PathDeliverables.tsx needs:
└── Verification that new fields appear in docs

PDFExporter.tsx needs:
└── Verification that new fields appear in PDF
```

### 🟡 LOW PRIORITY (Phase 3)
```
LandAnalysis.tsx needs:
├── Square footage input mode
└── Acre ↔ sq ft conversion
```

---

## FINAL CHECKLIST BEFORE MIGRATION

- [x] Formula audit complete (`FORMULA_AUDIT.md`)
- [x] All formulas match HTML exactly
- [x] Calculation functions centralized (`dealCalculations.ts`)
- [x] TypeScript types defined (`types.ts`)
- [x] Existing components mapped to HTML IDs
- [x] Migration phases defined
- [x] Testing strategy documented
- [x] Rollback plan established
- [ ] Git branch created for Phase 1
- [ ] Phase 1 implementation (LiveCallInputs)
- [ ] Phase 2 implementation (Script variants)
- [ ] Phase 3 implementation (Land sq ft)
- [ ] Phase 4 verification (Documents)
- [ ] Phase 5 testing (End-to-end)

---

## NEXT ACTION

```bash
# Create Phase 1 branch
git checkout -b phase1-live-call-inputs

# Open the key files
code src/app/types.ts
code src/app/components/LiveCallInputs.tsx

# Reference docs
code PBK_MIGRATION_CHECKLIST.md
code PBK_FIELD_MAPPING.md
```

**Start with:** Add missing type definitions, then update LiveCallInputs component with path-conditional fields.

---

**Blueprint Version:** 1.0  
**Created:** 2026-04-16  
**Status:** Ready for implementation  
**Estimated Total Time:** ~15 hours across 5 phases
