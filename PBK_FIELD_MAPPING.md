# PBK Command Center - Field Mapping Document

## Overview
This document maps Original PBK HTML field IDs to Current React Components with Keep/Wrap/Replace decisions.

**Status Date:** 2026-04-16  
**React Version:** Current Implementation  
**HTML Version:** v2.0.0 (PBK_Command_Center_v5.html)

---

## 1. TOP BAR SECTION

| Figma Element | Original PBK ID | React Component | React Field | Decision | Notes |
|--------------|----------------|-----------------|-------------|----------|-------|
| Logo | `.tb-logo` | `TopBar.tsx` | Static text | **KEEP** | Working correctly |
| Property Address | `.tb-addr` | `TopBar.tsx` | `deal.address` | **KEEP** | Syncs with analyzer |
| Verdict Badge | `#vbadge` | `TopBar.tsx` | `deal.verdict` | **KEEP** | Auto-calculates from MAO/RBP |
| Actions Menu | `.tb-btn` | `TopBar.tsx` | Button group | **KEEP** | Print, Save, Clear working |
| Dark Mode Toggle | Custom | `TopBar.tsx` | `darkMode` state | **KEEP** | React-only feature (good addition) |

**Status:** ✅ Complete - No migration needed

---

## 2. LEFT PANEL - DEAL SNAPSHOT

| Figma Element | Original PBK ID | React Component | React Field | Decision | Notes |
|--------------|----------------|-----------------|-------------|----------|-------|
| **Property Info** |
| Address | Computed from analyzer | `LeftPanel.tsx` | `deal.address` | **KEEP** | Auto-populated |
| Type | Computed | `LeftPanel.tsx` | `deal.type` | **KEEP** | house/land switch |
| List Price | `a-price` | `LeftPanel.tsx` | `deal.price` | **KEEP** | From analyzer |
| Beds/Baths | `a-bed`, `a-bath` | `LeftPanel.tsx` | `deal.beds`, `deal.baths` | **KEEP** | Display only |
| Sq Ft | `a-sf` | `LeftPanel.tsx` | `deal.sqft` | **KEEP** | Display only |
| Year Built | `a-yr` | `LeftPanel.tsx` | `deal.year` | **KEEP** | Display only |
| DOM | `a-dom` | `LeftPanel.tsx` | `deal.dom` | **KEEP** | Display only |
| **Valuations** |
| ARV | Calculated | `LeftPanel.tsx` | `deal.arv` | **KEEP** | ✅ Formula locked |
| MAO 60% | Calculated | `LeftPanel.tsx` | `deal.mao60` | **KEEP** | ✅ Formula locked (ARV×60%-fee) |
| MAO RBP | Calculated | `LeftPanel.tsx` | `deal.maoRBP` | **KEEP** | ✅ Formula locked (ARV×88%) |
| MAO+Rep | NEW | `LeftPanel.tsx` | `mao60 + repairs.mid` | **KEEP** | Enhanced feature |
| **Repairs** |
| Low | `rep-low` | `LeftPanel.tsx` | `deal.repairs.low` | **KEEP** | From RepairCalculator |
| Mid | `rep-mid` | `LeftPanel.tsx` | `deal.repairs.mid` | **KEEP** | Used in formulas |
| High | `rep-high` | `LeftPanel.tsx` | `deal.repairs.high` | **KEEP** | Range display |
| Condition | Calculated | `LeftPanel.tsx` | `deal.repairs.condition` | **KEEP** | C3-C6 badges |
| **Profit Estimate** |
| Assign Fee | `fee` | `LeftPanel.tsx` | `deal.fee` | **KEEP** | Default 8000 |
| Potential Profit | Calculated | `LeftPanel.tsx` | `maoRBP - price` | **KEEP** | Green highlight box |
| **Financing** |
| Mortgage Balance | `a-bal` | `LeftPanel.tsx` | `deal.balance` | **KEEP** | For SubTo/MT |
| Interest Rate | `a-rate` | `LeftPanel.tsx` | `deal.rate` | **KEEP** | For monthly calc |
| Monthly Payment | Calculated | `LeftPanel.tsx` | `calculateMonthlyPayment()` | **KEEP** | ✅ Formula locked (80% LTV) |
| Monthly Rent | `a-rent` | `LeftPanel.tsx` | `deal.rent` | **KEEP** | For cashflow |

