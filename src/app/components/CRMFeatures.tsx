import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Calendar, Phone, Mail, CheckCircle, Clock, FileText } from 'lucide-react';
import { DealData } from '../types';
import {
  DealActivityRecord,
  getDealStorageId,
  readSavedDeals,
  SavedDealRecord,
  upsertSavedDeal,
  writeSavedDeals,
} from '../utils/dealStorage';

type DealNote = DealActivityRecord;

interface FollowUp {
  id: string;
  dealId: string;
  address: string;
  date: string;
  time: string;
  description: string;
  completed: boolean;
}

interface CRMFeaturesProps {
  deal: DealData;
  onLoadDeal: (deal: DealData) => void;
}

export function CRMFeatures({ deal, onLoadDeal }: CRMFeaturesProps) {
  const [notes, setNotes] = useState<DealNote[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [savedDeals, setSavedDeals] = useState<SavedDealRecord[]>([]);
  const [newNote, setNewNote] = useState('');
  const [newFollowUp, setNewFollowUp] = useState({ date: '', time: '', description: '' });
  const [noteType, setNoteType] = useState<Extract<DealNote['type'], 'note' | 'call' | 'email' | 'meeting' | 'pdf'>>('note');
  const currentDealId = getDealStorageId(deal);
  const currentDealLabel = deal.address || 'Unsaved analyzer deal';
  const noteTypeLabels: Record<DealNote['type'], string> = {
    note: 'Note',
    call: 'Call Note',
    email: 'Email Sent',
    meeting: 'Meeting',
    pdf: 'Document',
  };
  const statusLabels: Record<SavedDealRecord['status'], string> = {
    active: 'Working',
    pending: 'Waiting',
    closed: 'Closed',
    archived: 'Archived',
  };

  const currentNotes = useMemo(
    () => notes.filter((note) => note.dealId === currentDealId),
    [notes, currentDealId],
  );
  const currentFollowUps = useMemo(
    () => followUps.filter((followUp) => followUp.dealId === currentDealId),
    [followUps, currentDealId],
  );

  useEffect(() => {
    const hydrateActivity = () => {
      const savedNotes = localStorage.getItem('pbk-notes');
      const savedFollowUps = localStorage.getItem('pbk-followups');

      if (savedNotes) setNotes(JSON.parse(savedNotes));
      if (savedFollowUps) setFollowUps(JSON.parse(savedFollowUps));
    };

    hydrateActivity();
    setSavedDeals(readSavedDeals());

    const handleSavedDeal = () => {
      setSavedDeals(readSavedDeals());
      hydrateActivity();
    };
    window.addEventListener('pbk:deal-saved', handleSavedDeal);
    window.addEventListener('pbk:deal-activity', handleSavedDeal);
    window.addEventListener('storage', handleSavedDeal);

    return () => {
      window.removeEventListener('pbk:deal-saved', handleSavedDeal);
      window.removeEventListener('pbk:deal-activity', handleSavedDeal);
      window.removeEventListener('storage', handleSavedDeal);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('pbk-notes', JSON.stringify(notes));
  }, [notes]);

  useEffect(() => {
    localStorage.setItem('pbk-followups', JSON.stringify(followUps));
  }, [followUps]);

  const canAttachToDeal = currentDealId !== 'unsaved';

  const addNote = () => {
    if (!newNote.trim() || !canAttachToDeal) return;

    const note: DealNote = {
      id: Date.now().toString(),
      dealId: currentDealId,
      address: currentDealLabel,
      timestamp: new Date().toLocaleString(),
      content: newNote,
      type: noteType,
    };

    setNotes([note, ...notes]);
    setNewNote('');
  };

  const deleteNote = (id: string) => {
    setNotes(notes.filter((note) => note.id !== id));
  };

  const addFollowUp = () => {
    if (!newFollowUp.date || !newFollowUp.description || !canAttachToDeal) return;

    const followUp: FollowUp = {
      id: Date.now().toString(),
      dealId: currentDealId,
      address: currentDealLabel,
      ...newFollowUp,
      completed: false,
    };

    setFollowUps([...followUps, followUp]);
    setNewFollowUp({ date: '', time: '', description: '' });
  };

  const toggleFollowUp = (id: string) => {
    setFollowUps(
      followUps.map((followUp) =>
        followUp.id === id ? { ...followUp, completed: !followUp.completed } : followUp,
      ),
    );
  };

  const deleteFollowUp = (id: string) => {
    setFollowUps(followUps.filter((followUp) => followUp.id !== id));
  };

  const saveCurrentDeal = () => {
    try {
      const saved = upsertSavedDeal(deal);
      setSavedDeals(readSavedDeals());
      window.dispatchEvent(new CustomEvent('pbk:deal-saved', { detail: saved }));
    } catch (error) {
      console.error('Could not save deal from CRM', error);
    }
  };

  const deleteDeal = (id: string) => {
    if (confirm('Are you sure you want to delete this saved deal?')) {
      const next = savedDeals.filter((savedDeal) => savedDeal.id !== id);
      setSavedDeals(next);
      writeSavedDeals(next);
    }
  };

  const updateDealStatus = (id: string, status: SavedDealRecord['status']) => {
    const next = savedDeals.map((savedDeal) =>
      savedDeal.id === id
        ? { ...savedDeal, status, lastUpdated: new Date().toLocaleString() }
        : savedDeal,
    );
    setSavedDeals(next);
    writeSavedDeals(next);
  };

  const getNoteIcon = (type: DealNote['type']) => {
    switch (type) {
      case 'call':
        return <Phone size={14} className="text-blue-500" />;
      case 'email':
        return <Mail size={14} className="text-purple-500" />;
      case 'meeting':
        return <Calendar size={14} className="text-green-500" />;
      case 'pdf':
        return <FileText size={14} className="text-emerald-500" />;
      default:
        return <div className="w-2 h-2 rounded-full bg-gray-400" />;
    }
  };

  const getStatusColor = (status: SavedDealRecord['status']) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400';
      case 'closed':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400';
      case 'archived':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400';
    }
  };

  return (
    <div className="p-3.5 space-y-3">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-[12px] text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
        CRM notes and follow-ups are scoped to:
        <strong className="ml-1">{currentDealLabel}</strong>
        {!canAttachToDeal ? ' - enter an address in Analyzer before saving activity.' : ''}
      </div>

      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
          <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
            Deal Notes & Activity
          </h3>
        </div>

        <div className="flex gap-2 mb-3 flex-wrap">
          {(['note', 'call', 'email', 'meeting', 'pdf'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setNoteType(type)}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                noteType === type
                  ? type === 'call'
                    ? 'bg-blue-500 text-white'
                    : type === 'email'
                      ? 'bg-purple-500 text-white'
                      : type === 'meeting'
                        ? 'bg-green-500 text-white'
                        : type === 'pdf'
                          ? 'bg-emerald-500 text-white'
                          : 'bg-gray-900 dark:bg-slate-700 text-white'
                  : 'bg-gray-100 dark:bg-slate-900 text-gray-600 dark:text-gray-400'
              }`}
            >
              {type === 'call' ? <Phone size={10} className="inline mr-1" /> : null}
              {type === 'email' ? <Mail size={10} className="inline mr-1" /> : null}
              {type === 'meeting' ? <Calendar size={10} className="inline mr-1" /> : null}
              {type === 'pdf' ? <FileText size={10} className="inline mr-1" /> : null}
              {noteTypeLabels[type]}
            </button>
          ))}
        </div>

        <div className="flex gap-2 mb-3">
          <textarea
            value={newNote}
            onChange={(event) => setNewNote(event.target.value)}
            placeholder={canAttachToDeal ? 'Add a note about this deal...' : 'Enter a property address in Analyzer first...'}
            disabled={!canAttachToDeal}
            className="flex-1 h-20 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 resize-none disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            onClick={addNote}
            disabled={!canAttachToDeal}
            className="px-4 h-20 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {currentNotes.map((note) => (
            <div
              key={note.id}
              className="flex items-start gap-2 p-2.5 bg-gray-50 dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700"
            >
              <div className="mt-1">{getNoteIcon(note.type)}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-gray-900 dark:text-gray-100 leading-relaxed">
                  {note.content}
                </div>
                <div className="text-[9px] text-gray-500 dark:text-gray-400 mt-1">
                  {note.timestamp}
                </div>
              </div>
              <button
                onClick={() => deleteNote(note.id)}
                className="text-gray-400 hover:text-red-500 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {currentNotes.length === 0 && (
            <div className="text-center py-6 text-[11px] text-gray-400">
              No notes for this deal yet.
            </div>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
          <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
            Follow-up Reminders
          </h3>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-2">
          <input
            type="date"
            value={newFollowUp.date}
            onChange={(event) => setNewFollowUp({ ...newFollowUp, date: event.target.value })}
            disabled={!canAttachToDeal}
            className="h-9 px-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <input
            type="time"
            value={newFollowUp.time}
            onChange={(event) => setNewFollowUp({ ...newFollowUp, time: event.target.value })}
            disabled={!canAttachToDeal}
            className="h-9 px-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newFollowUp.description}
            onChange={(event) => setNewFollowUp({ ...newFollowUp, description: event.target.value })}
            placeholder={canAttachToDeal ? 'Follow-up description...' : 'Enter a property address first...'}
            disabled={!canAttachToDeal}
            className="flex-1 h-9 px-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            onClick={addFollowUp}
            disabled={!canAttachToDeal}
            className="px-4 h-9 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-all text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={14} className="inline mr-1" />
            Add
          </button>
        </div>

        <div className="space-y-2 max-h-48 overflow-y-auto">
          {currentFollowUps.map((followUp) => (
            <div
              key={followUp.id}
              className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all ${
                followUp.completed
                  ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700 opacity-60'
                  : 'bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-700'
              }`}
            >
              <button onClick={() => toggleFollowUp(followUp.id)} className="flex-shrink-0">
                {followUp.completed ? (
                  <CheckCircle size={16} className="text-green-500" />
                ) : (
                  <Clock size={16} className="text-gray-400" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <div
                  className={`text-[11px] font-medium ${
                    followUp.completed
                      ? 'text-gray-500 dark:text-gray-400 line-through'
                      : 'text-gray-900 dark:text-gray-100'
                  }`}
                >
                  {followUp.description}
                </div>
                <div className="text-[9px] text-gray-500 dark:text-gray-400">
                  {new Date(followUp.date).toLocaleDateString()} {followUp.time && `at ${followUp.time}`}
                </div>
              </div>
              <button
                onClick={() => deleteFollowUp(followUp.id)}
                className="text-gray-400 hover:text-red-500 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {currentFollowUps.length === 0 && (
            <div className="text-center py-6 text-[11px] text-gray-400">
              No follow-ups scheduled for this deal.
            </div>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3 gap-3">
          <div className="flex items-center gap-2">
            <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
              Saved Deals
            </h3>
          </div>
          <button
            onClick={saveCurrentDeal}
            disabled={!canAttachToDeal}
            className="px-3 py-1 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={12} className="inline mr-1" />
            Save This Deal
          </button>
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {savedDeals.map((savedDeal) => (
            <div
              key={savedDeal.id}
              className="p-3 bg-gray-50 dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {savedDeal.address}
                  </div>
                  <div className="text-[9px] text-gray-500 dark:text-gray-400">
                    Updated: {savedDeal.lastUpdated}
                  </div>
                </div>
                <button
                  onClick={() => deleteDeal(savedDeal.id)}
                  className="text-gray-400 hover:text-red-500 transition-colors ml-2"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="flex gap-1 mb-2 flex-wrap">
                {(['active', 'pending', 'closed', 'archived'] as const).map((status) => (
                  <button
                    key={status}
                    onClick={() => updateDealStatus(savedDeal.id, status)}
                    className={`px-2 py-0.5 rounded text-[9px] font-medium capitalize transition-all ${
                      savedDeal.status === status
                        ? getStatusColor(status)
                        : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {statusLabels[status]}
                  </button>
                ))}
              </div>

              <button
                onClick={() => onLoadDeal(savedDeal.dealData)}
                className="w-full px-3 py-1.5 bg-blue-500 text-white rounded text-[11px] font-medium hover:bg-blue-600 transition-all"
              >
                Open Deal
              </button>
            </div>
          ))}
          {savedDeals.length === 0 && (
            <div className="text-center py-6 text-[11px] text-gray-400">
              No saved deals. Save your current deal to track it here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
