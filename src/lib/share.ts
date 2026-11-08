/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Distribution helpers for signed payment links. Every channel carries the exact signed link; nothing
 * here rewrites, shortens or proxies it, so the payer's browser still verifies the merchant's signature.
 */

export interface ShareContent {
  url: string;
  /** Human-readable amount, e.g. "25.00". */
  amount: string;
  memo?: string;
}

function message({ url, amount, memo }: ShareContent): string {
  return `Payment request: ${amount} MUSD${memo ? ` · ${memo}` : ''}\nPay securely with Cambio (signed by my wallet, on Mezo): ${url}`;
}

export function whatsappShareUrl(c: ShareContent): string {
  return `https://wa.me/?text=${encodeURIComponent(message(c))}`;
}

export function telegramShareUrl(c: ShareContent): string {
  return `https://t.me/share/url?url=${encodeURIComponent(c.url)}&text=${encodeURIComponent(`Payment request: ${c.amount} MUSD${c.memo ? ` · ${c.memo}` : ''}`)}`;
}

export function emailShareUrl(c: ShareContent): string {
  return `mailto:?subject=${encodeURIComponent(`Payment request: ${c.amount} MUSD`)}&body=${encodeURIComponent(message(c))}`;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');

/**
 * A self-contained "Pay with Cambio" button for a merchant's website or invoice email. It is a plain link
 * (no script, no iframe), so it cannot run code on the host page; the payment page does all verification.
 */
export function embedButtonHtml(c: ShareContent): string {
  const label = escapeHtml(`Pay ${c.amount} MUSD with Cambio`);
  return `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 20px;border-radius:12px;background:#111111;color:#ffffff;font:600 14px/1.2 system-ui,sans-serif;text-decoration:none">${label}</a>`;
}
