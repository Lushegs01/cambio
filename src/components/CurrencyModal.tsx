/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { X, Search, Check, RefreshCw, AlertCircle, Globe } from 'lucide-react';
import { useCurrency } from '../context/CurrencyContext';
import { SupportedCurrency, FiatCurrencyCode } from '../types';

interface CurrencyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CurrencyModal: React.FC<CurrencyModalProps> = ({ isOpen, onClose }) => {
  const {
    preferredCurrency,
    setCurrency,
    supportedCurrencies,
    rateStatus,
    lastUpdated,
    rateSource,
    refreshRates,
    isRefreshing,
    errorMessage,
  } = useCurrency();

  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus search input when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Filter currencies based on search query
  const filteredCurrencies = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return supportedCurrencies;

    return supportedCurrencies.filter((curr) => {
      return (
        curr.code.toLowerCase().includes(query) ||
        curr.name.toLowerCase().includes(query) ||
        curr.symbol.toLowerCase().includes(query)
      );
    });
  }, [supportedCurrencies, searchQuery]);

  // Format last updated time
  const formattedLastUpdated = useMemo(() => {
    if (!lastUpdated) return 'Pending update';
    const seconds = Math.max(0, Math.floor((Date.now() - lastUpdated) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  }, [lastUpdated, isRefreshing]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="currency-modal-title"
    >
      <div
        className="relative w-full max-w-md bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-[#E2E2E0] dark:border-[#26262B] relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] flex items-center justify-center text-[#111111] dark:text-[#FFFFFF]">
                <Globe className="w-4 h-4" />
              </div>
              <div>
                <h3
                  id="currency-modal-title"
                  className="text-base font-bold text-[#111111] dark:text-[#FFFFFF] tracking-tight font-sans"
                >
                  Preferred Currency
                </h3>
                <p className="text-xs text-[#777777] dark:text-[#A0A0A0] mt-0.5">
                  Select your display currency for fiat valuations.
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-[#777777] dark:text-[#A0A0A0] hover:text-[#111111] dark:hover:text-[#FFFFFF] hover:bg-[#F0F0EE] dark:hover:bg-[#1A1A1D] transition-colors cursor-pointer"
              aria-label="Close currency selection modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Search Bar */}
          <div className="mt-4 relative">
            <Search className="w-4 h-4 text-[#777777] dark:text-[#A0A0A0] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by code, country, or symbol (e.g. NGN, Naira, ₦)"
              className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] focus:border-[#111111] dark:focus:border-[#FFFFFF] text-xs font-sans text-[#111111] dark:text-[#FFFFFF] placeholder-[#777777] dark:placeholder-[#707070] outline-none transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#777777] hover:text-[#111111] dark:text-[#A0A0A0] dark:hover:text-[#FFFFFF]"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Currency List */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-1.5 divide-y divide-[#E2E2E0]/40 dark:divide-[#26262B]/40">
          {filteredCurrencies.length > 0 ? (
            filteredCurrencies.map((curr: SupportedCurrency) => {
              const isSelected = curr.code === preferredCurrency;

              return (
                <button
                  key={curr.code}
                  type="button"
                  onClick={() => {
                    setCurrency(curr.code);
                    onClose();
                  }}
                  className={`w-full p-3 rounded-2xl flex items-center justify-between transition-all duration-150 cursor-pointer text-left ${
                    isSelected
                      ? 'bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#111111] dark:border-[#FFFFFF]'
                      : 'hover:bg-[#F5F5F3] dark:hover:bg-[#18181B] border border-transparent hover:border-[#E2E2E0] dark:hover:border-[#26262B]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-2xl select-none leading-none shrink-0" aria-hidden="true">
                      {curr.flag}
                    </span>
                    <div className="truncate">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-[#111111] dark:text-[#FFFFFF] font-sans">
                          {curr.name}
                        </span>
                        <span className="text-xs font-mono font-semibold text-[#777777] dark:text-[#A0A0A0]">
                          {curr.code}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#777777] dark:text-[#A0A0A0] font-mono mt-0.5">
                        Symbol: <strong className="text-[#111111] dark:text-[#FFFFFF]">{curr.symbol}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <span className="text-sm font-mono font-bold text-[#111111] dark:text-[#FFFFFF]">
                      {curr.symbol}
                    </span>
                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-[#111111] dark:bg-[#FFFFFF] text-white dark:text-[#111111] flex items-center justify-center shrink-0">
                        <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })
          ) : (
            <div className="py-12 text-center text-xs text-[#777777] dark:text-[#A0A0A0] font-sans">
              No matching currencies found for &ldquo;{searchQuery}&rdquo;.
            </div>
          )}
        </div>

        {/* Modal Footer with Live Status & Manual Refresh */}
        <div className="p-4 border-t border-[#E2E2E0] dark:border-[#26262B] bg-[#FAFAF9] dark:bg-[#111113] flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2 truncate">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                rateStatus === 'live'
                  ? 'bg-emerald-500'
                  : rateStatus === 'stale'
                  ? 'bg-amber-500'
                  : rateStatus === 'loading'
                  ? 'bg-blue-500 animate-pulse'
                  : 'bg-rose-500'
              }`}
            />
            <span className="text-[#777777] dark:text-[#A0A0A0] truncate text-[11px]">
              {rateStatus === 'live' && `Rates live · Updated ${formattedLastUpdated}`}
              {rateStatus === 'stale' && `Cached rates · Updated ${formattedLastUpdated}`}
              {rateStatus === 'loading' && 'Fetching live foreign exchange rates...'}
              {rateStatus === 'error' && (errorMessage || 'Rate provider unavailable')}
            </span>
          </div>

          <button
            type="button"
            onClick={refreshRates}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#E2E2E0] dark:border-[#26262B] bg-white dark:bg-[#18181B] hover:bg-[#F0F0EE] dark:hover:bg-[#202024] text-[#111111] dark:text-[#FFFFFF] text-[11px] font-medium transition-all disabled:opacity-50 cursor-pointer shrink-0 ml-2"
            title="Refresh foreign exchange rates"
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Updating...' : 'Refresh'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
