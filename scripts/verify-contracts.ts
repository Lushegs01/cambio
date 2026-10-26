/**
 * Re-verifies every network, token, pool and router in src/config/chains.ts against the live chains.
 * Read-only: it uses eth_call/eth_estimateGas and never broadcasts anything.
 *
 *   npm run verify:chain
 *
 * Exits non-zero if any check fails.
 */
import { createPublicClient, decodeFunctionResult, encodeFunctionData, http, parseAbi, type Address } from 'viem';
import { MEZO_MAINNET, MEZO_TESTNET, type MezoChainConfig } from '../src/config/chains.ts';

const erc20 = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function transfer(address,uint256) returns (bool)',
]);
const pool = parseAbi(['function token0() view returns (address)', 'function token1() view returns (address)', 'function stable() view returns (bool)']);
const router = parseAbi([
  'struct Route { address from; address to; bool stable; address factory; }',
  'function defaultFactory() view returns (address)',
  'function getAmountsOut(uint256 amountIn, Route[] routes) view returns (uint256[] amounts)',
]);
const factory = parseAbi(['function getFee(address pool, bool _stable) view returns (uint256)']);

let failures = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const bad = (msg: string) => {
  failures++;
  console.log(`  ✗ ${msg}`);
};
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

async function verify(chain: MezoChainConfig) {
  console.log(`\n${chain.name} (expected chain ${chain.chainId})`);
  for (const rpc of chain.rpcUrls) {
    const c = createPublicClient({ transport: http(rpc, { timeout: 15_000 }) });
    try {
      const id = await c.getChainId();
      id === chain.chainId ? ok(`RPC ${rpc} → chain ${id}`) : bad(`RPC ${rpc} reports chain ${id}`);
    } catch (e) {
      bad(`RPC ${rpc} unreachable: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  const c = createPublicClient({ transport: http(chain.rpcUrls[0], { timeout: 15_000 }) });

  for (const t of Object.values(chain.tokens)) {
    try {
      const [symbol, decimals] = await Promise.all([
        c.readContract({ address: t.address, abi: erc20, functionName: 'symbol' }),
        c.readContract({ address: t.address, abi: erc20, functionName: 'decimals' }),
      ]);
      symbol === t.symbol && decimals === t.decimals
        ? ok(`${t.symbol} ${t.address} symbol=${symbol} decimals=${decimals}`)
        : bad(`${t.symbol} ${t.address} returned symbol=${symbol} decimals=${decimals}`);
    } catch (e) {
      bad(`${t.symbol} ${t.address}: ${(e as Error).message.split('\n')[0]}`);
    }
  }

  try {
    const f = await c.readContract({ address: chain.router, abi: router, functionName: 'defaultFactory' });
    eq(f, chain.poolFactory) ? ok(`Router ${chain.router} defaultFactory = PoolFactory`) : bad(`Router defaultFactory ${f} ≠ ${chain.poolFactory}`);
  } catch (e) {
    bad(`Router ${chain.router}: ${(e as Error).message.split('\n')[0]}`);
  }

  for (const p of chain.pools) {
    try {
      const [t0, t1, stable] = await Promise.all([
        c.readContract({ address: p.address, abi: pool, functionName: 'token0' }),
        c.readContract({ address: p.address, abi: pool, functionName: 'token1' }),
        c.readContract({ address: p.address, abi: pool, functionName: 'stable' }),
      ]);
      const want = [chain.tokens[p.tokenA].address, chain.tokens[p.tokenB].address];
      const tokensMatch = want.some((w) => eq(w, t0 as string)) && want.some((w) => eq(w, t1 as string));
      const fee = await c.readContract({ address: chain.poolFactory, abi: factory, functionName: 'getFee', args: [p.address, p.stable] });
      const one = 10n ** BigInt(chain.tokens[p.tokenA].decimals);
      const amounts = await c.readContract({
        address: chain.router,
        abi: router,
        functionName: 'getAmountsOut',
        args: [one, [{ from: chain.tokens[p.tokenA].address, to: chain.tokens[p.tokenB].address, stable: p.stable, factory: chain.poolFactory }]],
      });
      if (tokensMatch && stable === p.stable && amounts[1] === 0n) {
        console.log(`  ! Pool ${p.tokenA}/${p.tokenB} ${p.address} is configured correctly (stable=${stable}, fee=${fee}bps) but has no liquidity; the app reports this to users.`);
        continue;
      }
      tokensMatch && stable === p.stable && amounts[1] > 0n
        ? ok(`Pool ${p.tokenA}/${p.tokenB} ${p.address} stable=${stable} fee=${fee}bps quote 1 ${p.tokenA} → ${amounts[1]} base units ${p.tokenB}`)
        : bad(`Pool ${p.tokenA}/${p.tokenB} ${p.address} mismatch (tokens ${t0}/${t1}, stable ${stable}, out ${amounts[1]})`);
    } catch (e) {
      bad(`Pool ${p.tokenA}/${p.tokenB} ${p.address}: ${(e as Error).message.split('\n')[0]}`);
    }
  }

  // The exact calldata Cambio sends to pay a signed request: transfer(to, amount) + "CMB2" + 16-byte id.
  // Simulated from the MUSD/BTC pool (a known MUSD holder) with eth_call; nothing is broadcast.
  const holder = chain.pools.find((p) => p.tokenA === 'MUSD' || p.tokenB === 'MUSD')!.address as Address;
  const data = (encodeFunctionData({ abi: erc20, functionName: 'transfer', args: ['0x000000000000000000000000000000000000dEaD', 1n] }) +
    '434d4232' + '00112233445566778899aabbccddeeff') as `0x${string}`;
  try {
    const result = await c.call({ account: holder, to: chain.tokens.MUSD.address, data });
    if (!result.data || decodeFunctionResult({ abi: erc20, functionName: 'transfer', data: result.data }) !== true) throw new Error('Token did not return true for the exact transfer calldata');
    const gas = await c.estimateGas({ account: holder, to: chain.tokens.MUSD.address, data });
    ok(`MUSD transfer with request-id calldata suffix simulates successfully (gas ${gas})`);
  } catch (e) {
    bad(`MUSD transfer with suffix failed to simulate: ${(e as Error).message.split('\n')[0]}`);
  }
}

for (const chain of [MEZO_TESTNET, MEZO_MAINNET]) await verify(chain);
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
