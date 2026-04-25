# PBK Command Center - Phased Migration Checklist

**Date:** 2026-04-16  
**Goal:** Migrate to new Figma-style layout while preserving 100% of PBK calculation engine

---

## MIGRATION PHILOSOPHY

> "Build the new UI as a shell that talks to the existing PBK engine."

### Core Principles
1. ✅ **NEVER touch locked formulas** (already completed 2026-04-16)
2. ✅ **Preserve all calculation functions** (already centralized in `dealCalculations.ts`)
3. ✅ **Keep path logic intact** (already implemented in `CallModeTab.tsx`)
4. ❌ **Do NOT rebuild logic inside new UI** (follow adapters pattern)
5. ✅ **Test formulas after each phase** (verify against HTML outputs)

---

## PRE-MIGRATION STATUS ✅

### Already Complete (No Migration Needed)
- [x] Formula layer locked and audited (`FORMULA_AUDIT.md`)
- [x] MAO Cash: `ARV × 60% - fee` (matches HTML)
- [x] MAO After Repairs: `ARV × 65% - repairs - fee` (matches HTML)
- [x] MAO RBP: `ARV × 88%` (matches HTML)
- [x] Land offer: Dynamic spread 8K/6.5K/5.5K (matches HTML)
- [x] Monthly payment: 80% LTV applied (matches HTML)
- [x] Top Bar component
- [x] Left Panel (Deal Snapshot)
- [x] Analyzer Tab (basic house mode)
- [x] Strategy Selector (5 paths)
- [x] Call Mode scripts (path-organized)
- [x] Documents/PDF system
- [x] Investor Yield calculations
- [x] CRM/Tracker features

---

## PHASE 1: ADD MISSING PATH-CONDITIONAL FIELDS

**Goal:** Complete Live Call Inputs with all path-specific fields  
**Timeline:** 2-3 hours  
**Risk:** Low (additive changes only)

### 1.1 Update Types (`src/app/types.ts`)

- [ ] Add Creative Finance fields:
  ```typescript
  cfType?: 'carry' | 'subto' | 'wrap';
  ```

- [ ] Add Mortgage Takeover fields:
  ```typescript
  mtUpfront?: number;
  mtBalanceConfirm?: number;
  mtRateConfirm?: number;
  mtType?: 'subto' | 'assume' | 'carry-gap';
  ```

- [ ] Add RBP fields:
  ```typescript
  rbpPriceConfirm?: number;
  rbpBuyerType?: string;
  rbpSellerCosts?: string;
  rbpCashAlternative?: number;
  ```

- [ ] Add Cash fields:
  ```typescript
  cashAsIs?: 'yes' | 'inspection';
  cashClosePeriod?: '21' | '30' | '45';
  ```

- [ ] Add Land fields:
  ```typescript
  landLotSizeConfirm?: string;
  landBuyerType?: string;
  landSellerCosts?: string;
  ```

- [ ] Add Universal fields:
  ```typescript
  notes?: string;
  reductions?: number;
  vacantStatus?: string;
  ```

### 1.2 Update LiveCallInputs Component (`src/app/components/LiveCallInputs.tsx`)

- [ ] Add Creative Finance section (shows when path = 'creative_finance'):
  - [ ] CF Type dropdown (Carry/SubTo/Wrap)
  - [ ] Sync with existing Down/Rate/Term fields

- [ ] Add Mortgage Takeover section (shows when path = 'subject_to'):
  - [ ] Upfront Cash input
  - [ ] Loan Balance Confirm input
  - [ ] Existing Rate Confirm input
  - [ ] MT Type dropdown (SubTo/Assume/Carry-Gap)

- [ ] Add RBP section (shows when path = 'rbp'):
  - [ ] RBP Price Confirm input
  - [ ] Buyer Type dropdown
  - [ ] Seller Costs textarea
  - [ ] Cash Alternative input

- [ ] Add Cash section (shows when path = 'cash'):
  - [ ] As-Is Terms dropdown
  - [ ] Close Period dropdown

- [ ] Add Land section (shows when path = 'land'):
  - [ ] Lot Size Confirm input
  - [ ] Buyer Type dropdown
  - [ ] Seller Costs textarea

