import { FormEvent, useEffect, useState } from 'react';

import { useI18n } from '../localization';
import { Promotion, savePromotion, subscribeToPromotions } from '../services/promotions.service';
import './PromotionsPage.css';

const initial = { code: '', nameAr: '', nameEn: '', discountType: 'fixed', discountValue: '5', maxDiscountIls: '', minFareIls: '0', usageLimit: '', perPassengerLimit: '1', startsAt: '', expiresAt: '', active: true };

export function PromotionsPage() {
  const { txt } = useI18n();
  const [items, setItems] = useState<Promotion[]>([]);
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => subscribeToPromotions(setItems, (value) => setError(value.message)), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      await savePromotion({ ...form, discountType: form.discountType, discountValue: Number(form.discountValue), maxDiscountIls: form.maxDiscountIls ? Number(form.maxDiscountIls) : null, minFareIls: Number(form.minFareIls), usageLimit: form.usageLimit ? Number(form.usageLimit) : null, perPassengerLimit: Number(form.perPassengerLimit), startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null, expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null });
      setForm(initial);
    } catch (value) { setError(value instanceof Error ? value.message : txt('تعذّر حفظ العرض', 'Failed to save promotion')); }
    finally { setSaving(false); }
  };

  const edit = (item: Promotion) => setForm({ code: item.code, nameAr: item.nameAr, nameEn: item.nameEn, discountType: item.discountType, discountValue: String(item.discountValue), maxDiscountIls: item.maxDiscountIls ? String(item.maxDiscountIls) : '', minFareIls: String(item.minFareIls), usageLimit: item.usageLimit ? String(item.usageLimit) : '', perPassengerLimit: String(item.perPassengerLimit), startsAt: item.startsAt ? item.startsAt.toDate().toISOString().slice(0, 16) : '', expiresAt: item.expiresAt ? item.expiresAt.toDate().toISOString().slice(0, 16) : '', active: item.active });

  return <div className="promotions-page"><h2>{txt('إدارة العروض', 'Promotions')}</h2><p>{txt('أكواد خصم محسوبة ومدققة من السيرفر.', 'Server-calculated and audited discount codes.')}</p>{error ? <div className="promo-error">{error}</div> : null}<form onSubmit={submit}><input required placeholder={txt('الكود', 'Code')} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}/><input required placeholder={txt('الاسم بالعربية', 'Arabic name')} value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })}/><input required placeholder={txt('الاسم بالإنجليزية', 'English name')} value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })}/><select value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value })}><option value="fixed">{txt('مبلغ ثابت', 'Fixed')}</option><option value="percentage">{txt('نسبة', 'Percentage')}</option></select><input required type="number" min="0.01" step="0.01" placeholder={txt('قيمة الخصم', 'Discount value')} value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: e.target.value })}/><input type="number" min="0.01" placeholder={txt('أقصى خصم', 'Max discount')} value={form.maxDiscountIls} onChange={(e) => setForm({ ...form, maxDiscountIls: e.target.value })}/><input type="number" min="0" placeholder={txt('أدنى أجرة', 'Minimum fare')} value={form.minFareIls} onChange={(e) => setForm({ ...form, minFareIls: e.target.value })}/><input type="number" min="1" placeholder={txt('حد الاستخدام العام', 'Global usage limit')} value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: e.target.value })}/><input required type="number" min="1" placeholder={txt('حد الراكب', 'Per rider limit')} value={form.perPassengerLimit} onChange={(e) => setForm({ ...form, perPassengerLimit: e.target.value })}/><input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })}/><input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}/><label><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}/>{txt('فعّال', 'Active')}</label><button disabled={saving}>{saving ? txt('جارٍ الحفظ...', 'Saving...') : txt('حفظ العرض', 'Save promotion')}</button></form><div className="promo-table"><table><thead><tr><th>{txt('الكود', 'Code')}</th><th>{txt('الخصم', 'Discount')}</th><th>{txt('الاستخدام', 'Usage')}</th><th>{txt('الحالة', 'Status')}</th><th></th></tr></thead><tbody>{items.map((item) => <tr key={item.code}><td>{item.code}</td><td>{item.discountType === 'percentage' ? `${item.discountValue}%` : `₪${item.discountValue}`}</td><td>{item.usageCount ?? 0}{item.usageLimit ? ` / ${item.usageLimit}` : ''}</td><td>{item.active ? txt('فعّال', 'Active') : txt('متوقف', 'Disabled')}</td><td><button type="button" onClick={() => edit(item)}>{txt('تعديل', 'Edit')}</button></td></tr>)}</tbody></table></div></div>;
}