**Status:** ✅ Complete - All formulas locked and matching HTML exactly

---

## 3. ANALYZER TAB - MAIN INPUT AREA

| Figma Element | Original PBK ID | React Component | React Field | Decision | Notes |
|--------------|----------------|-----------------|-------------|----------|-------|
| **House vs Land Toggle** | Tab system | `AnalyzerTab.tsx` | `deal.type` | **KEEP** | Clean implementation |
| **Step 1: Property Details** |
| Address | `a-addr` | `AnalyzerTab.tsx` | `deal.address` | **KEEP** | Syncs to top bar |
| Property Type | `a-type` | `AnalyzerTab.tsx` | `deal.type` | **KEEP** | house/condo/land |
| Contact Type | `a-contact` | `AnalyzerTab.tsx` | `deal.contact` | **KEEP** | owner/agent |
| List Price | `a-price` | `AnalyzerTab.tsx` | `deal.price` | **KEEP** | Required field |
| Beds | `a-bed` | `AnalyzerTab.tsx` | `deal.beds` | **KEEP** | Number input |
| Baths | `a-bath` | `AnalyzerTab.tsx` | `deal.baths` | **KEEP** | Number input |
| Sq Ft | `a-sf` | `AnalyzerTab.tsx` | `deal.sqft` | **KEEP** | Number input |
| Year Built | `a-yr` | `AnalyzerTab.tsx` | `deal.year` | **KEEP** | Number input |
| Days on Market | `a-dom` | `AnalyzerTab.tsx` | `deal.dom` | **KEEP** | Number input |
| **Step 2: Comps** |
| Comp A Address | `c-addr-A` | `AnalyzerTab.tsx` | `deal.comps.A.address` | **KEEP** | ARV calculation input |
| Comp A Price | `c-price-A` | `AnalyzerTab.tsx` | `deal.comps.A.price` | **KEEP** | ARV calculation input |
| Comp A Date | `c-date-A` | `AnalyzerTab.tsx` | `deal.comps.A.date` | **KEEP** | Documentation |
| Comp A Link | `c-link-A` | `AnalyzerTab.tsx` | `deal.comps.A.link` | **KEEP** | MLS reference |
| (Same for B, C) | `c-*-B`, `c-*-C` | `AnalyzerTab.tsx` | `deal.comps.B/C.*` | **KEEP** | Complete comp system |
| **Step 3: Repairs** |
| Repair Estimator | Inline component | `RepairCalculator.tsx` | `deal.repairs.*` | **KEEP** | Clickable labels system |
| **Step 4: Financing** |
| Mortgage Balance | `a-bal` | `AnalyzerTab.tsx` | `deal.balance` | **KEEP** | For SubTo |
| Interest Rate | `a-rate` | `AnalyzerTab.tsx` | `deal.rate` | **KEEP** | For monthly calc |
| Rent Estimate | `a-rent` | `AnalyzerTab.tsx` | `deal.rent` | **KEEP** | For cashflow |
| Assignment Fee | `a-fee` | `AnalyzerTab.tsx` | `deal.fee` | **KEEP** | Default 8000, used in MAO |

**Status:** ✅ Complete - All inputs preserved

---

## 4. ANALYZER TAB - LAND MODE

| Figma Element | Original PBK ID | React Component | React Field | Decision | Notes |
|--------------|----------------|-----------------|-------------|----------|-------|
| Builder Price (¼ acre) | `l-bp` | `LandAnalysis.tsx` | `deal.builderPrice` | **KEEP** | Per 0.25 acre unit |
| Builder Price (sq ft) | `l-price-sqft` | ❌ MISSING | N/A | **ADD** | Alternative input method |
| Lot Size | `l-sz` | `LandAnalysis.tsx` | `deal.lotSize` | **KEEP** | String with units |
| Builder Total | `l-bp-total`, `l-bp-calc` | `LandAnalysis.tsx` | Calculated | **KEEP** | ✅ Quarter-acre formula |
| Your Offer | `l-off` | `LandAnalysis.tsx` | `deal.offer` | **KEEP** | ✅ Dynamic spread (8K/6.5K/5.5K) |
| Target Zip | `l-zip` | `LandAnalysis.tsx` | `deal.zipCode` | **KEEP** | For land searches |
| Deal Analysis Panel | Visual only | `LandAnalysis.tsx` | Computed | **KEEP** | Spread % and verdict |

