import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '', showLabel = false }) => {
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <button
      onClick={toggleTheme}
      className={`group relative p-2.5 text-[#777777] hover:text-[#111111] dark:text-[#A0A0A0] dark:hover:text-[#FFFFFF] bg-[#FFFFFF] hover:bg-[#F0F0EE] dark:bg-[#141416] dark:hover:bg-[#1C1C1F] border border-[#E2E2E0] hover:border-[#C8C8C5] dark:border-[#26262B] dark:hover:border-[#3A3A40] rounded-xl transition-all duration-150 shadow-xs active:scale-95 flex items-center gap-2 ${className}`}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      <div className="relative w-4 h-4 flex items-center justify-center">
        {isDark ? (
          <Sun className="w-4 h-4 text-[#FFFFFF] transition-transform duration-300 group-hover:rotate-45 group-hover:scale-110" />
        ) : (
          <Moon className="w-4 h-4 text-[#111111] transition-transform duration-300 group-hover:-rotate-12 group-hover:scale-110" />
        )}
      </div>
      {showLabel && (
        <span className="text-[11px] font-mono uppercase tracking-wider font-semibold text-[#111111] dark:text-[#FFFFFF]">
          {isDark ? 'Light' : 'Dark'} Mode
        </span>
      )}
    </button>
  );
};
