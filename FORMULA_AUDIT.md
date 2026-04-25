# PBK Formula Audit Report
**Date:** 2026-04-16  
**Comparing:** Original HTML (`PBK_Command_Center_v5.html`) vs React Implementation (`utils/dealCalculations.ts`)

---

## ✅ MATCHING FORMULAS

### 1. ARV Calculation
**Both use identical logic:**
```javascript
// HTML (line 2989-2991)
var compPrices=[compA,compB,compC].filter(function(p){return p>0;});
var arvFromComps = compPrices.length ? 
  Math.round(compPrices.reduce(function(s,p){return s+p;},0)/compPrices.length) : 0;

// React
const prices = [comps.A.price, comps.B.price, comps.C.price].filter(p => p > 0);
return Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
```
**Status:** ✅ **EXACT MATCH**

---

## ⚠️ CRITICAL DIFFERENCES

### 2. MAO Cash (60%) Calculation

**Original HTML (line 3014-3017):**
```javascript
const cashPct = (+gv('mao-cash-pct')||60)/100;  // Default 60%
const fee = +gv('h-fee')||8000;
const mao60 = Math.max(0, Math.round(arv*cashPct - fee));
```

**React Implementation:**
```typescript
wholesale: (arv: number, repairs: number): number => {
  return Math.round(arv * 0.60 - repairs);
}
```

**Differences:**
1. ❌ **Original subtracts FEE**, React subtracts REPAIRS
2. ❌ **Original uses Math.max(0, ...)**, React doesn't
3. ❌ **Original allows adjustable cashPct**, React hardcodes 0.60

**Impact:** React calculation can produce **different** results!

---

### 3. MAO RBP (88%) Calculation

**Original HTML (line 3015-3018):**
```javascript
const rbpPct = (+gv('mao-rbp-pct')||88)/100;  // Default 88%
const maorbp = Math.max(0, Math.round(arv*rbpPct));
```

**React Implementation:**
```typescript
rbp: (arv: number): number => {
  return Math.round(arv * 0.88);
}
```

**Differences:**
1. ✅ **Both use same percentage (88%)**
2. ❌ **Original uses Math.max(0, ...)**, React doesn't
3. ❌ **Original allows adjustable rbpPct**, React hardcodes 0.88

**Impact:** Minor - React could return negative values in edge cases

---

### 4. MAO After Repairs Calculation

**Original HTML (line 3016-3019):**
```javascript
const arPct = (+gv('mao-ar-pct')||65)/100;  // Default 65%
const maoar = Math.round(arv*arPct - repairs - fee);
```

**React Implementation (Fix & Flip):**
```typescript
fixFlip: (arv: number, repairs: number): number => {
  return Math.round(arv * 0.70 - repairs);
}
```

**Differences:**
1. ❌ **Original uses 65%**, React uses 70%
2. ❌ **Original subtracts FEE**, React doesn't
3. ❌ **Original allows adjustable arPct**, React hardcodes 0.70

**Impact:** React calculates **HIGHER** MAO values (70% vs 65%)

---

### 5. Land Calculations

**Original HTML (line 2824-2849):**
```javascript
var perQuarter = +gv('l-bp')||0;
var acres = syncLandLotSize(true)||0.25;
acres = Math.max(0.01, acres);
var units = acres/0.25;  // Every 0.25 acre = 1 unit
var totalBuilderPays = Math.round(perQuarter*units);
var spread = totalBuilderPays>50000 ? 8000 : 
             totalBuilderPays>30000 ? 6500 : 5500;
var offer = Math.max(0, Math.round(totalBuilderPays - spread));
```

**React Implementation:**
```typescript
calculateLandMetrics(lotSizeAcres, builderPricePerQuarterAcre) {
  const quarterAcreUnits = lotSizeAcres / 0.25;
  const totalValue = Math.round(quarterAcreUnits * builderPricePerQuarterAcre);
  return { units, totalValue };
}
```

**Differences:**
1. ❌ **Original has dynamic spread calculation** (8000/6500/5500), React doesn't
2. ❌ **Original calculates offer automatically**, React only calculates value
3. ✅ **Both use same 0.25 acre unit logic**