**Status:** ⚠️ Missing sq ft input option - consider adding

---

## 5. CALL MODE TAB - SCRIPTS

| Figma Element | Original PBK ID | React Component | React Field | Decision | Notes |
|--------------|----------------|-----------------|-------------|----------|-------|
| Path Selector Tabs | NEW system | `CallModeTab.tsx` | `selectedPath` state | **KEEP** | ✅ Better than HTML |
| Opening Script | `cm-opening-panel` | `CallModeTab.tsx` | `pathScripts[path].opening` | **KEEP** | Path-specific |
| Acquisition Script | `cm-script`, `cm-full-panel` | `CallModeTab.tsx` | `pathScripts[path].acquisition` | **KEEP** | Path-specific |
| Closing Script | NEW | `CallModeTab.tsx` | `pathScripts[path].closing` | **KEEP** | Enhancement |
| Script Cards | NEW UI | `CallModeTab.tsx` | Expandable cards | **KEEP** | Better UX than HTML |
| Download Button | NEW | `CallModeTab.tsx` | Per-script download | **KEEP** | Enhancement |
| Agent Script | `cm-script-agent` | ❌ MISSING | N/A | **ADD** | Owner vs Agent variant |

**Paths Covered:**
- ✅ Cash Wholesale
- ✅ Creative Finance
- ✅ Mortgage Takeover (Subject-To)
- ✅ RBP
- ✅ Land/Builder Assignment

**Status:** ⚠️ Need to add owner vs agent script variants

---

## 6. CALL MODE TAB - LIVE CALL INPUTS

| Figma Element | Original PBK ID | React Component | React Field | Decision | Notes |
|--------------|----------------|-----------------|-------------|----------|-------|
| Path Tag Badge | `li-path-tag` | `LiveCallInputs.tsx` | Visual indicator | **KEEP** | Shows active path |
| **Universal Fields** |
| Seller Name | `li-name` | `LiveCallInputs.tsx` | `deal.sellerName` | **KEEP** | Required |
| Seller Email | `li-email` | `LiveCallInputs.tsx` | `deal.sellerEmail` | **KEEP** | Required |
| Seller Phone | `li-phone` | `LiveCallInputs.tsx` | `deal.sellerPhone` | **KEEP** | Required |
| Agreed Price | `li-price` | `LiveCallInputs.tsx` | `deal.price` | **KEEP** | Syncs with analyzer |
| Close Timeline | `li-tl` | `LiveCallInputs.tsx` | `deal.timeline` | **KEEP** | Dropdown |
| Earnest Deposit | `li-earnest-base` | `LiveCallInputs.tsx` | `deal.earnestDeposit` | **KEEP** | ✅ Recently added |
| Notes | `li-notes` | `LiveCallInputs.tsx` | (needs field) | **ADD** | Free text area |
| **Creative Finance Fields** |
| Down Payment | `li-dn` | `LiveCallInputs.tsx` | `deal.cfDownPayment` | **KEEP** | Path-conditional |
| Interest Rate | `li-rate` | `LiveCallInputs.tsx` | `deal.cfRate` | **KEEP** | Path-conditional |
| Term | `li-term` | `LiveCallInputs.tsx` | `deal.cfTerm` | **KEEP** | Path-conditional |
| Type | `li-cf-type` | ❌ MISSING | N/A | **ADD** | Carry/SubTo/Wrap |
| **Mortgage Takeover Fields** |
| Upfront Cash | `li-upfront` | ❌ MISSING | N/A | **ADD** | MT path only |
| Loan Balance | `li-balconf` | ❌ MISSING | N/A | **ADD** | Confirm existing balance |
| Existing Rate | `li-rateconf` | ❌ MISSING | N/A | **ADD** | Confirm existing rate |
| MT Type | `li-mt-type` | ❌ MISSING | N/A | **ADD** | SubTo/Assume/Carry-Gap |
| **RBP Fields** |
| RBP Price Confirm | `li-rbpconf` | ❌ MISSING | N/A | **ADD** | Buyer retail price |
| Buyer Type | `li-buyertype` | ❌ MISSING | N/A | **ADD** | Primary/Investor/etc |
| Seller Costs | `li-sellercosts` | ❌ MISSING | N/A | **ADD** | Text description |
| Earnest (RBP) | `li-earnest` | Merged with base | N/A | **KEEP** | Uses earnestDeposit |
| Cash Alternative | `li-cashalt` | ❌ MISSING | N/A | **ADD** | Backup offer |
| **Cash Wholesale Fields** |
| As-Is Terms | `li-asis` | ❌ MISSING | N/A | **ADD** | Yes/inspection |
| Close Period | `li-cashclose` | ❌ MISSING | N/A | **ADD** | 21/30/45 days |
| Earnest (Cash) | `li-cashernest` | Merged with base | N/A | **KEEP** | Uses earnestDeposit |
| **Land Fields** |
| Lot Size Confirm | `li-szconf` | ❌ MISSING | N/A | **ADD** | Confirm from analyzer |
| Buyer Type (Land) | `li-lbt` | ❌ MISSING | N/A | **ADD** | Builder/Developer |
| Seller Costs (Land) | `li-lsc` | ❌ MISSING | N/A | **ADD** | Text description |
| **Misc Fields** |
| Reductions | `li-reductions` | ❌ MISSING | N/A | **ADD** | Price adjustments |
| Vacant Status | `li-vacant` | ❌ MISSING | N/A | **ADD** | Occupancy status |
| Confirm Block | `li-confirm-block`, `li-confirm-list` | ❌ MISSING | N/A | **ADD** | Summary panel |

