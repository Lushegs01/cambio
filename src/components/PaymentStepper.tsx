/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Progress through a signed-request payment. Purely presentational: the steps come from journeySteps().
 */

import React from 'react';
import { Check, X } from 'lucide-react';
import type { JourneyStep } from '../lib/paymentJourney';

export const PaymentStepper: React.FC<{ steps: JourneyStep[] }> = ({ steps }) => {
  const current = steps.find((s) => s.status === 'current' || s.status === 'blocked');
  return (
    <nav aria-label="Payment progress" className="relative z-10">
      <ol className="flex items-start justify-between gap-1" data-testid="payment-stepper">
        {steps.map((s, i) => (
          <li key={s.key} className="flex-1 flex flex-col items-center text-center min-w-0" aria-current={s.status === 'current' ? 'step' : undefined} data-step={s.key} data-status={s.status}>
            <div className="flex items-center w-full">
              <span className={`flex-1 h-px ${i === 0 ? 'opacity-0' : steps[i - 1].status === 'done' ? 'bg-emerald-500' : 'bg-[#E2E2E0] dark:bg-[#26262B]'}`} aria-hidden="true" />
              <span
                className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold border ${
                  s.status === 'done'
                    ? 'bg-emerald-500 border-emerald-500 text-white'
                    : s.status === 'current'
                      ? 'bg-[#111111] border-[#111111] text-white dark:bg-[#FFFFFF] dark:text-[#111111] dark:border-[#FFFFFF]'
                      : s.status === 'blocked'
                        ? 'bg-red-500 border-red-500 text-white'
                        : 'bg-transparent border-[#D0D0CE] dark:border-[#3A3A40] text-[#999999]'
                }`}
              >
                {s.status === 'done' ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : s.status === 'blocked' ? <X className="w-3.5 h-3.5" aria-hidden="true" /> : i + 1}
              </span>
              <span className={`flex-1 h-px ${i === steps.length - 1 ? 'opacity-0' : s.status === 'done' ? 'bg-emerald-500' : 'bg-[#E2E2E0] dark:bg-[#26262B]'}`} aria-hidden="true" />
            </div>
            <span className={`mt-1.5 text-[10px] sm:text-[11px] leading-tight ${s.status === 'current' || s.status === 'blocked' ? 'font-semibold text-[#111111] dark:text-[#FFFFFF]' : 'text-[#777777] dark:text-[#A0A0A0]'}`}>
              {s.label}
              <span className="sr-only">: {s.status === 'done' ? 'done' : s.status === 'current' ? 'current step' : s.status === 'blocked' ? 'cannot continue' : 'not started'}</span>
            </span>
          </li>
        ))}
      </ol>
      {current && <p className="sr-only" aria-live="polite">Current step: {current.label}</p>}
    </nav>
  );
};