**Impact:** React is missing **automatic offer calculation** with spread

---

### 6. Monthly Payment Calculation

**Original HTML (line 1246):**
```javascript
var _pmt = Math.round(
  principal * 0.8 * 
  (rate/100/12 * Math.pow(1+rate/100/12, 360)) / 
  (Math.pow(1+rate/100/12, 360) - 1)
);
```

**React Implementation:**
```typescript
const monthlyRate = annualRate / 100 / 12;
const numPayments = years * 12;
const payment = (principal * monthlyRate) / 
  (1 - Math.pow(1 + monthlyRate, -numPayments));
return Math.round(payment);
```

**Differences:**
1. ❌ **Original uses 0.8 multiplier** (80% LTV), React uses full principal
2. ✅ **Both use same amortization formula**

**Impact:** Original assumes 80% financing, React assumes 100%

---

## 🔧 RECOMMENDED FIXES

### Priority 1: Critical Formula Corrections

**Update `utils/dealCalculations.ts`:**

```typescript
// FIX 1: MAO Cash should subtract FEE, not repairs
export const calculateMAO = {
  wholesale: (arv: number, assignmentFee: number = 8000): number => {
    return Math.max(0, Math.round(arv * 0.60 - assignmentFee));
  },
  
  // FIX 2: Add Math.max(0, ...)
  rbp: (arv: number): number => {
    return Math.max(0, Math.round(arv * 0.88));
  },
  
  // FIX 3: Use 65% and subtract both repairs AND fee
  afterRepairs: (arv: number, repairs: number, assignmentFee: number = 8000): number => {
    return Math.max(0, Math.round(arv * 0.65 - repairs - assignmentFee));
  },
  
  // Keep Fix & Flip at 70% (this is different strategy)
  fixFlip: (arv: number, repairs: number): number => {
    return Math.round(arv * 0.70 - repairs);
  }
};
```

### Priority 2: Land Offer Calculation

**Add automatic offer calculator:**

```typescript
export const calculateLandOffer = (
  totalBuilderValue: number
): { spread: number; offer: number } => {
  const spread = 
    totalBuilderValue > 50000 ? 8000 :
    totalBuilderValue > 30000 ? 6500 : 5500;
  
  const offer = Math.max(0, Math.round(totalBuilderValue - spread));
  
  return { spread, offer };
};
```

### Priority 3: Monthly Payment with LTV

**Add LTV parameter:**

```typescript
export const calculateMonthlyPayment = (
  principal: number,
  annualRate: number,
  years: number = 30,
  ltvPercent: number = 100  // Add this parameter
): number => {
  if (principal === 0 || annualRate === 0) return 0;
  
  const loanAmount = principal * (ltvPercent / 100);  // Apply LTV
  const monthlyRate = annualRate / 100 / 12;
  const numPayments = years * 12;
  
  const payment = (loanAmount * monthlyRate) / 
    (1 - Math.pow(1 + monthlyRate, -numPayments));
  
  return Math.round(payment);
};
```

---

## 📊 SUMMARY

| Formula | Original | React | Match? | Priority |
|---------|----------|-------|--------|----------|
| ARV Calculation | Avg of comps | Avg of comps | ✅ | - |
| MAO Cash (60%) | ARV×60% - **fee** | ARV×60% - **repairs** | ❌ | **HIGH** |
| MAO RBP (88%) | ARV×88% | ARV×88% | ⚠️ | Low |
| MAO After Repairs | ARV×**65%** - repairs - fee | ARV×**70%** - repairs | ❌ | **HIGH** |
| Land Spread | Dynamic (8K/6.5K/5.5K) | Missing | ❌ | **MEDIUM** |
| Monthly Payment | 80% LTV | 100% LTV | ❌ | **MEDIUM** |

---

## 🎯 ACTION PLAN

**Should I:**

1. **Fix the React formulas** to match the original HTML exactly?
2. **Keep React formulas** and update the HTML to match React?
3. **Create a hybrid** - some formulas from HTML, some from React?

**The safest approach is #1** - update React to match the proven HTML formulas.

**Want me to implement the fixes now?**
