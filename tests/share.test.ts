/**
 * Distribution helpers must carry the exact signed link and never produce executable markup.
 */
import { describe, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { MEZO_TESTNET } from '../src/config/chains';
import { buildPaymentRequest, encodePaymentLink, parsePaymentLink, typedDataFor, verifyRequestSignature } from '../src/lib/paymentRequest';
import { embedButtonHtml, emailShareUrl, telegramShareUrl, whatsappShareUrl } from '../src/lib/share';

async function link(memo = 'Logo & brand <v2>') {
  const merchant = privateKeyToAccount(generatePrivateKey());
  const req = buildPaymentRequest({ chain: MEZO_TESTNET, recipient: merchant.address, amount: 25n * 10n ** 18n, memo, lifetimeSeconds: 3600 });
  return { url: encodePaymentLink('https://cambio-five.vercel.app', req, await merchant.signTypedData(typedDataFor(req))), req };
}

describe('share links', () => {
  it('WhatsApp, Telegram and email carry the exact signed link, which still verifies', async () => {
    const { url } = await link();
    for (const share of [whatsappShareUrl, telegramShareUrl, emailShareUrl]) {
      const out = share({ url, amount: '25.00', memo: 'Logo' });
      const decoded = decodeURIComponent(out);
      expect(decoded).toContain(url);
      const recovered = decoded.slice(decoded.indexOf(url), decoded.indexOf(url) + url.length);
      const parsed = parsePaymentLink(recovered);
      expect(parsed?.kind).toBe('signed');
      if (parsed?.kind === 'signed') expect(await verifyRequestSignature(parsed.request, parsed.signature)).toBe(true);
    }
    expect(whatsappShareUrl({ url, amount: '1' })).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(telegramShareUrl({ url, amount: '1' })).toMatch(/^https:\/\/t\.me\/share\/url\?url=/);
  });

  it('the embed button is a plain, escaped link with no script', async () => {
    const { url } = await link();
    const html = embedButtonHtml({ url, amount: '25.00"><script>alert(1)</script>' });
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
    expect(html).toMatch(/^<a href="[^"]+" target="_blank" rel="noopener noreferrer"/);
    // The href decodes back to the exact link (only & is entity-encoded).
    const href = html.match(/href="([^"]+)"/)![1].replace(/&amp;/g, '&');
    expect(href).toBe(url);
  });
});
