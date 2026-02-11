import { useEffect, useState } from 'react';
import { 
  subscribeToRoadblocks, 
  createRoadblock, 
  updateRoadblock, 
  deleteRoadblock,
  getRoadblockStatusDisplay,
  RoadblockData 
} from '../services/roadblocks.service';
import './RoadblocksPage.css';

/**
 * ============================================================================
 * ROADBLOCKS MANAGEMENT PAGE
 * ============================================================================
 * 
 * Manager can:
 * - View all roadblocks (realtime)
 * - Create new roadblock
 * - Update status (open / closed / congested)
 * - Update note
 * - Delete roadblock
 * 
 * ============================================================================
 */

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
  const [roadblocks, setRoadblocks] = useState<RoadblockData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState<CreateFormData>(DEFAULT_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Subscribe to roadblocks
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

  // Handle create roadblock
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
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
      console.log('🚧 Roadblock status updated');
    } catch (error) {
      console.error('Failed to create roadblock:', error);
      alert('Failed to create roadblock');
    } finally {
      setSaving(false);
    }
  };

  // Handle status change
  const handleStatusChange = async (id: string, newStatus: RoadblockStatus) => {
    try {
      await updateRoadblock(id, { status: newStatus, updatedBy: 'manager-web' });
      console.log('🚧 Roadblock status updated');
    } catch (error) {
      console.error('Failed to update status:', error);
      alert('Failed to update status');
    }
  };

  // Handle note update
  const handleNoteUpdate = async (id: string) => {
    try {
      await updateRoadblock(id, { note: editNote, updatedBy: 'manager-web' });
      setEditingId(null);
      setEditNote('');
      console.log('🚧 Roadblock status updated');
    } catch (error) {
      console.error('Failed to update note:', error);
      alert('Failed to update note');
    }
  };

  // Handle delete
  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete roadblock "${name}"?`)) return;
    try {
      await deleteRoadblock(id);
    } catch (error) {
      console.error('Failed to delete roadblock:', error);
      alert('Failed to delete roadblock');
    }
  };

  // Format relative time
  const formatTime = (date: Date | null): string => {
    if (!date) return 'N/A';
    const mins = Math.floor((Date.now() - date.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  if (loading) {
    return (
      <div className="roadblocks-page">
        <h1>🚧 Roadblocks</h1>
        <div className="loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="roadblocks-page">
      <div className="page-header">
        <h1>🚧 Roadblocks</h1>
        <button 
          className="btn-create"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          {showCreateForm ? 'Cancel' : '+ Add Roadblock'}
        </button>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <form className="create-form" onSubmit={handleCreate}>
          <h3>Create New Roadblock</h3>
          <div className="form-row">
            <div className="form-group">
              <label>Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Main Street Checkpoint"
                required
              />
            </div>
            <div className="form-group">
              <label>Area / Zone</label>
              <input
                type="text"
                value={formData.area}
                onChange={(e) => setFormData({ ...formData, area: e.target.value })}
                placeholder="e.g., Downtown"
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Latitude</label>
              <input
                type="number"
                step="any"
                value={formData.lat}
                onChange={(e) => setFormData({ ...formData, lat: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Longitude</label>
              <input
                type="number"
                step="any"
                value={formData.lng}
                onChange={(e) => setFormData({ ...formData, lng: e.target.value })}
                required
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as RoadblockStatus })}
              >
                <option value="closed">🚫 Closed</option>
                <option value="congested">⚠️ Congested</option>
                <option value="open">✅ Open</option>
              </select>
            </div>
            <div className="form-group">
              <label>Note</label>
              <input
                type="text"
                value={formData.note}
                onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                placeholder="Optional description..."
              />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-save" disabled={saving}>
              {saving ? 'Creating...' : 'Create Roadblock'}
            </button>
          </div>
        </form>
      )}

      {/* Summary */}
      <div className="summary-cards">
        <div className="summary-card closed">
          <div className="summary-value">
            {roadblocks.filter(r => r.status === 'closed').length}
          </div>
          <div className="summary-label">Closed</div>
        </div>
        <div className="summary-card congested">
          <div className="summary-value">
            {roadblocks.filter(r => r.status === 'congested').length}
          </div>
          <div className="summary-label">Congested</div>
        </div>
        <div className="summary-card open">
          <div className="summary-value">
            {roadblocks.filter(r => r.status === 'open').length}
          </div>
          <div className="summary-label">Open</div>
        </div>
      </div>

      {/* Roadblocks List */}
      {roadblocks.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">🚧</span>
          <p>No roadblocks yet</p>
          <button onClick={() => setShowCreateForm(true)}>Add your first roadblock</button>
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
                    {roadblock.area && <span className="area">({roadblock.area})</span>}
                  </div>
                  <div className="roadblock-actions">
                    <select
                      value={roadblock.status}
                      onChange={(e) => handleStatusChange(roadblock.id, e.target.value as RoadblockStatus)}
                      className={`status-select status-${roadblock.status}`}
                    >
                      <option value="closed">🚫 Closed</option>
                      <option value="congested">⚠️ Congested</option>
                      <option value="open">✅ Open</option>
                    </select>
                    <button
                      className="btn-delete"
                      onClick={() => handleDelete(roadblock.id, roadblock.name)}
                      title="Delete roadblock"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
                
                <div className="roadblock-details">
                  <span className="coords">
                    📍 {roadblock.lat.toFixed(4)}, {roadblock.lng.toFixed(4)}
                  </span>
                  <span className="updated">
                    Updated: {formatTime(roadblock.updatedAt)}
                  </span>
                </div>

                <div className="roadblock-note">
                  {isEditing ? (
                    <div className="note-edit">
                      <input
                        type="text"
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        placeholder="Enter note..."
                        autoFocus
                      />
                      <button onClick={() => handleNoteUpdate(roadblock.id)}>Save</button>
                      <button onClick={() => { setEditingId(null); setEditNote(''); }}>Cancel</button>
                    </div>
                  ) : (
                    <div className="note-display" onClick={() => { setEditingId(roadblock.id); setEditNote(roadblock.note || ''); }}>
                      {roadblock.note ? (
                        <span className="note-text">{roadblock.note}</span>
                      ) : (
                        <span className="note-placeholder">Click to add note...</span>
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
