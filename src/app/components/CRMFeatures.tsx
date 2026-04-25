import { useState, useEffect } from 'react';
import { Plus, Trash2, Calendar, Phone, Mail, CheckCircle, Clock } from 'lucide-react';

interface DealNote {
  id: string;
  timestamp: string;
  content: string;
  type: 'note' | 'call' | 'email' | 'meeting';
}

interface FollowUp {
  id: string;
  date: string;
  time: string;
  description: string;
  completed: boolean;
}

interface SavedDeal {
  id: string;
  address: string;
  status: 'active' | 'pending' | 'closed' | 'archived';
  lastUpdated: string;
  dealData: any;
}

export function CRMFeatures() {
  const [notes, setNotes] = useState<DealNote[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [savedDeals, setSavedDeals] = useState<SavedDeal[]>([]);
  const [newNote, setNewNote] = useState('');
  const [newFollowUp, setNewFollowUp] = useState({ date: '', time: '', description: '' });
  const [noteType, setNoteType] = useState<DealNote['type']>('note');

  // Load data from localStorage
  useEffect(() => {
    const savedNotes = localStorage.getItem('pbk-notes');
    const savedFollowUps = localStorage.getItem('pbk-followups');
    const savedDealsData = localStorage.getItem('pbk-saved-deals');

    if (savedNotes) setNotes(JSON.parse(savedNotes));
    if (savedFollowUps) setFollowUps(JSON.parse(savedFollowUps));
    if (savedDealsData) setSavedDeals(JSON.parse(savedDealsData));
  }, []);

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem('pbk-notes', JSON.stringify(notes));
  }, [notes]);

  useEffect(() => {
    localStorage.setItem('pbk-followups', JSON.stringify(followUps));
  }, [followUps]);

  useEffect(() => {
    localStorage.setItem('pbk-saved-deals', JSON.stringify(savedDeals));
  }, [savedDeals]);

  const addNote = () => {
    if (!newNote.trim()) return;

    const note: DealNote = {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleString(),
      content: newNote,
      type: noteType,
    };

    setNotes([note, ...notes]);
    setNewNote('');
  };

  const deleteNote = (id: string) => {
    setNotes(notes.filter(n => n.id !== id));
  };

  const addFollowUp = () => {
    if (!newFollowUp.date || !newFollowUp.description) return;

    const followUp: FollowUp = {
      id: Date.now().toString(),
      ...newFollowUp,
      completed: false,
    };

    setFollowUps([...followUps, followUp]);
    setNewFollowUp({ date: '', time: '', description: '' });
  };

  const toggleFollowUp = (id: string) => {
    setFollowUps(followUps.map(f => 
      f.id === id ? { ...f, completed: !f.completed } : f
    ));
  };

  const deleteFollowUp = (id: string) => {
    setFollowUps(followUps.filter(f => f.id !== id));
  };

  const saveCurrentDeal = () => {
    const currentDeal = localStorage.getItem('pbk-deal-data');
    if (!currentDeal) return;

    const dealData = JSON.parse(currentDeal);
    const deal: SavedDeal = {
      id: Date.now().toString(),
      address: dealData.address || 'Untitled Deal',
      status: 'active',
      lastUpdated: new Date().toLocaleString(),
      dealData,
    };

    setSavedDeals([deal, ...savedDeals]);
  };

  const loadDeal = (deal: SavedDeal) => {
    localStorage.setItem('pbk-deal-data', JSON.stringify(deal.dealData));
    window.location.reload();
  };

  const deleteDeal = (id: string) => {
    if (confirm('Are you sure you want to delete this saved deal?')) {
      setSavedDeals(savedDeals.filter(d => d.id !== id));
    }
  };

  const updateDealStatus = (id: string, status: SavedDeal['status']) => {
    setSavedDeals(savedDeals.map(d => 
      d.id === id ? { ...d, status, lastUpdated: new Date().toLocaleString() } : d
    ));
  };

  const getNoteIcon = (type: DealNote['type']) => {
    switch (type) {
      case 'call': return <Phone size={14} className="text-blue-500" />;
      case 'email': return <Mail size={14} className="text-purple-500" />;
      case 'meeting': return <Calendar size={14} className="text-green-500" />;
      default: return <div className="w-2 h-2 rounded-full bg-gray-400" />;
    }
  };

  const getStatusColor = (status: SavedDeal['status']) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400';
      case 'pending': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400';
      case 'closed': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400';
      case 'archived': return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400';
    }
  };

  return (
    <div className="p-3.5 space-y-3">
      {/* Deal Notes */}
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
          <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
            Deal Notes & Activity
          </h3>
        </div>

        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setNoteType('note')}
            className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
              noteType === 'note' ? 'bg-gray-900 dark:bg-slate-700 text-white' : 'bg-gray-100 dark:bg-slate-900 text-gray-600 dark:text-gray-400'
            }`}
          >
            Note
          </button>
          <button
            onClick={() => setNoteType('call')}
            className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
              noteType === 'call' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-slate-900 text-gray-600 dark:text-gray-400'
            }`}
          >
            <Phone size={10} className="inline mr-1" />
            Call
          </button>
          <button
            onClick={() => setNoteType('email')}
            className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
              noteType === 'email' ? 'bg-purple-500 text-white' : 'bg-gray-100 dark:bg-slate-900 text-gray-600 dark:text-gray-400'
            }`}
          >
            <Mail size={10} className="inline mr-1" />
            Email
          </button>
          <button
            onClick={() => setNoteType('meeting')}
            className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
              noteType === 'meeting' ? 'bg-green-500 text-white' : 'bg-gray-100 dark:bg-slate-900 text-gray-600 dark:text-gray-400'
            }`}
          >
            <Calendar size={10} className="inline mr-1" />
            Meeting
          </button>
        </div>

        <div className="flex gap-2 mb-3">
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a note about this deal..."
            className="flex-1 h-20 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500 resize-none"
          />
          <button
            onClick={addNote}
            className="px-4 h-20 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {notes.map((note) => (
            <div
              key={note.id}
              className="flex items-start gap-2 p-2.5 bg-gray-50 dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700"
            >
              <div className="mt-1">
                {getNoteIcon(note.type)}
              </div>
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
          {notes.length === 0 && (
            <div className="text-center py-6 text-[11px] text-gray-400">
              No notes yet. Add your first note above.
            </div>
          )}
        </div>
      </div>

      {/* Follow-ups */}
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
            onChange={(e) => setNewFollowUp({ ...newFollowUp, date: e.target.value })}
            className="h-9 px-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500"
          />
          <input
            type="time"
            value={newFollowUp.time}
            onChange={(e) => setNewFollowUp({ ...newFollowUp, time: e.target.value })}
            className="h-9 px-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newFollowUp.description}
            onChange={(e) => setNewFollowUp({ ...newFollowUp, description: e.target.value })}
            placeholder="Follow-up description..."
            className="flex-1 h-9 px-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12px] outline-none focus:border-blue-500"
          />
          <button
            onClick={addFollowUp}
            className="px-4 h-9 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-all text-[12px] font-medium"
          >
            <Plus size={14} className="inline mr-1" />
            Add
          </button>
        </div>

        <div className="space-y-2 max-h-48 overflow-y-auto">
          {followUps.map((followUp) => (
            <div
              key={followUp.id}
              className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all ${
                followUp.completed
                  ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700 opacity-60'
                  : 'bg-gray-50 dark:bg-slate-900 border-gray-200 dark:border-slate-700'
              }`}
            >
              <button
                onClick={() => toggleFollowUp(followUp.id)}
                className="flex-shrink-0"
              >
                {followUp.completed ? (
                  <CheckCircle size={16} className="text-green-500" />
                ) : (
                  <Clock size={16} className="text-gray-400" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <div className={`text-[11px] font-medium ${
                  followUp.completed 
                    ? 'text-gray-500 dark:text-gray-400 line-through' 
                    : 'text-gray-900 dark:text-gray-100'
                }`}>
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
          {followUps.length === 0 && (
            <div className="text-center py-6 text-[11px] text-gray-400">
              No follow-ups scheduled.
            </div>
          )}
        </div>
      </div>

      {/* Saved Deals */}
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
              Saved Deals
            </h3>
          </div>
          <button
            onClick={saveCurrentDeal}
            className="px-3 py-1 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all text-[11px] font-medium"
          >
            <Plus size={12} className="inline mr-1" />
            Save Current
          </button>
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {savedDeals.map((deal) => (
            <div
              key={deal.id}
              className="p-3 bg-gray-50 dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {deal.address}
                  </div>
                  <div className="text-[9px] text-gray-500 dark:text-gray-400">
                    Updated: {deal.lastUpdated}
                  </div>
                </div>
                <button
                  onClick={() => deleteDeal(deal.id)}
                  className="text-gray-400 hover:text-red-500 transition-colors ml-2"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              
              <div className="flex gap-1 mb-2">
                {(['active', 'pending', 'closed', 'archived'] as const).map((status) => (
                  <button
                    key={status}
                    onClick={() => updateDealStatus(deal.id, status)}
                    className={`px-2 py-0.5 rounded text-[9px] font-medium capitalize transition-all ${
                      deal.status === status
                        ? getStatusColor(status)
                        : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>

              <button
                onClick={() => loadDeal(deal)}
                className="w-full px-3 py-1.5 bg-blue-500 text-white rounded text-[11px] font-medium hover:bg-blue-600 transition-all"
              >
                Load Deal
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
