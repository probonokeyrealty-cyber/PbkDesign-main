export type AvaChatScope = {
  valid: true;
  identity: string;
  leadId: string;
  storageKeys: {
    operatorMemory: string;
    assistantSession: string;
    assistantExchanges: string;
  };
};

export function resolveAvaChatScope(rawSearch: string): AvaChatScope | { valid: false };
