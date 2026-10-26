/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { FiatCurrencyCode, SupportedCurrency } from '../types';
import {
  SUPPORTED_CURRENCIES,
  CURRENCY_MAP,
  DEFAULT_CURRENCY,
  fetchLiveFxRates,
  formatFiatValue,
  calculateTokenFiatEstimate,
  getStoredPreferredCurrency,
  setStoredPreferredCurrency,
} from '../services/fxRatesService';
import { getUsdPrice, refreshBtcUsd } from '../services/liveRatesService';

export type RateStatus = 'loading' | 'live' | 'stale' | 'error';

interface CurrencyContextType {
  preferredCurrency: FiatCurrencyCode;
  setCurrency: (currency: FiatCurrencyCode) => void;
  supportedCurrencies: SupportedCurrency[];
  activeCurrencyMeta: SupportedCurrency;
  fxRates: Record<string, number>;
  rateStatus: RateStatus;
  lastUpdated: number | null;
  rateSource: string;
  errorMessage: string | null;
  refreshRates: () => Promise<void>;
  isRefreshing: boolean;
  formatFiat: (amount: number) => string;
  formatTokenFiat: (
    tokenAmount: number,
    tokenSymbol?: string,
    customUsdPrice?: number
  ) => { amount: number; formatted: string } | null;
  getTokenUsdPrice: (tokenSymbol: string) => number | undefined;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export const CurrencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Selected fiat currency state
  const [preferredCurrency, setPreferredCurrencyState] = useState<FiatCurrencyCode>(() => {
    return getStoredPreferredCurrency();
  });

  // Rates state
  const [fxRates, setFxRates] = useState<Record<string, number>>({ USD: 1.0 });
  const [rateStatus, setRateStatus] = useState<RateStatus>('loading');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [rateSource, setRateSource] = useState<string>('Open Exchange Rates');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const isMounted = useRef<boolean>(true);

  // Load and refresh FX rates
  const loadRates = useCallback(async (isManual = false) => {
    if (!isMounted.current) return;
    if (isManual) setIsRefreshing(true);

    try {
      const result = await fetchLiveFxRates();
      if (!isMounted.current) return;

      setFxRates(result.rates);
      setLastUpdated(result.lastUpdated);
      setRateSource(result.source);
      setRateStatus(result.isStale ? 'stale' : 'live');
      setErrorMessage(null);
    } catch (err) {
      if (!isMounted.current) return;
      console.error('Failed to load foreign exchange rates:', err);
      // If we don't even have cached rates, mark error
      setRateStatus((prev) => (prev === 'loading' ? 'error' : 'stale'));
      setErrorMessage('Live FX rates currently unavailable');
    } finally {
      if (isMounted.current && isManual) {
        setIsRefreshing(false);
      }
    }
  }, []);

  // Initial load
  useEffect(() => {
    isMounted.current = true;
    loadRates();

    return () => {
      isMounted.current = false;
    };
  }, [loadRates]);

  // Periodic 60-second auto-refresh with page visibility guard
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        loadRates();
      }
    }, 60000); // 60 seconds

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Refresh if older than 60s
        if (!lastUpdated || Date.now() - lastUpdated > 60000) {
          loadRates();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadRates, lastUpdated]);

  // The preferred currency is a per-device display preference, stored only in this browser.
  // (It was previously written to Firestore under any wallet address without authentication.)
  const setCurrency = useCallback((newCurrency: FiatCurrencyCode) => {
    if (!(newCurrency in CURRENCY_MAP)) return;
    setPreferredCurrencyState(newCurrency);
    setStoredPreferredCurrency(newCurrency);
  }, []);

  // BTC/USD reference price for display estimates; refreshed with FX rates.
  const [, setPriceTick] = useState(0);
  useEffect(() => {
    const load = () => refreshBtcUsd().catch(() => undefined).finally(() => isMounted.current && setPriceTick((t) => t + 1));
    load();
    const i = setInterval(() => document.visibilityState === 'visible' && load(), 60_000);
    return () => clearInterval(i);
  }, []);

  // Manual refresh handler
  const refreshRates = useCallback(async () => {
    await loadRates(true);
  }, [loadRates]);

  // Helper to format generic fiat amount
  const formatFiat = useCallback(
    (amount: number) => {
      return formatFiatValue(amount, preferredCurrency);
    },
    [preferredCurrency]
  );

  // USD price for display only. Undefined (shown as "price unavailable") when no real price is known.
  const getTokenUsdPrice = useCallback((tokenSymbol: string): number | undefined => getUsdPrice(tokenSymbol)?.priceUsd, []);

  // Format token to fiat estimate
  const formatTokenFiat = useCallback(
    (tokenAmount: number, tokenSymbol: string = 'MUSD', customUsdPrice?: number) => {
      const usdPrice = customUsdPrice != null ? customUsdPrice : getTokenUsdPrice(tokenSymbol);
      return calculateTokenFiatEstimate(
        tokenAmount,
        tokenSymbol,
        usdPrice,
        preferredCurrency,
        fxRates
      );
    },
    [preferredCurrency, fxRates, getTokenUsdPrice]
  );

  const activeCurrencyMeta = CURRENCY_MAP[preferredCurrency] || CURRENCY_MAP.USD;

  return (
    <CurrencyContext.Provider
      value={{
        preferredCurrency,
        setCurrency,
        supportedCurrencies: SUPPORTED_CURRENCIES,
        activeCurrencyMeta,
        fxRates,
        rateStatus,
        lastUpdated,
        rateSource,
        errorMessage,
        refreshRates,
        isRefreshing,
        formatFiat,
        formatTokenFiat,
        getTokenUsdPrice,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
};

export const useCurrency = (): CurrencyContextType => {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
};
