import React, { useState, useEffect, useRef } from 'react';
import { Search, Loader2, MapPin } from 'lucide-react';
import { GeocodeResult } from '../types';
import { searchGeocode } from '../api/client';

interface AutocompleteDropdownProps {
  onSelectAndAdd: (result: GeocodeResult) => void;
}

export const AutocompleteDropdown: React.FC<AutocompleteDropdownProps> = ({
  onSelectAndAdd,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const matches = await searchGeocode(query);
        setResults(matches);
        setIsOpen(matches.length > 0);
      } catch {
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [query]);

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (item: GeocodeResult) => {
    onSelectAndAdd(item);
    setQuery('');
    setIsOpen(false);
    setResults([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      handleSelect(results[0]);
    }
  };

  return (
    <div ref={wrapperRef} className="relative w-64 md:w-80">
      <div className="relative flex items-center">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder="Add location (e.g. Seattle, Paris)..."
          className="w-full pl-9 pr-9 py-1.5 bg-dark-800 text-gray-100 text-xs placeholder-gray-400 rounded-lg border border-dark-600 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition"
        />
        {isLoading && (
          <Loader2 className="w-3.5 h-3.5 text-sky-400 absolute right-3 animate-spin" />
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-dark-800 border border-dark-600 rounded-lg shadow-2xl overflow-hidden z-50 max-h-60 overflow-y-auto divide-y divide-dark-700">
          {results.map((item, idx) => (
            <button
              key={`${item.name}-${item.latitude}-${item.longitude}-${idx}`}
              onClick={() => handleSelect(item)}
              className="w-full px-3 py-2 text-left hover:bg-dark-700/80 transition flex items-center gap-2 group"
            >
              <MapPin className="w-3.5 h-3.5 text-sky-400 shrink-0 group-hover:scale-110 transition" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-gray-100 truncate">
                  {item.name}
                </div>
                <div className="text-[11px] text-gray-400 truncate">
                  {[item.admin1, item.country].filter(Boolean).join(', ')}
                </div>
              </div>
              <span className="text-[10px] text-gray-500 font-mono">
                {item.latitude.toFixed(2)}°, {item.longitude.toFixed(2)}°
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

