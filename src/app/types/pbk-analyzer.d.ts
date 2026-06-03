import type { DealData } from '../types';
import type { PBKBranding } from '../utils/pbk';

export interface PBKAnalyzerStatePayload {
  deal?: Partial<DealData>;
  activeTab?: 'analyzer' | 'callmode' | 'documents' | 'crm' | string;
  analyzeStatus?: string;
  updatedAt?: number | string;
}

export interface PBKAnalyzerBridgeApi {
  getState: () => PBKAnalyzerStatePayload;
  getBranding: () => unknown;
  getSelectedPath: () => DealData['selectedPath'];
  getAgentDealContext: () => unknown;
  getPdfReadiness: (deal?: Partial<DealData>) => unknown;
  getDocumentSet: (deal?: Partial<DealData>, branding?: Partial<PBKBranding>) => unknown;
  buildMasterPackageQuery: (options?: {
    deal?: Partial<DealData>;
    branding?: Partial<PBKBranding>;
    printMode?: boolean;
  }) => URLSearchParams | string;
  setState: (payload: PBKAnalyzerStatePayload) => void;
  setActiveTab: (tab: 'analyzer' | 'callmode' | 'documents' | 'crm') => void;
  analyze: () => void | Promise<void>;
}

export interface PBKAnalyzerShellApi {
  getStorageKey: (name: string) => string;
  exportAnalyzerLocalState: () => unknown;
  pruneAnalyzerStorage: () => void;
  getCurrentSnapshot: () => PBKAnalyzerStatePayload;
  sync: (showNotice?: boolean) => void;
}

declare global {
  interface Window {
    PBKAnalyzer?: PBKAnalyzerBridgeApi;
    PBKAnalyzerShell?: PBKAnalyzerShellApi;
  }
}
