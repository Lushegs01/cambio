/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FiatCurrencyCode, SupportedCurrency } from '../types';

export const DEFAULT_CURRENCY: FiatCurrencyCode = 'USD';

/**
 * Supported fiat currencies in Cambio.
 * Structured for easy extension.
 */
export const SUPPORTED_CURRENCIES: SupportedCurrency[] = [
  {
    code: 'USD',
    name: 'US Dollar',
    symbol: '$',
    flag: '🇺🇸',
    locale: 'en-US',
    decimals: 2,
  },
  {
    code: 'NGN',
    name: 'Nigerian Naira',
    symbol: '₦',
    flag: '🇳🇬',
    locale: 'en-NG',
    decimals: 2,
  },
  {
    code: 'EUR',
    name: 'Euro',
    symbol: '€',
    flag: '🇪🇺',
    locale: 'de-DE',
    decimals: 2,
  },
  {
    code: 'GBP',
    name: 'British Pound',
    symbol: '£',
    flag: '🇬🇧',
    locale: 'en-GB',
    decimals: 2,
  },
  {
    code: 'CAD',
    name: 'Canadian Dollar',
    symbol: 'C$',
    flag: '🇨🇦',
    locale: 'en-CA',
    decimals: 2,
  },
  {
    code: 'GHS',
    name: 'Ghanaian Cedi',
    symbol: 'GH₵',
    flag: '🇬🇭',
    locale: 'en-GH',
    decimals: 2,
  },
  {
    code: 'KES',
    name: 'Kenyan Shilling',
    symbol: 'KSh',
    flag: '🇰🇪',
    locale: 'en-KE',
    decimals: 2,
  },
  {
    code: 'ZAR',
    name: 'South African Rand',
    symbol: 'R',
    flag: '🇿🇦',
    locale: 'en-ZA',
    decimals: 2,
  },
];

export const CURRENCY_MAP: Record<FiatCurrencyCode, SupportedCurrency> = SUPPORTED_CURRENCIES.reduce(
  (acc, curr) => {
    acc[curr.code] = curr;
    return acc;
  },
  {} as Record<FiatCurrencyCode, SupportedCurrency>
);

export interface FxRatesResult {
  rates: Record<string, number>;
  lastUpdated: number;
  source: 'Open Exchange Rates' | 'Coinbase FX' | 'Cached Offline';
  isStale: boolean;
}

const STORAGE_CACHE_KEY = 'cambio_fx_rates_cache_v1';
const PREFERENCE_KEY = 'cambio_preferred_currency';

// Baseline USD reference
const BASELINE_USD_RATES: Record<string, number> = {
  USD: 1.0,
};

let inMemoryRatesCache: FxRatesResult = {
  rates: { ...BASELINE_USD_RATES },
  lastUpdated: 0,
  source: 'Cached Offline',
  isStale: true,
};

// Initialize cache from localStorage
try {
  const cached = localStorage.getItem(STORAGE_CACHE_KEY);
  if (cached) {
    const parsed = JSON.parse(cached);
    if (parsed && parsed.rates && typeof parsed.rates === 'object') {
      inMemoryRatesCache = {
        rates: { ...BASELINE_USD_RATES, ...parsed.rates },
        lastUpdated: parsed.lastUpdated || 0,
        source: 'Cached Offline',
        isStale: Date.now() - (parsed.lastUpdated || 0) > 300000, // 5 min threshold
      };
    }
  }
} catch {
  // Ignore localStorage parsing error
}

/**
 * Retrieve saved preferred currency from localStorage or default to USD.
 */
export function getStoredPreferredCurrency(): FiatCurrencyCode {
  try {
    const stored = localStorage.getItem(PREFERENCE_KEY);
    if (stored && stored in CURRENCY_MAP) {
      return stored as FiatCurrencyCode;
    }
  } catch {
    // Ignore storage error
  }
  return DEFAULT_CURRENCY;
}

/**
 * Save preferred currency to localStorage.
 */
export function setStoredPreferredCurrency(currency: FiatCurrencyCode): void {
  try {
    localStorage.setItem(PREFERENCE_KEY, currency);
  } catch {
    // Ignore storage error
  }
}

/**
 * Fetch live foreign exchange rates from Open Exchange Rates with Coinbase fallback.
 */
