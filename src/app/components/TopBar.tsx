import { Menu, Phone, FileText, Printer, RotateCcw } from 'lucide-react';

interface TopBarProps {
  address: string;
  verdict: 'none' | 'green' | 'yellow' | 'red';
  onMenuToggle: () => void;
  onCallModeClick: () => void;
  onDocsClick: () => void;
  onPrint: () => void;
  onReset: () => void;
  darkMode: boolean;
  onDarkModeToggle: () => void;
}

export function TopBar({
  address,
  verdict,
  onMenuToggle,
  onCallModeClick,
  onDocsClick,
  onPrint,
  onReset,
  darkMode,
  onDarkModeToggle,
}: TopBarProps) {
  const verdictColors = {
    none: 'bg-gray-700 text-gray-400',
    green: 'bg-green-100 text-green-800',
    yellow: 'bg-yellow-100 text-yellow-800',
    red: 'bg-red-100 text-red-800',
  };

  const verdictText = {
    none: 'Not analyzed',
    green: 'Go',
    yellow: 'Review',
    red: 'Pass',
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-[54px] bg-black/90 backdrop-blur-xl flex items-center gap-1.5 px-3.5 border-b border-blue-500/35 shadow-lg">
      <button
        onClick={onMenuToggle}
        className="md:hidden p-2 text-white hover:bg-white/10 rounded"
      >
        <Menu size={20} />
      </button>
      
      <div className="bg-blue-500/12 px-3 py-1 rounded-full font-bold text-blue-500 text-[15px] tracking-tight">
        PBK
      </div>
      
      <div className="hidden md:block flex-1 text-[12px] text-white/65 truncate">
        {address || 'No property loaded'}
      </div>
      
      <div className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap ${verdictColors[verdict]}`}>
        {verdictText[verdict]}
      </div>
      
      <button
        onClick={onCallModeClick}
        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium text-white/80 hover:text-white hover:bg-white/10 border border-white/10 transition-all whitespace-nowrap"
      >
        <Phone size={12} />
        <span className="hidden sm:inline">Call</span>
      </button>
      
      <button
        onClick={onDarkModeToggle}
        className="relative w-10 h-5.5 bg-gray-700 rounded-full flex-shrink-0 transition-colors"
        style={{ backgroundColor: darkMode ? '#2A97DA' : '#334155' }}
      >
        <div
          className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform"
          style={{ transform: darkMode ? 'translateX(18px)' : 'translateX(0)' }}
        />
      </button>
      
      <button
        onClick={onDocsClick}
        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium text-white/80 hover:text-white hover:bg-white/10 border border-white/10 transition-all whitespace-nowrap"
      >
        <FileText size={12} />
        <span className="hidden sm:inline">Docs</span>
      </button>
      
      <button
        onClick={onPrint}
        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium text-white/80 hover:text-white hover:bg-white/10 border border-white/10 transition-all whitespace-nowrap"
      >
        <Printer size={12} />
      </button>
      
      <span className="text-[10px] text-white/45 whitespace-nowrap hidden lg:inline">
        Auto-saved
      </span>
      
      <button
        onClick={onReset}
        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium text-white bg-red-600 hover:bg-red-700 transition-colors whitespace-nowrap"
      >
        <RotateCcw size={12} />
        <span className="hidden sm:inline">Reset</span>
      </button>
    </div>
  );
}
