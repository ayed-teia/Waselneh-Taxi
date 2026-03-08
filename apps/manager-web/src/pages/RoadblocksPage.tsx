import { FormEvent, useEffect, useState } from 'react';
import { useI18n } from '../localization';
import {
  RoadblockData,
  createRoadblock,
  deleteRoadblock,
  getRoadblockStatusDisplay,
  subscribeToRoadblocks,
  updateRoadblock,
} from '../services/roadblocks.service';
import './RoadblocksPage.css';

type RoadblockStatus = 'open' | 'closed' | 'congested';

interface CreateFormData {
  name: string;
  area: string;
  lat: string;
  lng: string;
  status: RoadblockStatus;
  note: string;
}

const DEFAULT_FORM: CreateFormData = {
  name: '',
  area: '',
  lat: '32.2226',
  lng: '35.2621',
  status: 'closed',
  note: '',
};

export function RoadblocksPage() {
  const { txt } = useI18n();
  const [roadblocks, setRoadblocks] = useState<RoadblockData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState<CreateFormData>(DEFAULT_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToRoadblocks(
      (data) => {
        setRoadblocks(data);
        setLoading(false);
      },
      (error) => {
        console.error('Roadblocks subscription error:', error);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await createRoadblock({
        name: formData.name,
        area: formData.area,
        lat: parseFloat(formData.lat),
        lng: parseFloat(formData.lng),
        status: formData.status,
        note: formData.note,
        createdBy: 'manager-web',
      });
      setFormData(DEFAULT_FORM);
      setShowCreateForm(false);
    } catch (error) {
      console.error('Failed to create roadblock:', error);
      alert(txt('تعذّر إنشاء إغلاق. حاول مرة أخرى.', 'Failed to create roadblock. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: RoadblockStatus) => {
    try {
      await updateRoadblock(id, { status: newStatus, updatedBy: 'manager-web' });
    } catch (error) {
      console.error('Failed to update status:', error);
      alert(txt('تعذّر تحديث الحالة. حاول مرة أخرى.', 'Failed to update status. Please try again.'));
    }
  };

  const handleNoteUpdate = async (id: string) => {
    try {
      await updateRoadblock(id, { note: editNote, updatedBy: 'manager-web' });
      setEditingId(null);
      setEditNote('');
    } catch (error) {
      console.error('Failed to update note:', error);
      alert(txt('تعذّر تحديث الملاحظة. حاول مرة أخرى.', 'Failed to update note. Please try again.'));
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(txt(`حذف الإغلاق "${name}"؟`, `Delete roadblock "${name}"?`))) return;
    try {
      await deleteRoadblock(id);
    } catch (error) {
      console.error('Failed to delete roadblock:', error);
      alert(txt('تعذّر حذف الإغلاق. حاول مرة أخرى.', 'Failed to delete roadblock. Please try again.'));
    }
  };

  const formatTime = (date: Date | null): string => {
    if (!date) return txt('غير متوفر', 'N/A');
    const mins = Math.floor((Date.now() - date.getTime()) / 60000);
    if (mins < 1) return txt('الآن', 'just now');
    if (mins < 60) return txt(`منذ ${mins} دقيقة`, `${mins}m ago`);
    const hours = Math.floor(mins / 60);
    if (hours < 24) return txt(`منذ ${hours} ساعة`, `${hours}h ago`);
    return txt(`منذ ${Math.floor(hours / 24)} يوم`, `${Math.floor(hours / 24)}d ago`);
  };

  if (loading) {
    return (
      <div className="roadblocks-page">
        <h2>{txt('الإغلاقات', 'Roadblocks')}</h2>
        <div className="loading">{txt('جاري تحميل الإغلاقات...', 'Loading roadblocks...')}</div>
      </div>
    );
  }

  return (
    <div className="roadblocks-page">
      <div className="page-header">
        <div>
          <h2>{txt('الإغلاقات', 'Roadblocks')}</h2>
          <p className="subtitle">
            {txt('إدارة أحداث الطرق، حالة الإغلاق، وملاحظات التشغيل.', 'Manage road events, closure status, and operational notes.')}
          </p>
        </div>
        <button className="btn-create" onClick={() => setShowCreateForm(!showCreateForm)}>
          {showCreateForm ? txt('إلغاء', 'Cancel') : txt('إضافة إغلاق', 'Add Roadblock')}
        </button>
      </div>

      {showCreateForm ? (
        <form className="create-form" onSubmit={handleCreate}>
          <h3>{txt('إنشاء إغلاق جديد', 'Create New Roadblock')}</h3>
          <div className="form-row">
            <div className="form-group">
              <label>{txt('الاسم', 'Name')} *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                placeholder={txt('حاجز الشارع الرئيسي', 'Main Street Checkpoint')}
                required
              />
            </div>
            <div className="form-group">
              <label>{txt('المنطقة', 'Area / Zone')}</label>
              <input
                type="text"
                value={formData.area}
                onChange={(event) => setFormData({ ...formData, area: event.target.value })}
                placeholder={txt('وسط البلد', 'Downtown')}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>{txt('خط العرض', 'Latitude')}</label>
              <input
                type="number"
                step="any"
                value={formData.lat}
                onChange={(event) => setFormData({ ...formData, lat: event.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>{txt('خط الطول', 'Longitude')}</label>
              <input
                type="number"
                step="any"
                value={formData.lng}
                onChange={(event) => setFormData({ ...formData, lng: event.target.value })}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>{txt('الحالة', 'Status')}</label>
              <select
                value={formData.status}
                onChange={(event) =>
                  setFormData({ ...formData, status: event.target.value as RoadblockStatus })
                }
              >
                <option value="closed">{txt('مغلق', 'Closed')}</option>
                <option value="congested">{txt('مزدحم', 'Congested')}</option>
                <option value="open">{txt('مفتوح', 'Open')}</option>
              </select>
            </div>
            <div className="form-group">
              <label>{txt('ملاحظة', 'Note')}</label>
              <input
                type="text"
                value={formData.note}
                onChange={(event) => setFormData({ ...formData, note: event.target.value })}
                placeholder={txt('معلومة إضافية للمشغلين', 'Optional context for dispatchers')}
              />
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn-save" disabled={saving}>
              {saving ? txt('جارٍ الإنشاء...', 'Creating...') : txt('إنشاء الإغلاق', 'Create Roadblock')}
            </button>
          </div>
        </form>
      ) : null}

      <div className="summary-cards">
        <div className="summary-card closed">
          <div className="summary-value">{roadblocks.filter((item) => item.status === 'closed').length}</div>
          <div className="summary-label">{txt('مغلق', 'Closed')}</div>
        </div>
        <div className="summary-card congested">
          <div className="summary-value">{roadblocks.filter((item) => item.status === 'congested').length}</div>
          <div className="summary-label">{txt('مزدحم', 'Congested')}</div>
        </div>
        <div className="summary-card open">
          <div className="summary-value">{roadblocks.filter((item) => item.status === 'open').length}</div>
          <div className="summary-label">{txt('مفتوح', 'Open')}</div>
        </div>
      </div>

      {roadblocks.length === 0 ? (
        <div className="empty-state">
          <p>{txt('لا توجد إغلاقات حاليًا.', 'No roadblocks found.')}</p>
          <button onClick={() => setShowCreateForm(true)}>{txt('إنشاء أول إغلاق', 'Create first roadblock')}</button>
        </div>
      ) : (
        <div className="roadblocks-list">
          {roadblocks.map((roadblock) => {
            const statusDisplay = getRoadblockStatusDisplay(roadblock.status);
            const isEditing = editingId === roadblock.id;

            return (
              <div key={roadblock.id} className={`roadblock-card status-${roadblock.status}`}>
                <div className="roadblock-header">
                  <div className="roadblock-name">
                    <span className="status-emoji">{statusDisplay.emoji}</span>
                    <span className="name">{roadblock.name}</span>
                    {roadblock.area ? <span className="area">({roadblock.area})</span> : null}
                  </div>
                  <div className="roadblock-actions">
                    <select
                      value={roadblock.status}
                      onChange={(event) =>
                        handleStatusChange(roadblock.id, event.target.value as RoadblockStatus)
                      }
                      className={`status-select status-${roadblock.status}`}
                    >
                      <option value="closed">{txt('مغلق', 'Closed')}</option>
                      <option value="congested">{txt('مزدحم', 'Congested')}</option>
                      <option value="open">{txt('مفتوح', 'Open')}</option>
                    </select>
                    <button
                      className="btn-delete"
                      onClick={() => handleDelete(roadblock.id, roadblock.name)}
                      title={txt('حذف الإغلاق', 'Delete roadblock')}
                    >
                      {txt('حذف', 'Delete')}
                    </button>
                  </div>
                </div>

                <div className="roadblock-details">
                  <span className="coords">
                    {roadblock.lat.toFixed(4)}, {roadblock.lng.toFixed(4)}
                  </span>
                  <span className="updated">{txt('آخر تحديث', 'Updated')}: {formatTime(roadblock.updatedAt)}</span>
                </div>

                <div className="roadblock-note">
                  {isEditing ? (
                    <div className="note-edit">
                      <input
                        type="text"
                        value={editNote}
                        onChange={(event) => setEditNote(event.target.value)}
                        placeholder={txt('اكتب الملاحظة...', 'Enter note...')}
                        autoFocus
                      />
                      <button onClick={() => handleNoteUpdate(roadblock.id)}>{txt('حفظ', 'Save')}</button>
                      <button
                        onClick={() => {
                          setEditingId(null);
                          setEditNote('');
                        }}
                      >
                        {txt('إلغاء', 'Cancel')}
                      </button>
                    </div>
                  ) : (
                    <div
                      className="note-display"
                      onClick={() => {
                        setEditingId(roadblock.id);
                        setEditNote(roadblock.note || '');
                      }}
                    >
                      {roadblock.note ? (
                        <span className="note-text">{roadblock.note}</span>
                      ) : (
                        <span className="note-placeholder">{txt('اضغط لإضافة ملاحظة...', 'Click to add a note...')}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