- [ ] Add Universal fields (always visible):
  - [ ] Notes textarea (move from hidden)
  - [ ] Reductions input
  - [ ] Vacant Status dropdown

- [ ] Add Confirmation Summary Block:
  - [ ] Shows key deal points based on path
  - [ ] Auto-updates from inputs
  - [ ] Styled summary panel

### 1.3 Path Selection Logic

- [ ] Detect active path from StrategySelector or user selection
- [ ] Show/hide field sections based on path
- [ ] Validate required fields per path
- [ ] Update path badge/indicator

### 1.4 Testing

- [ ] Test each path shows correct fields
- [ ] Test field values save to deal state
- [ ] Test switching paths hides/shows correct sections
- [ ] Test confirmation block updates live
- [ ] Verify no formula changes (should be zero impact on calculations)

**Phase 1 Deliverable:** Complete Live Call Inputs with all path-specific fields matching HTML functionality

---

## PHASE 2: ENHANCE CALL MODE SCRIPTS

**Goal:** Add owner vs agent script variants  
**Timeline:** 2-3 hours  
**Risk:** Low (script templates only)

### 2.1 Update Script Templates (`src/app/templates/scripts.ts`)

- [ ] Split each path's scripts into owner/agent variants:
  ```typescript
  export const pathScripts = {
    cash: {
      owner: { opening: '...', acquisition: '...', closing: '...' },
      agent: { opening: '...', acquisition: '...', closing: '...' }
    },
    // ... repeat for all paths
  };
  ```

- [ ] Preserve existing owner scripts
- [ ] Create agent-specific scripts with professional tone
- [ ] Ensure all bracket-filled values `[field]` still populate

### 2.2 Update CallModeTab Component (`src/app/components/CallModeTab.tsx`)

- [ ] Add Owner/Agent toggle switch
- [ ] Store selection in component state
- [ ] Pass `deal.contact` as default (owner/agent from analyzer)
- [ ] Update script display to use selected variant
- [ ] Update download filename to include variant (e.g., `cash-wholesale-owner-opening.txt`)

### 2.3 Testing

- [ ] Test owner scripts display correctly
- [ ] Test agent scripts display correctly
- [ ] Test toggle switch works for all paths
- [ ] Test bracket values populate in both variants
- [ ] Test download includes correct variant name

**Phase 2 Deliverable:** Dual script system (owner/agent) for all 5 paths

---

## PHASE 3: POLISH LAND MODE

**Goal:** Add square footage input option  
**Timeline:** 1-2 hours  
**Risk:** Very Low (alternative input method)

### 3.1 Update LandAnalysis Component (`src/app/components/LandAnalysis.tsx`)

- [ ] Add input mode toggle (¼ acre vs sq ft)
- [ ] Add square footage input field:
  ```typescript
  landPriceSqFt?: number;
  landLotSizeSqFt?: number;
  ```

- [ ] Add sync functions:
  - [ ] `syncLandPriceFromSqft()` - converts sq ft price to ¼ acre price
  - [ ] `syncLandLotSize()` - converts acres ↔ sq ft

- [ ] Update UI to show both units with toggle
- [ ] Keep calculations using ¼ acre internally (no formula changes)

### 3.2 Update Types

- [ ] Add to `DealData`:
  ```typescript
  landInputMode?: 'quarter-acre' | 'sqft';
  landPriceSqFt?: number;
  landLotSizeSqFt?: number;
  ```

### 3.3 Testing

- [ ] Test ¼ acre input still works
- [ ] Test sq ft input calculates correctly
- [ ] Test switching modes preserves value
- [ ] Test final offer matches regardless of input mode
- [ ] Verify formulas unchanged (should be zero impact)

**Phase 3 Deliverable:** Dual input mode for land analysis (¼ acre / sq ft)

---

## PHASE 4: DOCUMENT WORKFLOW POLISH

**Goal:** Ensure all documents use live data correctly  
**Timeline:** 2-3 hours  
**Risk:** Low (verification and polish)

### 4.1 Verify Document Templates Use All New Fields

