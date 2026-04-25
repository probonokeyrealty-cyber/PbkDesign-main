# PBK Command Center - Component Architecture

**Date:** 2026-04-16  
**Purpose:** Document current React component structure and relationships

---

## ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────┐
│                         App.tsx                              │
│  • Main state container (DealData)                          │
│  • Tab routing (analyzer/callmode/documents/crm)            │
│  • Dark mode controller                                      │
│  • localStorage persistence                                  │
│  • Calculation orchestration (ARV, MAO, verdict)            │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   TopBar     │    │  LeftPanel   │    │  RightPanel  │
│   (Fixed)    │    │  (Sidebar)   │    │  (Sidebar)   │
└──────────────┘    └──────────────┘    └──────────────┘
                            │
        ┌───────────────────┼───────────────────────┐
        │                   │                       │
        ▼                   ▼                       ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ AnalyzerTab  │    │ CallModeTab  │    │PathDeliverbl │
│              │    │              │    │    (Docs)    │
└──────────────┘    └──────────────┘    └──────────────┘
        │                   │                   │
        ▼                   ▼                   ▼
   [Sub-components]   [Sub-components]   [Sub-components]
```

---

## LAYER ARCHITECTURE

### Layer 1: Core State & Logic (Engine)
**Location:** `src/app/utils/`, `src/app/hooks/`  
**Purpose:** Calculation engine - LOCKED, DO NOT MODIFY UI

```
utils/
├── dealCalculations.ts   ← 🔒 FORMULA ENGINE (locked)
│   ├── calculateARV()
│   ├── calculateMAO.wholesale()      [ARV×60%-fee]
│   ├── calculateMAO.rbp()            [ARV×88%]
│   ├── calculateMAO.afterRepairs()   [ARV×65%-repairs-fee]
│   ├── calculateVerdict()
│   ├── calculateMonthlyPayment()     [80% LTV]
│   ├── calculateLandOffer()          [Dynamic 8K/6.5K/5.5K]
│   └── calculateInvestorMetrics.*
│
├── formatting.ts         ← Display helpers (safe to modify)
│   ├── formatCurrency()
│   ├── formatPercent()
│   └── formatDate()
│
└── fileOperations.ts     ← Export helpers (safe to modify)
    ├── downloadTextFile()
    └── generatePDF()

hooks/
└── useDealCalculations.ts  ← React hooks wrapping calculations
    ├── useARVCalculation()
    ├── useMAOCalculations()
    └── useDealAnalysis()
```

**Decision:** **KEEP & PROTECT** - This is the sacred ground. All UI changes are wrappers.

---

### Layer 2: Data Models (Types)
**Location:** `src/app/types.ts`  
**Purpose:** TypeScript interfaces defining data structure

```typescript
interface DealData {
  // Property Info
  address: string;
  type: 'house' | 'condo' | 'land';
  contact: 'owner' | 'agent';
  
  // Pricing
  price: number;
  arv: number;
  mao60: number;
  maoRBP: number;
  verdict: 'none' | 'green' | 'yellow' | 'red';
  
  // Repairs
  repairs: { low, mid, high, condition };
  
  // Comps
  comps: { A, B, C: { address, price, date, link } };
  
  // Financing
  balance: number;
  rate: number;
  rent: number;
  fee: number;
  
  // Land-specific
  builderPrice: number;
  lotSize: string;
  offer: number;
  
  // Seller Info
  sellerName: string;
  sellerEmail: string;
  sellerPhone: string;
  
  // Creative Finance
  cfDownPayment: number;
  cfRate: number;
  cfTerm: number;
  
  // + more fields...
}
```

**Decision:** **WRAP** - Add new fields as needed, never remove existing ones.

---

### Layer 3: Document Templates
**Location:** `src/app/templates/`  
**Purpose:** Script and document generation

```
templates/
├── scripts.ts          ← Call mode scripts
│   └── pathScripts     [5 paths × 3 scripts each]
│
└── documents.ts        ← LOI, Seller Guide templates
    ├── generateLOI()
    └── generateSellerGuide()
```

**Decision:** **WRAP** - Extend with owner/agent variants, preserve existing.

---

### Layer 4: UI Components (Presentation)
**Location:** `src/app/components/`  
**Purpose:** Visual presentation of data

#### 4.1 Shell Components (Keep)

```
TopBar.tsx
├── Purpose: Top navigation, logo, verdict badge, actions
├── State: None (receives props from App)
├── Decision: KEEP
└── Status: ✅ Complete

LeftPanel.tsx
├── Purpose: Deal snapshot, MAO values, repair summary
├── State: None (receives props from App)
├── Decision: KEEP
└── Status: ✅ Complete