**Status:** ⚠️ **CRITICAL** - Many path-conditional fields missing

---

## 7. STRATEGY SELECTOR / PATH CARDS

| Figma Element | Original PBK ID | React Component | React Field | Decision | Notes |
|--------------|----------------|-----------------|-------------|----------|-------|
| Cash Wholesale Card | Path logic | `StrategySelector.tsx` | Path option | **KEEP** | ✅ Formula correct |
| Creative Finance Card | Path logic | `StrategySelector.tsx` | Path option | **KEEP** | ✅ 10% down, seller terms |
| Subject-To Card | Path logic | `StrategySelector.tsx` | Path option | **KEEP** | ✅ 3% down, debt relief |
| RBP Card | Path logic | `StrategySelector.tsx` | Path option | **KEEP** | ✅ 88% ARV |
| Land Assignment Card | Path logic | `StrategySelector.tsx` | Path option | **KEEP** | ✅ Builder assignment |
| Comparison Table | Visual | `StrategySelector.tsx` | Matrix view | **KEEP** | Excellent addition |
| Underwriting Rules | NEW | `StrategySelector.tsx` | Per-path rules | **KEEP** | Enhancement |

**Status:** ✅ Complete - Better than HTML implementation

---

## 8. DOCUMENTS TAB

| Figma Element | Original PBK ID | React Component | React Field | Decision | Notes |
|--------------|----------------|-----------------|-------------|----------|-------|
| LOI Generator | `doc-loi` section | `PathDeliverables.tsx` | Template system | **KEEP** | Path-specific templates |
| Seller Guide | `doc-sg` section | `PathDeliverables.tsx` | Template system | **KEEP** | Path-specific templates |
| Master Deal Package | PDF system | `PDFExporter.tsx` | Full PDF | **KEEP** | jsPDF implementation |
| Preview Panel | Visual | `PathDeliverables.tsx` | Live preview | **KEEP** | Shows current values |
| Download/Print | Actions | Both components | Export functions | **KEEP** | Working |

**Status:** ✅ Complete - Full document workflow preserved

---

## 9. RIGHT PANEL - ACTIONS & STATS

| Figma Element | Original PBK ID | React Component | React Field | Decision | Notes |
|--------------|----------------|-----------------|-------------|----------|-------|
| Actions Section | Visual | `RightPanel.tsx` | Button group | **KEEP** | Clean, organized |
| Quick Documents | Button group | `RightPanel.tsx` | Links to PathDeliverables | **KEEP** | Quick access |
| Quick Stats | Calculated panels | `RightPanel.tsx` | Display only | **KEEP** | Key metrics |
| Scripts Section | MOVED | ❌ REMOVED | N/A | **CORRECT** | Now in CallModeTab |

