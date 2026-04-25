/**
 * Application constants and configuration
 * Centralizes all hardcoded values, strategies, and repair items
 */

import { RepairItem } from '../types';

/**
 * Repair estimation items with low/mid/high cost ranges
 */
export const REPAIR_ITEMS: RepairItem[] = [
  { id: 'roof', label: 'Roof Replacement', desc: 'Full shingle or roofing replacement', low: 8000, mid: 13000, high: 18000, checked: false },
  { id: 'hvac', label: 'HVAC Full System', desc: 'Replace full HVAC system', low: 5000, mid: 8500, high: 12000, checked: false },
  { id: 'windows-rot', label: 'Rotted / Broken Windows', desc: 'Repair damaged windows', low: 1500, mid: 3750, high: 6000, checked: false },
  { id: 'windows-full', label: 'Full Window Replacement', desc: 'Replace all windows', low: 6000, mid: 10500, high: 15000, checked: false },
  { id: 'electric', label: 'Electrical Panel / Wiring', desc: 'Panel replacement or rewiring', low: 3000, mid: 6500, high: 10000, checked: false },
  { id: 'plumbing-full', label: 'Plumbing Full Re-Pipe', desc: 'Whole-home plumbing replacement', low: 4000, mid: 8000, high: 12000, checked: false },
  { id: 'plumbing-partial', label: 'Plumbing Partial', desc: 'Localized plumbing repairs', low: 800, mid: 1900, high: 3000, checked: false },
  { id: 'flooring', label: 'Flooring - Full House', desc: 'Replace flooring throughout', low: 4000, mid: 7000, high: 10000, checked: false },
  { id: 'kitchen', label: 'Kitchen Full Remodel', desc: 'Full kitchen renovation', low: 8000, mid: 16500, high: 25000, checked: false },
  { id: 'kitchen-cosmetic', label: 'Kitchen Cosmetic', desc: 'Paint, hardware, counters, touch-ups', low: 2000, mid: 4000, high: 6000, checked: false },
  { id: 'bath', label: 'Bathroom Remodel', desc: 'Full bathroom renovation', low: 5000, mid: 8500, high: 12000, checked: false },
  { id: 'bath-cosmetic', label: 'Bathroom Cosmetic', desc: 'Fixtures, vanity, light cosmetic work', low: 1000, mid: 2250, high: 3500, checked: false },
  { id: 'paint', label: 'Interior Paint', desc: 'Full interior repaint', low: 2500, mid: 4250, high: 6000, checked: false },
  { id: 'exterior', label: 'Exterior / Siding', desc: 'Exterior paint or siding repairs', low: 3000, mid: 6000, high: 9000, checked: false },
  { id: 'foundation', label: 'Foundation Repairs', desc: 'Stabilization or structural correction', low: 5000, mid: 17500, high: 30000, checked: false },
  { id: 'debris', label: 'Debris Removal', desc: 'Trash-out and haul-away', low: 500, mid: 1500, high: 2500, checked: false },
  { id: 'water-heater', label: 'Water Heater', desc: 'Replace water heater', low: 800, mid: 1300, high: 1800, checked: false },
  { id: 'landscaping', label: 'Landscaping / Curb Appeal', desc: 'Cleanup, trim, and curb appeal', low: 500, mid: 1750, high: 3000, checked: false },
];

/**
 * Quick repair presets for common property conditions
 */
export const REPAIR_PRESETS = {
  cosmetic: { low: 5000, mid: 10000, high: 15000, condition: 'Cosmetic' },
  moderate: { low: 15000, mid: 25000, high: 35000, condition: 'Moderate' },
  heavy: { low: 35000, mid: 50000, high: 70000, condition: 'Heavy' },
  gutRehab: { low: 60000, mid: 80000, high: 100000, condition: 'Gut Rehab' },
};

/**
 * Deal strategy configurations
 */
export const STRATEGIES = {
  CASH_WHOLESALE: {
    name: 'Cash Wholesale',
    maoPercent: 0.60,
    defaultFee: 8000,
    timeline: '7-14 days',
    description: 'Quick cash assignment to investor buyer',
  },
  RETAIL_BUYER: {
    name: 'Retail Buyer Program (RBP)',
    maoPercent: 0.88,
    timeline: '14-21 days',
    description: 'Assign to retail buyer at 88% ARV for built-in equity',
  },
  FIX_FLIP: {
    name: 'Fix & Flip',
    maoPercent: 0.70,
    timeline: '6 months',
    description: 'Purchase, renovate, and resell for profit',
  },
  SUBJECT_TO: {
    name: 'Subject-To',
    downPaymentPercent: 0.03,
    maxRate: 6.0,
    timeline: '14-30 days',
    description: 'Take over existing mortgage payments',
  },
};

/**
 * Acquisition paths configuration
 */