RightPanel.tsx
├── Purpose: Quick actions, stats, document shortcuts
├── State: None (receives props from App)
├── Decision: KEEP (cleaned up, no longer has scripts)
└── Status: ✅ Complete
```

#### 4.2 Tab Components (Keep & Enhance)

```
AnalyzerTab.tsx
├── Purpose: Main data entry (property, comps, repairs, financing)
├── Sub-components:
│   ├── RepairCalculator.tsx    ← Clickable repair estimator
│   └── LandAnalysis.tsx        ← Land-specific inputs
├── Decision: KEEP, enhance land mode in Phase 3
└── Status: ✅ Complete, ⚠️ needs sq ft input

CallModeTab.tsx
├── Purpose: Scripts organized by acquisition path
├── Sub-components:
│   └── LiveCallInputs.tsx      ← Path-conditional form fields
├── Decision: KEEP, enhance with owner/agent variants (Phase 2)
└── Status: ✅ Scripts done, ⚠️ LiveCallInputs incomplete

PathDeliverables.tsx (Documents Tab)
├── Purpose: LOI, Seller Guide, PDF generation
├── Sub-components:
│   ├── DocumentTemplates.tsx   ← Template previews
│   └── PDFExporter.tsx         ← jsPDF integration
├── Decision: KEEP, verify new fields in Phase 4
└── Status: ✅ Complete

CRMFeatures.tsx (Tracker Tab)
├── Purpose: Deal tracking, pipeline management
├── Sub-components:
│   └── DealScoring.tsx         ← Motivation scoring
├── Decision: KEEP
└── Status: ✅ Complete (enhanced beyond HTML)
```

#### 4.3 Feature Components (Keep)

```
StrategySelector.tsx
├── Purpose: Path selection with comparison table
├── Decision: KEEP (better than HTML implementation)
└── Status: ✅ Complete

InvestorYield.tsx
├── Purpose: Wholesale/Fix&Flip/BRRRR calculations
├── Decision: KEEP (uses locked formulas)
└── Status: ✅ Complete

RepairCalculator.tsx
├── Purpose: Clickable repair estimate labels
├── Decision: KEEP (excellent UX)
└── Status: ✅ Complete

LiveCallInputs.tsx
├── Purpose: Path-conditional form for live deal capture
├── Decision: ENHANCE (Phase 1 - add missing fields)
└── Status: ⚠️ INCOMPLETE (see Phase 1 checklist)

LandAnalysis.tsx
├── Purpose: Land-specific inputs and calculations
├── Decision: ENHANCE (Phase 3 - add sq ft mode)
└── Status: ⚠️ Missing sq ft input option

DocumentTemplates.tsx
├── Purpose: Template preview and selection
├── Decision: KEEP
└── Status: ✅ Complete

PDFExporter.tsx
├── Purpose: Full deal package PDF generation
├── Decision: KEEP, verify in Phase 4
└── Status: ✅ Complete

DealScoring.tsx
├── Purpose: Motivation and quality scoring
├── Decision: KEEP
└── Status: ✅ Complete (enhancement)
```

---

## COMPONENT DECISION MATRIX

| Component | Lines | Complexity | Decision | Phase | Priority |
|-----------|-------|-----------|----------|-------|----------|
| `TopBar.tsx` | ~150 | Low | **KEEP** | - | ✅ Done |
| `LeftPanel.tsx` | ~200 | Low | **KEEP** | - | ✅ Done |
| `RightPanel.tsx` | ~120 | Low | **KEEP** | - | ✅ Done |
| `AnalyzerTab.tsx` | ~350 | Medium | **KEEP** | - | ✅ Done |
| `CallModeTab.tsx` | ~400 | Medium | **ENHANCE** | 2 | ⚠️ Add variants |
| `PathDeliverables.tsx` | ~300 | Medium | **VERIFY** | 4 | ⚠️ Test fields |
| `CRMFeatures.tsx` | ~250 | Medium | **KEEP** | - | ✅ Done |
| `StrategySelector.tsx` | ~450 | High | **KEEP** | - | ✅ Done |
| `InvestorYield.tsx` | ~300 | High | **KEEP** | - | ✅ Done |
| `RepairCalculator.tsx` | ~200 | Low | **KEEP** | - | ✅ Done |
| `LiveCallInputs.tsx` | ~250 | Medium | **ENHANCE** | 1 | 🔴 Incomplete |
| `LandAnalysis.tsx` | ~230 | Medium | **ENHANCE** | 3 | ⚠️ Add sq ft |
| `DocumentTemplates.tsx` | ~180 | Low | **KEEP** | - | ✅ Done |
| `PDFExporter.tsx` | ~400 | High | **VERIFY** | 4 | ⚠️ Test fields |
| `DealScoring.tsx` | ~150 | Low | **KEEP** | - | ✅ Done |

---

## DATA FLOW DIAGRAM

```
User Input (UI Component)
        ↓
