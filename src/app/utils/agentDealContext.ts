import type { DealData, PBKPath } from '../types';
import {
  buildPbkPathScripts,
  type PbkLegacyScriptPath,
  type PbkScriptBundle,
} from '../templates/pbkPathScripts';

export type AgentScriptVariant = 'owner' | 'agent';
export type AgentScriptTab = 'opening' | 'acquisition' | 'closing' | 'objections';

export interface AgentDealContextOptions {
  activePath?: PBKPath;
  scriptVariant?: AgentScriptVariant;
  activeScriptTab?: AgentScriptTab;
  callNotes?: string;
  requestedBy?: string;
  runtimeSelectedScript?: {
    id?: string;
    title?: string;
    content?: string;
    reasonCodes?: string[];
  };
}

export interface AgentDealContext {
  version: 1;
  generatedAt: string;
  requestedBy: string;
  activePath: PBKPath;
  scriptPath: PbkLegacyScriptPath;
  scriptVariant: AgentScriptVariant;
  activeScriptTab: AgentScriptTab;
  dealSnapshot: {
    leadId?: string;
    sellerName?: string;
    sellerPhone?: string;
    sellerEmail?: string;
    address?: string;
    type?: DealData['type'];
    contact?: DealData['contact'];
    selectedPath?: DealData['selectedPath'];
    price?: number;
    agreedPrice?: number;
    arv?: number;
    maoCash?: number;
    maoRbp?: number;
    offer?: number;
    repairsMid?: number;
    timeline?: string;
    notes?: string;
  };
  analyzerNumbers: {
    arv: number;
    maoCash: number;
    maoRbp: number;
    agreedPrice: number;
    offer: number;
    repairsMid: number;
    assignmentFee: number;
  };
  activeScript: string;
  runtimeSelectedScript?: AgentDealContextOptions['runtimeSelectedScript'];
  activeScriptBundle: PbkScriptBundle;
  allPathScripts: ReturnType<typeof buildPbkPathScripts>;
  callNotes?: string;
}

export function getAgentScriptPath(path: PBKPath): PbkLegacyScriptPath {
  if (path === 'cf') return 'creative';
  if (path === 'mt') return 'subto';
  if (path === 'land-owner' || path === 'land-agent' || path === 'rbp-land') return 'land';
  return path;
}

export function getAgentScriptVariant(
  path: PBKPath,
  deal: DealData,
  preferred?: AgentScriptVariant
): AgentScriptVariant {
  if (path === 'cf' || path === 'mt' || path === 'land-agent') return 'agent';
  if (path === 'rbp' || path === 'land-owner' || path === 'rbp-land') return 'owner';
  return preferred || (deal.contact === 'realtor' ? 'agent' : 'owner');
}

export function buildAgentDealContext(
  deal: DealData,
  {
    activePath = deal.selectedPath || 'cash',
    scriptVariant,
    activeScriptTab = 'opening',
    callNotes = '',
    requestedBy = 'PBK Analyzer',
    runtimeSelectedScript,
  }: AgentDealContextOptions = {}
): AgentDealContext {
  const allPathScripts = buildPbkPathScripts(deal);
  const scriptPath = getAgentScriptPath(activePath);
  const resolvedVariant = getAgentScriptVariant(activePath, deal, scriptVariant);
  const activeScriptBundle = allPathScripts[scriptPath][resolvedVariant];
  const localActiveScript =
    activeScriptTab === 'acquisition'
      ? `${activeScriptBundle.acquisition}\n\n[NEXT-STEP CLOSE]\n${activeScriptBundle.closing}`
      : activeScriptBundle[activeScriptTab];
  const activeScript = runtimeSelectedScript?.content || localActiveScript;

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    requestedBy,
    activePath,
    scriptPath,
    scriptVariant: resolvedVariant,
    activeScriptTab,
    dealSnapshot: {
      leadId: deal.leadId,
      sellerName: deal.sellerName,
      sellerPhone: deal.sellerPhone,
      sellerEmail: deal.sellerEmail,
      address: deal.address,
      type: deal.type,
      contact: deal.contact,
      selectedPath: deal.selectedPath,
      price: deal.price,
      agreedPrice: deal.agreedPrice,
      arv: deal.arv,
      maoCash: deal.mao60,
      maoRbp: deal.maoRBP,
      offer: deal.offer,
      repairsMid: deal.repairs?.mid || 0,
      timeline: deal.timeline,
      notes: deal.notes,
    },
    analyzerNumbers: {
      arv: deal.arv || 0,
      maoCash: deal.mao60 || 0,
      maoRbp: deal.maoRBP || 0,
      agreedPrice: deal.agreedPrice || deal.price || 0,
      offer: deal.offer || 0,
      repairsMid: deal.repairs?.mid || 0,
      assignmentFee: deal.fee || 0,
    },
    activeScript,
    runtimeSelectedScript,
    activeScriptBundle,
    allPathScripts,
    callNotes,
  };
}