- [ ] Review `PathDeliverables.tsx` templates
- [ ] Ensure all new fields from Phase 1 appear in documents:
  - [ ] CF Type shows in Creative Finance LOI
  - [ ] MT fields show in Subject-To LOI
  - [ ] RBP fields show in RBP Seller Guide
  - [ ] Cash fields show in Cash Wholesale LOI
  - [ ] Land fields show in Land Assignment Agreement
  - [ ] Notes field shows in all documents

### 4.2 Update PDF Exporter (`src/app/components/PDFExporter.tsx`)

- [ ] Add new fields to PDF layout
- [ ] Test PDF generation includes all data
- [ ] Verify formatting and spacing
- [ ] Test print layout

### 4.3 Add Missing Document Types (if needed)

- [ ] Verify all HTML document types present:
  - [x] LOI (Letter of Intent)
  - [x] Seller Guide
  - [x] Master Deal Package (PDF)
  - [ ] Disclosure forms (if present in HTML)
  - [ ] Assignment agreements (verify complete)

### 4.4 Testing

- [ ] Generate LOI for each path with new fields
- [ ] Generate Seller Guide for each path
- [ ] Generate full PDF package
- [ ] Test print functionality
- [ ] Verify all bracket values populate
- [ ] Test download filenames correct

**Phase 4 Deliverable:** Complete document system with all fields integrated

---

## PHASE 5: FINAL POLISH & TESTING

**Goal:** System-wide verification and UX improvements  
**Timeline:** 3-4 hours  
**Risk:** Very Low (polish only)

### 5.1 End-to-End Testing by Path

For EACH path (Cash, CF, SubTo, RBP, Land):

- [ ] **Cash Wholesale Path:**
  - [ ] Enter property in Analyzer
  - [ ] Select Cash path in Strategy Selector
  - [ ] Fill Live Call Inputs (all cash fields)
  - [ ] Verify scripts populate correctly
  - [ ] Generate LOI
  - [ ] Generate PDF
  - [ ] Verify formulas: MAO 60%, fee $8K

- [ ] **Creative Finance Path:**
  - [ ] Enter property in Analyzer
  - [ ] Select CF path in Strategy Selector
  - [ ] Fill Live Call Inputs (down/rate/term/type)
  - [ ] Verify scripts populate correctly
  - [ ] Generate Seller Guide
  - [ ] Generate PDF
  - [ ] Verify formulas: 10% down calculation

- [ ] **Mortgage Takeover Path:**
  - [ ] Enter property in Analyzer
  - [ ] Select SubTo path in Strategy Selector
  - [ ] Fill Live Call Inputs (upfront/balance/rate/type)
  - [ ] Verify scripts populate correctly
  - [ ] Generate LOI
  - [ ] Generate PDF
  - [ ] Verify formulas: 3% down calculation

- [ ] **RBP Path:**
  - [ ] Enter property in Analyzer
  - [ ] Select RBP path in Strategy Selector
  - [ ] Fill Live Call Inputs (confirm price/buyer type/costs)
  - [ ] Verify scripts populate correctly
  - [ ] Generate Seller Guide
  - [ ] Generate PDF
  - [ ] Verify formulas: MAO RBP 88%

- [ ] **Land Path:**
  - [ ] Enter land in Analyzer (land mode)
  - [ ] Fill lot size and builder price
  - [ ] Select Land path in Strategy Selector
  - [ ] Fill Live Call Inputs (lot confirm/buyer type)
  - [ ] Verify scripts populate correctly
  - [ ] Generate Assignment Agreement
  - [ ] Generate PDF
  - [ ] Verify formulas: Dynamic spread (8K/6.5K/5.5K)

### 5.2 Cross-Feature Testing

- [ ] Test Dark Mode on all screens
- [ ] Test Left Panel updates live
- [ ] Test Top Bar verdict updates
- [ ] Test switching between paths
- [ ] Test localStorage persistence
- [ ] Test print functionality
- [ ] Test mobile responsiveness (if applicable)

### 5.3 Formula Verification (Against Original HTML)