┌───────────────────────┐
│  handleDealChange()   │ ← Component calls this
│  in App.tsx           │
└───────────────────────┘
        ↓
┌───────────────────────┐
│  setDeal(updates)     │ ← Updates React state
└───────────────────────┘
        ↓
┌───────────────────────┐
│  useEffect triggers   │ ← Detects state change
└───────────────────────┘
        ↓
┌───────────────────────┐
│  Calculate ARV        │ ← calculateARV(comps)
│  Calculate MAO        │ ← calculateMAO.wholesale(arv, fee)
│  Calculate Verdict    │ ← calculateVerdict(price, arv, maoRBP)
└───────────────────────┘
        ↓
┌───────────────────────┐
│  Update deal state    │ ← setDeal({ arv, mao60, maoRBP, verdict })
└───────────────────────┘
        ↓
┌───────────────────────┐
│  React re-renders     │ ← All components receive updated props
└───────────────────────┘
        ↓
┌───────────────────────┐
│  localStorage.save    │ ← Persist to browser storage
└───────────────────────┘
```

**Key Points:**
- Single source of truth: `deal` state in `App.tsx`
- Calculations happen in `useEffect` hooks
- Components are **pure presentational** (no calculation logic)
- Formula functions are **centralized** in `dealCalculations.ts`

---

## PATH-CONDITIONAL RENDERING

How components show/hide based on acquisition path:

```typescript
// In LiveCallInputs.tsx (CURRENT - INCOMPLETE)
{selectedPath === 'creative_finance' && (
  <div>
    {/* Show: Down Payment, Rate, Term */}
    {/* MISSING: CF Type dropdown */}
  </div>
)}

{selectedPath === 'subject_to' && (
  <div>
    {/* Show: existing fields only */}
    {/* MISSING: Upfront, Balance Confirm, Rate Confirm, MT Type */}
  </div>
)}

{selectedPath === 'rbp' && (
  <div>
    {/* Show: existing fields only */}
    {/* MISSING: RBP Price Confirm, Buyer Type, Seller Costs, Cash Alt */}
  </div>
)}

{selectedPath === 'cash' && (
  <div>
    {/* Show: existing fields only */}
    {/* MISSING: As-Is Terms, Close Period */}
  </div>
)}

{selectedPath === 'land' && (
  <div>
    {/* Show: existing fields only */}
    {/* MISSING: Lot Size Confirm, Buyer Type, Seller Costs */}
  </div>
)}
```

**Phase 1 Goal:** Complete all path-conditional sections

---

## SCRIPT GENERATION FLOW

```
User enters deal data
        ↓
┌────────────────────────────┐
│  User selects path         │ (Cash/CF/SubTo/RBP/Land)
└────────────────────────────┘
        ↓
┌────────────────────────────┐
│  CallModeTab.tsx           │
│  • Loads pathScripts[path] │
│  • Replaces [brackets]     │
│  • Displays 3 scripts      │
└────────────────────────────┘
        ↓
┌────────────────────────────┐
│  Script Template           │
│  (from scripts.ts)         │
│                            │
│  "Hi [sellerName],         │
│   I can offer [price]      │
│   for [address]..."        │
└────────────────────────────┘
        ↓
┌────────────────────────────┐
│  Bracket Replacement       │
│  [sellerName] → "John Doe" │
│  [price] → "$160,000"      │
│  [address] → "123 Main St" │
└────────────────────────────┘
        ↓
┌────────────────────────────┐
│  Display Final Script      │
│  + Download Button         │
└────────────────────────────┘
```

**Phase 2 Goal:** Add owner/agent variants to this flow

---

## DOCUMENT GENERATION FLOW

```
User fills all required fields
        ↓
┌────────────────────────────┐
│  PathDeliverables.tsx      │
│  • Detects selected path   │
│  • Checks field completion │
└────────────────────────────┘
        ↓
┌────────────────────────────┐
│  DocumentTemplates.tsx     │
│  • Loads template for path │
│  • Populates fields        │
│  • Shows preview           │
└────────────────────────────┘
        ↓
┌────────────────────────────┐
│  User clicks "Download"    │
└────────────────────────────┘
        ↓
┌────────────────────────────┐
│  Option 1: Text Download   │
│  downloadTextFile()        │
│  → LOI.txt or SG.txt       │
└────────────────────────────┘
        ↓