export async function fetchLiveFxRates(): Promise<FxRatesResult> {
  // Attempt 1: Open Exchange Rates public USD rates
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7500);

    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && data.result === 'success' && data.rates) {
        const rates: Record<string, number> = { USD: 1.0 };
        for (const curr of SUPPORTED_CURRENCIES) {
          if (data.rates[curr.code] != null) {
            rates[curr.code] = parseFloat(data.rates[curr.code]);
          }
        }

        const result: FxRatesResult = {
          rates,
          lastUpdated: Date.now(),
          source: 'Open Exchange Rates',
          isStale: false,
        };

        inMemoryRatesCache = result;
        try {
          localStorage.setItem(
            STORAGE_CACHE_KEY,
            JSON.stringify({ rates, lastUpdated: result.lastUpdated })
          );
        } catch {}

        return result;
      }
    }
  } catch (error) {
    console.warn('Open Exchange Rates fetch error, trying secondary source:', error);
  }

  // Attempt 2: Coinbase Exchange Rates fallback
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7500);

    const res = await fetch('https://api.coinbase.com/v2/exchange-rates?currency=USD', {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && data.data && data.data.rates) {
        const rates: Record<string, number> = { USD: 1.0 };
        for (const curr of SUPPORTED_CURRENCIES) {
          if (data.data.rates[curr.code] != null) {
            rates[curr.code] = parseFloat(data.data.rates[curr.code]);
          }
        }

        const result: FxRatesResult = {
          rates,
          lastUpdated: Date.now(),
          source: 'Coinbase FX',
          isStale: false,
        };

        inMemoryRatesCache = result;
        try {
          localStorage.setItem(
            STORAGE_CACHE_KEY,
            JSON.stringify({ rates, lastUpdated: result.lastUpdated })
          );
        } catch {}

        return result;
      }
    }
  } catch (error) {
    console.warn('Coinbase FX fallback error:', error);
  }

  // Fallback to cache if available
  if (inMemoryRatesCache.lastUpdated > 0 && Object.keys(inMemoryRatesCache.rates).length > 1) {
    return {
      ...inMemoryRatesCache,
      source: 'Cached Offline',
      isStale: true,
    };
  }

  throw new Error('Unable to retrieve foreign exchange rates and no valid cache is available.');
}

/**
 * Format a numeric amount in the target fiat currency with proper symbol and separators.
 */
export function formatFiatValue(amount: number, currencyCode: FiatCurrencyCode): string {
  const meta = CURRENCY_MAP[currencyCode] || CURRENCY_MAP.USD;
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);

  let formattedNumber: string;
  try {
    formattedNumber = absAmount.toLocaleString(meta.locale, {
      minimumFractionDigits: meta.decimals,
      maximumFractionDigits: meta.decimals,
    });
  } catch {
    formattedNumber = absAmount.toFixed(meta.decimals);
  }

  const sign = isNegative ? '-' : '';
  
  // Custom prefix formatting based on conventional standard placement
  switch (currencyCode) {
    case 'NGN':
      return `${sign}₦${formattedNumber}`;
    case 'USD':
      return `${sign}$${formattedNumber}`;
    case 'EUR':
      return `${sign}€${formattedNumber}`;
    case 'GBP':
      return `${sign}£${formattedNumber}`;
    case 'CAD':
      return `${sign}C$${formattedNumber}`;
    case 'GHS':
      return `${sign}GH₵${formattedNumber}`;
    case 'KES':
      return `${sign}KSh ${formattedNumber}`;
    case 'ZAR':
      return `${sign}R ${formattedNumber}`;
    default:
      return `${sign}${meta.symbol}${formattedNumber}`;
  }
}

/**
 * Calculate fiat equivalent for a token balance.
 * Returns null if token price or currency conversion rate is unavailable.
 */
export function calculateTokenFiatEstimate(
  tokenAmount: number,
  tokenSymbol: string,
  tokenUsdPrice: number | undefined,
  currencyCode: FiatCurrencyCode,
  fxRates: Record<string, number>
): { amount: number; formatted: string } | null {
  // Enforce verified pricing: never invent prices
  if (tokenUsdPrice == null || isNaN(tokenUsdPrice) || tokenUsdPrice <= 0) {
    return null;
  }

  const rate = fxRates[currencyCode];
  if (rate == null || isNaN(rate) || rate <= 0) {
    return null;
  }

  const fiatValue = tokenAmount * tokenUsdPrice * rate;
  return {
    amount: fiatValue,
    formatted: formatFiatValue(fiatValue, currencyCode),
  };
}
