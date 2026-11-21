export type OutlookDelivery = {
  id: string;
  subject: string;
  leadName: string;
  at: string;
  state: 'pending' | 'approved' | 'dispatching' | 'accepted' | 'delivered' | 'recovery' | 'failed' | 'closed';
  receiptId: string;
  confirmation: { receiptUrl: string; confirmedAt: string; confirmedBy: string } | null;
  canConfirm: boolean;
};

export function readOutlookDelivery(approval: unknown): OutlookDelivery | null;
export function normalizeOutlookReceiptUrl(value: unknown): string;