┌────────────────────────────┐
│  Option 2: PDF Export      │
│  PDFExporter.tsx           │
│  → jsPDF.generate()        │
│  → MasterPackage.pdf       │
└────────────────────────────┘
```

**Phase 4 Goal:** Verify all new fields appear in documents

---

## CRITICAL FUNCTIONS (DO NOT BREAK)

### Calculation Functions (🔒 LOCKED)
```typescript
// In dealCalculations.ts
calculateARV(comps)                    // Average of A/B/C prices
calculateMAO.wholesale(arv, fee)       // ARV × 60% - fee
calculateMAO.rbp(arv)                  // ARV × 88%
calculateMAO.afterRepairs(arv, rep, fee) // ARV × 65% - rep - fee
calculateVerdict(price, arv, maoRBP)   // Green/Yellow/Red
calculateMonthlyPayment(bal, rate, years, ltv) // PITI with 80% LTV
calculateLandOffer(builderTotal)       // Dynamic 8K/6.5K/5.5K spread
calculateInvestorMetrics.*             // Wholesale/FF/BRRRR ROI
```

### Integration Functions (Safe to Wrap)
```typescript
// In App.tsx
handleDealChange(updates)              // Update deal state
// In various components
formatCurrency(value)                  // $123,456
downloadTextFile(content, filename)    // Save to disk
```

---

## TESTING POINTS

After any component change, verify:

1. **Formula Integrity:**
   ```typescript
   // Test case: ARV $200K, Repairs $20K, Fee $8K
   expect(calculateMAO.wholesale(200000, 8000)).toBe(112000);
   expect(calculateMAO.rbp(200000)).toBe(176000);
   expect(calculateMAO.afterRepairs(200000, 20000, 8000)).toBe(102000);
   ```

2. **Data Flow:**
   - Change input in AnalyzerTab
   - Verify LeftPanel updates
   - Verify TopBar verdict updates
   - Verify CallModeTab scripts populate
   - Verify Documents include value

3. **Persistence:**
   - Enter data
   - Refresh page
   - Verify localStorage restored data

4. **Path Switching:**
   - Fill data for Path A
   - Switch to Path B
   - Verify correct fields show
   - Switch back to Path A
   - Verify data preserved

---

## WRAP vs REPLACE DECISIONS

### KEEP AS-IS ✅
Components that are complete and correct:
- TopBar.tsx
- LeftPanel.tsx
- RightPanel.tsx
- StrategySelector.tsx
- RepairCalculator.tsx
- InvestorYield.tsx
- DocumentTemplates.tsx
- DealScoring.tsx
- CRMFeatures.tsx

### ENHANCE (Wrap, Don't Replace) 🔄
Components that need additive changes:
- **LiveCallInputs.tsx** → Add path-conditional fields (Phase 1)
- **CallModeTab.tsx** → Add owner/agent variants (Phase 2)
- **LandAnalysis.tsx** → Add sq ft input option (Phase 3)

### VERIFY (Test, Don't Change) ✓
Components that need validation:
- **PathDeliverables.tsx** → Ensure new fields appear (Phase 4)
- **PDFExporter.tsx** → Ensure PDF includes new fields (Phase 4)

### NEVER TOUCH 🔒
Files that are calculation engine:
- `utils/dealCalculations.ts`
- `utils/formatting.ts` (safe but unnecessary)
- All formula functions

---

## MIGRATION APPROACH

```
┌─────────────────────────────────────────────────────┐
│              EXISTING WORKING CODE                   │
│                                                      │
│  ┌────────────────────────────────────────┐        │
│  │  dealCalculations.ts                    │        │
│  │  (Formula Engine - LOCKED)             │        │
│  └────────────────────────────────────────┘        │
│                      ▲                               │
│                      │                               │
│         ┌────────────┴────────────┐                │
│         │                          │                │
│  ┌──────▼──────┐          ┌──────▼──────┐         │
│  │  Existing   │          │  Existing   │         │
│  │  Components │          │  Components │         │
│  │  (Working)  │          │  (Working)  │         │
│  └─────────────┘          └─────────────┘         │
│                                                      │
└─────────────────────────────────────────────────────┘
                      │
                      │ ADD NEW LAYER ON TOP
                      ▼
┌─────────────────────────────────────────────────────┐
│              NEW UI ENHANCEMENTS                     │
│                                                      │
│  ┌────────────────────────────────────────┐        │
│  │  LiveCallInputs.tsx (Enhanced)         │        │
│  │  • Add new fields                       │        │
│  │  • Wire to existing state               │        │
│  │  • Use existing formulas                │        │
│  └────────────────────────────────────────┘        │
│                                                      │
│  ┌────────────────────────────────────────┐        │
│  │  CallModeTab.tsx (Enhanced)            │        │
│  │  • Add owner/agent variants             │        │
│  │  • Use existing script system           │        │
│  └────────────────────────────────────────┘        │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Philosophy:** Enhance, don't replace. Wrap, don't rebuild.

---

**Document Version:** 1.0  
**Last Updated:** 2026-04-16  
**Status:** Ready for Phase 1