export const PATHS = {
  CASH: {
    id: 'cash',
    title: 'Cash Offer - Path 1',
    badge: 'Speed-first close',
    color: 'green',
    description: 'Direct cash purchase with 7-14 day close',
  },
  CREATIVE: {
    id: 'creative',
    title: 'Creative Finance - Path 2',
    badge: 'Seller financing',
    color: 'blue',
    description: 'Structured seller financing with flexible terms',
  },
  SUBTO: {
    id: 'subto',
    title: 'Mortgage Takeover - Path 3',
    badge: 'Subject-To',
    color: 'purple',
    description: 'Take over existing mortgage payments',
  },
  RBP: {
    id: 'rbp',
    title: 'Retail Buyer Program - Path 4',
    badge: 'Maximum price',
    color: 'amber',
    description: 'Connect with retail buyers at 88% ARV',
  },
};

/**
 * Deliverable types for each path
 */
export const DELIVERABLES = {
  A: {
    code: 'Deliverable A',
    title: 'Seller Presentation Guide',
    subtitle: 'Complete seller-facing presentation with market analysis',
  },
  B: {
    code: 'Deliverable B',
    title: 'Letter of Intent',
    subtitle: 'Formal offer terms and conditions',
  },
  C: {
    code: 'Deliverable C',
    title: 'Internal Deal Report',
    subtitle: 'Internal analysis and underwriting review',
  },
  D: {
    code: 'Deliverable D',
    title: 'Deal Intelligence Report',
    subtitle: 'Path comparison and positioning analysis',
  },
  E: {
    code: 'Deliverable E',
    title: 'Next Steps Flow',
    subtitle: 'Post-acceptance execution checklist',
  },
};

/**
 * Motivation score levels and recommended actions
 */
export const MOTIVATION_LEVELS = {
  1: {
    score: 1,
    level: 'Exploring',
    action: 'Educate only. Leave the DIR. Set a 7-day follow-up. Do not push an LOI.',
    pathStrategy: 'No active path yet — build trust first.',
    color: 'gray',
  },
  2: {
    score: 2,
    level: 'Exploring',
    action: 'Educate only. Leave the DIR. Set a 7-day follow-up. Do not push an LOI.',
    pathStrategy: 'No active path yet — build trust first.',
    color: 'gray',
  },
  3: {
    score: 3,
    level: 'Interested',
    action: 'Present all 4 paths side-by-side. Issue a comparison page. Ask which timeline matters most.',
    pathStrategy: 'Offer all paths. Let seller self-select.',
    color: 'yellow',
  },
  4: {
    score: 4,
    level: 'Motivated',
    action: 'Present 1-2 best-fit paths. Issue LOI immediately after meeting. Follow up in 24 hrs.',
    pathStrategy: 'Lead with best-fit path. Cash as anchor.',
    color: 'orange',
  },
  5: {
    score: 5,
    level: 'Urgent',
    action: 'Go directly to LOI on the dominant path. Close in the same meeting if possible. Urgency is already there — match it.',
    pathStrategy: 'Close path only. No path shopping.',
    color: 'red',
  },
};

/**
 * Underwriting rules for each strategy
 */
export const UNDERWRITING_RULES = {
  CASH_WHOLESALE: [
    { rule: 'MAO Formula', value: 'ARV × 70% - Repairs' },
    { rule: 'Minimum Spread', value: '$8,000 assignment fee' },
    { rule: 'ARV Verified', value: '3+ comps within 90 days' },
    { rule: 'Repair Estimate', value: 'Verified by contractor' },
  ],
  RBP: [
    { rule: 'MAO Formula', value: 'ARV × 88% - Repairs' },
    { rule: 'Buyer Equity', value: 'Minimum 12% built-in' },
    { rule: 'Market Time', value: 'Under 60 DOM' },
    { rule: 'Condition', value: 'C3 or better' },
  ],
  SUBJECT_TO: [
    { rule: 'Existing Mortgage', value: 'Active loan under 6%' },
    { rule: 'Cash Flow', value: 'Positive after PITI' },
    { rule: 'Equity Position', value: 'Under 80% LTV' },
    { rule: 'Payment History', value: 'Current on payments' },
  ],
  LAND_BUILDER: [
    { rule: 'Builder Spread', value: 'Minimum 15% margin' },
    { rule: 'Lot Size', value: '0.25+ acres' },
    { rule: 'Zoning', value: 'Residential buildable' },
    { rule: 'Utilities', value: 'Available or stub' },
  ],
};

/**
 * Default investor assumptions for yield calculations
 */
export const DEFAULT_INVESTOR_ASSUMPTIONS = {
  holdMonths: 6,
  closingCosts: 3000,
  holdingCostsPerMonth: 800,
  sellingCostPercent: 0.08, // 8% of ARV
  refinanceLTV: 0.75, // 75% for BRRRR
  monthlyReserves: 300, // For taxes/insurance/maintenance
};

/**
 * App-wide configuration
 */
export const APP_CONFIG = {
  companyName: 'Probono Key Realty',
  companyAbbr: 'PBK',
  defaultTimeline: '14-21 days',
  defaultBuilderPrice: 30000, // Per ¼ acre
  defaultLotSize: '0.25', // acres
  autoSaveInterval: 5000, // 5 seconds
  localStorageKey: 'pbk-deal-data',
  darkModeKey: 'pbk-dark-mode',
};