**Status:** ✅ Complete - Correctly streamlined

---

## 10. INVESTOR YIELD / ADVANCED

| Figma Element | Original PBK ID | React Component | React Field | Decision | Notes |
|--------------|----------------|-----------------|-------------|----------|-------|
| Investor Metrics | Calculation section | `InvestorYield.tsx` | Full component | **KEEP** | Wholesale/FF/BRRRR |
| Wholesale ROI | Calculated | `InvestorYield.tsx` | `calculateInvestorMetrics.wholesale()` | **KEEP** | Formula preserved |
| Fix & Flip | Calculated | `InvestorYield.tsx` | `calculateInvestorMetrics.fixFlip()` | **KEEP** | Formula preserved |
| BRRRR | Calculated | `InvestorYield.tsx` | `calculateInvestorMetrics.brrrr()` | **KEEP** | Formula preserved |

**Status:** ✅ Complete - All investor math preserved

---

## 11. CRM / TRACKER TAB

| Figma Element | Original PBK ID | React Component | React Field | Decision | Notes |
|--------------|----------------|-----------------|-------------|----------|-------|
| Deal Tracker | `tr-*` IDs | `CRMFeatures.tsx` | Full tracking | **KEEP** | Enhanced from HTML |
| Motivation Scoring | NEW | `DealScoring.tsx` | 1-5 scale | **KEEP** | Better than HTML |
| Pipeline Management | NEW | `CRMFeatures.tsx` | Stages | **KEEP** | Enhancement |

**Status:** ✅ Complete - Enhanced beyond HTML

---

## SUMMARY: MISSING CRITICAL FEATURES

### 🔴 HIGH PRIORITY - Missing from React

1. **Live Call Inputs - Path-Conditional Fields:**
   - Creative Finance Type dropdown (`li-cf-type`)
   - Mortgage Takeover fields (`li-upfront`, `li-balconf`, `li-rateconf`, `li-mt-type`)
   - RBP-specific fields (`li-rbpconf`, `li-buyertype`, `li-sellercosts`, `li-cashalt`)
   - Cash-specific fields (`li-asis`, `li-cashclose`)
   - Land-specific fields (`li-szconf`, `li-lbt`, `li-lsc`)
   - Reductions field (`li-reductions`)
   - Vacant status (`li-vacant`)
   - Confirmation summary block (`li-confirm-block`)

2. **Call Mode Scripts:**
   - Owner vs Agent script variants (`cm-script-agent`)

3. **Land Analysis:**
   - Square footage input option (`l-price-sqft`)

4. **General:**
   - Notes field in LiveCallInputs (`li-notes`)

### ✅ COMPLETE SECTIONS

- Top Bar
- Left Panel (Deal Snapshot)
- Analyzer Tab (House Mode)
- Strategy Selector
- Documents/PDF System
- Right Panel
- Investor Yield
- CRM/Tracker

### 🎯 MIGRATION PRIORITY

**Phase 1:** Add missing path-conditional Live Call Input fields  
**Phase 2:** Add owner/agent script variants to Call Mode  
**Phase 3:** Add land square footage input option  
**Phase 4:** Polish and testing

---

## FIELD NAMING CONVENTIONS

### Original PBK HTML
- `a-*` = Analyzer inputs
- `li-*` = Live Call Inputs
- `cm-*` = Call Mode
- `tr-*` = Tracker
- `doc-*` = Documents
- `l-*` = Land mode
- `c-*-[A/B/C]` = Comps

### React Implementation
- Uses descriptive names in `deal` object
- TypeScript interfaces ensure type safety
- Centralized in `types.ts`
- No hidden IDs needed

### Recommendation
- **Keep React's descriptive naming**
- Document the mapping (this file)
- Do NOT revert to HTML IDs
- HTML IDs are reference only

---

**Last Updated:** 2026-04-16  
**Author:** PBK Migration Team  
**Status:** Ready for Phase 1 implementation
