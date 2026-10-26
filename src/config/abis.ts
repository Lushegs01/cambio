/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Minimal ABIs for the contracts in ./chains.ts. Each function used here was confirmed against the
 * deployed bytecode (selector present) or by a successful eth_call on Mezo Testnet and Mainnet.
 */

import { parseAbi } from 'viem';

export { erc20Abi } from 'viem';

export const routerAbi = parseAbi([
  'struct Route { address from; address to; bool stable; address factory; }',
  'function getAmountsOut(uint256 amountIn, Route[] routes) view returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, Route[] routes, address to, uint256 deadline) returns (uint256[] amounts)',
  'function poolFor(address tokenA, address tokenB, bool stable, address _factory) view returns (address pool)',
  'function defaultFactory() view returns (address)',
]);

export const poolFactoryAbi = parseAbi([
  /** Fee in basis points (1 = 0.01%). Values differ per network, so always read them on-chain. */
  'function getFee(address pool, bool _stable) view returns (uint256)',
]);

export const poolAbi = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function stable() view returns (bool)',
  'function getReserves() view returns (uint256 reserve0, uint256 reserve1, uint256 blockTimestampLast)',
]);
