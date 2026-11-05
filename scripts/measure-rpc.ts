/**
 * Measures RPC request counts and latency for the Mezo position refresh and Fund & Pay sizing, with and
 * without Multicall3 batching. Read-only.   npm run measure:rpc
 */
import { createPublicClient, defineChain, http } from 'viem';
import { MEZO_TESTNET } from '../src/config/chains.ts';
import { readOraclePrice, readProtocolParams, readTrove, type ReadClient } from '../src/lib/mezoProtocol.ts';
import { planFunding } from '../src/lib/fundAndPay.ts';

const OWNER = '0xd0d433B348a4874d395d12CA0b7841e24E5a8dCd'; // a public testnet trove
const chain = MEZO_TESTNET;

function client(batched: boolean) {
  let requests = 0;
  const c = createPublicClient({
    chain: defineChain({ id: chain.chainId, name: chain.name, nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 }, rpcUrls: { default: { http: [chain.rpcUrls[0]] } }, contracts: { multicall3: { address: chain.multicall3 } } }),
    transport: http(chain.rpcUrls[0], { onFetchRequest: () => { requests++; } }),
    batch: batched ? { multicall: { wait: 16 } } : undefined,
  });
  return { c, count: () => requests };
}

async function mezoCard(c: ReadClient) {
  const oracle = await readOraclePrice(c, chain);
  if (oracle.status !== 'ok') throw new Error(`oracle ${oracle.status}`);
  await Promise.all([readProtocolParams(c, chain, oracle.price), readTrove(c, chain, OWNER, oracle.price)]);
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
for (const batched of [false, true]) {
  const card: number[] = [];
  const fund: number[] = [];
  let cardReq = 0;
  let fundReq = 0;
  for (let i = 0; i < 3; i++) {
    const a = client(batched);
    let t = performance.now();
    await mezoCard(a.c as unknown as ReadClient);
    card.push(performance.now() - t);
    cardReq = a.count();
    const b = client(batched);
    t = performance.now();
    await planFunding(b.c as never, chain, 25n * 10n ** 18n);
    fund.push(performance.now() - t);
    fundReq = b.count();
  }
  console.log(JSON.stringify({ batched, mezoCard: { requests: cardReq, medianMs: Math.round(median(card)) }, fundAndPay: { requests: fundReq, medianMs: Math.round(median(fund)) } }));
}
