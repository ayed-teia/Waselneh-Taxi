export interface SettlementAmounts {
  grossFareIls: number;
  commissionIls: number;
  driverNetIls: number;
  recurringFeeIls: number;
  payableIls: number;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateSettlement(
  records: Array<{ grossFareIls: number; commissionIls: number; driverNetIls: number }>,
  recurringFeeIls: number
): SettlementAmounts {
  const totals = records.reduce((sum, item) => ({
    gross: sum.gross + Math.max(0, item.grossFareIls),
    commission: sum.commission + Math.max(0, item.commissionIls),
    net: sum.net + Math.max(0, item.driverNetIls),
  }), { gross: 0, commission: 0, net: 0 });
  const fee = money(Math.max(0, recurringFeeIls));
  return {
    grossFareIls: money(totals.gross),
    commissionIls: money(totals.commission),
    driverNetIls: money(totals.net),
    recurringFeeIls: fee,
    payableIls: money(Math.max(0, totals.net - fee)),
  };
}
