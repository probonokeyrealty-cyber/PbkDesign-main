import { useState } from 'react';
import { formatCurrency } from '../utils/formatting';
import { REPAIR_ITEMS } from '../config/constants';

interface RepairCalculatorProps {
  onRepairChange: (repairs: { low: number; mid: number; high: number; condition: string }) => void;
}

export function RepairCalculator({ onRepairChange }: RepairCalculatorProps) {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [noRepairs, setNoRepairs] = useState(false);

  const toggleRepair = (id: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedItems(newSelected);
    calculateTotals(newSelected);
  };

  const toggleNoRepairs = () => {
    setNoRepairs(!noRepairs);
    if (!noRepairs) {
      setSelectedItems(new Set());
      onRepairChange({ low: 0, mid: 0, high: 0, condition: 'C3' });
    }
  };

  const calculateTotals = (selected: Set<string>) => {
    let low = 0, mid = 0, high = 0;
    
    selected.forEach(id => {
      const item = REPAIR_ITEMS.find(r => r.id === id);
      if (item) {
        low += item.low;
        mid += item.mid;
        high += item.high;
      }
    });

    let condition = 'C3';
    if (mid === 0) condition = 'C3';
    else if (mid < 5000) condition = 'C3';
    else if (mid < 20000) condition = 'C4';
    else if (mid < 50000) condition = 'C5';
    else condition = 'C6';

    onRepairChange({ low, mid, high, condition });
  };

  const setRepairLevel = (level: 'low' | 'mid' | 'high') => {
    // Select common repairs based on level
    const commonRepairs = {
      low: ['paint', 'landscaping', 'debris', 'water-heater'],
      mid: ['paint', 'flooring', 'kitchen-cosmetic', 'bath-cosmetic', 'landscaping'],
      high: ['roof', 'hvac', 'kitchen', 'bath', 'flooring', 'paint', 'plumbing-full', 'electric', 'foundation'],
    };

    const newSelected = new Set(commonRepairs[level]);
    setSelectedItems(newSelected);
    setNoRepairs(false);
    calculateTotals(newSelected);
  };

  const totals = {
    low: Array.from(selectedItems).reduce((sum, id) => {
      const item = REPAIR_ITEMS.find(r => r.id === id);
      return sum + (item?.low || 0);
    }, 0),
    mid: Array.from(selectedItems).reduce((sum, id) => {
      const item = REPAIR_ITEMS.find(r => r.id === id);
      return sum + (item?.mid || 0);
    }, 0),
    high: Array.from(selectedItems).reduce((sum, id) => {
      const item = REPAIR_ITEMS.find(r => r.id === id);
      return sum + (item?.high || 0);
    }, 0),
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
        <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
          Step 3 — Repair Estimator
        </h3>
      </div>

      {/* No Repairs Toggle */}
      <label className="flex items-start gap-2 p-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 cursor-pointer hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all mb-3">
        <input
          type="checkbox"
          checked={noRepairs}
          onChange={toggleNoRepairs}
          className="w-3.5 h-3.5 mt-0.5 accent-blue-500"
        />
        <div>
          <div className="text-[11px] font-semibold text-gray-900 dark:text-gray-100">
            No repairs needed
          </div>
          <div className="text-[9.5px] text-gray-500 dark:text-gray-400 leading-snug">
            Force repair estimate to $0 and skip repair-cost adjustments
          </div>
        </div>
      </label>

      {/* Quick Presets */}
      {!noRepairs && (
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setRepairLevel('low')}
            className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 text-[10px] font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-all"
          >
            Low (~5%)
          </button>
          <button
            onClick={() => setRepairLevel('mid')}
            className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 text-[10px] font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-all"
          >
            Mid (~12%)
          </button>
          <button
            onClick={() => setRepairLevel('high')}
            className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 text-[10px] font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-all"
          >
            High (~20%)
          </button>
        </div>
      )}

      {/* Repair Items Grid */}
      {!noRepairs && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
          {REPAIR_ITEMS.map((item) => (
            <label
              key={item.id}
              className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-all ${
                selectedItems.has(item.id)
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 hover:border-blue-300'
              }`}
            >
              <input
                type="checkbox"
                checked={selectedItems.has(item.id)}
                onChange={() => toggleRepair(item.id)}
                className="w-3.5 h-3.5 mt-0.5 accent-blue-500"
              />
              <div className="flex-1">
                <div className="text-[11px] font-semibold text-gray-900 dark:text-gray-100 leading-tight">
                  {item.label}
                </div>
                <div className="text-[9.5px] text-gray-500 dark:text-gray-400 leading-snug">
                  {item.desc}
                </div>
              </div>
            </label>
          ))}
        </div>
      )}

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="bg-gray-50 dark:bg-slate-900 rounded-lg p-3 text-center">
          <div className="text-[16px] font-semibold text-gray-900 dark:text-gray-100">
            {formatCurrency(totals.low)}
          </div>
          <div className="text-[9.5px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide mt-0.5">
            Low
          </div>
        </div>
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3 text-center">
          <div className="text-[16px] font-semibold text-blue-700 dark:text-blue-400">
            {formatCurrency(totals.mid)}
          </div>
          <div className="text-[9.5px] text-blue-600 dark:text-blue-500 font-medium uppercase tracking-wide mt-0.5">
            Mid Estimate
          </div>
        </div>
        <div className="bg-gray-50 dark:bg-slate-900 rounded-lg p-3 text-center">
          <div className="text-[16px] font-semibold text-gray-900 dark:text-gray-100">
            {formatCurrency(totals.high)}
          </div>
          <div className="text-[9.5px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide mt-0.5">
            High
          </div>
        </div>
        <div className="bg-gray-50 dark:bg-slate-900 rounded-lg p-3 text-center">
          <div className="text-[16px] font-semibold text-gray-900 dark:text-gray-100">
            {noRepairs ? 'No Repairs' : totals.mid === 0 ? 'C3' : totals.mid < 5000 ? 'C3' : totals.mid < 20000 ? 'C4' : totals.mid < 50000 ? 'C5' : 'C6'}
          </div>
          <div className="text-[9.5px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide mt-0.5">
            Condition
          </div>
        </div>
      </div>
    </div>
  );
}
