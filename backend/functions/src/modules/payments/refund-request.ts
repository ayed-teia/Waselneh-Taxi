export type RefundRequestStatus = 'processing' | 'submitted' | 'failed';

export interface RefundRequestDecision {
  allowed: boolean;
  alreadyRequested: boolean;
  reason?: string;
}

export function decideRefundRequest(
  paymentStatus: string,
  refundStatus?: string
): RefundRequestDecision {
  if (paymentStatus !== 'paid') {
    return { allowed: false, alreadyRequested: false, reason: 'Only paid payments can be refunded' };
  }
  if (refundStatus === 'processing' || refundStatus === 'submitted') {
    return { allowed: false, alreadyRequested: true };
  }
  return { allowed: true, alreadyRequested: false };
}