Create test case with known values:
- [ ] ARV: $200,000
- [ ] Repairs: $20,000
- [ ] Fee: $8,000
- [ ] List Price: $160,000

Verify calculations match HTML:
- [ ] MAO 60%: $200K × 60% - $8K = $112,000 ✓
- [ ] MAO RBP: $200K × 88% = $176,000 ✓
- [ ] MAO AR: $200K × 65% - $20K - $8K = $102,000 ✓
- [ ] Verdict: $160K ≤ $176K = GREEN ✓

### 5.4 Performance & UX

- [ ] Test load time
- [ ] Test calculation speed
- [ ] Test input responsiveness
- [ ] Remove any console warnings
- [ ] Verify no broken links
- [ ] Check all icons display

### 5.5 Documentation

- [ ] Update README with new features
- [ ] Document path-conditional fields
- [ ] Update FORMULA_AUDIT.md status
- [ ] Create user guide (if needed)

**Phase 5 Deliverable:** Production-ready PBK Command Center with full feature parity

---

## ROLLBACK PLAN

If any phase fails or breaks formulas:

1. **Git is your friend:**
   ```bash
   git checkout HEAD~1  # Rollback one commit
   git checkout <commit-hash>  # Rollback to specific commit
   ```

2. **Formula verification:**
   - Keep `FORMULA_AUDIT.md` as reference
   - Test against known values after each phase
   - Never proceed if formulas don't match

3. **Component isolation:**
   - Each phase targets specific components
   - Easy to revert individual files
   - Keep old code commented during migration

---

## MIGRATION GATES (Do Not Proceed Unless...)

### Gate 1 → Phase 2
- [ ] All Phase 1 fields save correctly
- [ ] No TypeScript errors
- [ ] All paths show/hide correctly
- [ ] Formulas still match HTML

### Gate 2 → Phase 3
- [ ] Owner/agent scripts both work
- [ ] Toggle switch reliable
- [ ] Downloads work for both variants

### Gate 3 → Phase 4
- [ ] Sq ft input calculates correctly
- [ ] Acre ↔ sq ft conversion accurate
- [ ] Land offer formula unchanged

### Gate 4 → Phase 5
- [ ] All documents include new fields
- [ ] PDF generation works
- [ ] Print layout correct

### Gate 5 → Production
- [ ] All 5 paths tested end-to-end
- [ ] All formulas verified against HTML
- [ ] No console errors
- [ ] Dark mode works
- [ ] localStorage persists data

---

## SUCCESS CRITERIA

### Must Have (Production Blockers)
- ✅ All formulas match original HTML exactly
- ✅ All 5 acquisition paths functional
- ✅ All path-conditional fields present
- ✅ Scripts populate with live data
- ✅ Documents generate correctly
- ✅ PDF export works
- ✅ Data persists across sessions

### Should Have (Polish Items)
- Owner/agent script variants
- Land sq ft input mode
- Confirmation summary block
- Enhanced validation messages
- Mobile responsive layout

### Nice to Have (Future Enhancements)
- Supabase integration (multi-device sync)
- Team collaboration features
- Deal history/versioning
- Advanced analytics
- API integrations

---

## TIMELINE SUMMARY

| Phase | Duration | Cumulative | Status |
|-------|----------|------------|--------|
| Pre-Migration | Complete | 0h | ✅ DONE |
| Phase 1: Path Fields | 2-3h | 3h | 🔴 TODO |
| Phase 2: Scripts | 2-3h | 6h | 🔴 TODO |
| Phase 3: Land Polish | 1-2h | 8h | 🔴 TODO |
| Phase 4: Documents | 2-3h | 11h | 🔴 TODO |
| Phase 5: Testing | 3-4h | 15h | 🔴 TODO |
| **Total** | **~15 hours** | **~2 days** | |

---

## NEXT STEP

**Start Phase 1:** Add missing path-conditional fields to `LiveCallInputs.tsx`

```bash
# Create a new branch for Phase 1
git checkout -b phase1-path-fields

# Start with types
code src/app/types.ts
```

---

**Document Version:** 1.0  
**Last Updated:** 2026-04-16  
**Migration Status:** PRE-PHASE-1 (Ready to begin)
