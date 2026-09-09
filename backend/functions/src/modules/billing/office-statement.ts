export interface OfficeStatementAmounts {
  grossFareIls: number;
  commissionDueIls: number;
  subscriptionDueIls: number;
  totalDueIls: number;
}

const money = (value: number) => Math.round(Math.max(0, value) * 100) / 100;

export function calculateOfficeStatement(
  commissions: Array<{ grossFareIls: number; commissionIls: number }>,
  invoiceAmounts: number[]
): OfficeStatementAmounts {
  const grossFareIls = money(commissions.reduce((sum, item) => sum + money(item.grossFareIls), 0));
  const commissionDueIls = money(commissions.reduce((sum, item) => sum + money(item.commissionIls), 0));
  const subscriptionDueIls = money(invoiceAmounts.reduce((sum, amount) => sum + money(amount), 0));
  return { grossFareIls, commissionDueIls, subscriptionDueIls, totalDueIls: money(commissionDueIls + subscriptionDueIls) };
}
