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

/**
 * MUSD protocol read surface. Signatures copied from the official ABIs in mezo-org/musd
 * (solidity/artifacts/deployments/matsnet/*.json, commit da7888a) and confirmed by live eth_call.
 */
export const priceFeedAbi = parseAbi([
  /** BTC/USD with 18 decimals. Reverts "PriceFeed: Oracle is stale." if the oracle round is > 60 s old. */
  'function fetchPrice() view returns (uint256)',
  'function oracle() view returns (address)',
]);

/** Chainlink-compatible oracle behind PriceFeed (Mezo precompile 0x7b7c…0015 on testnet and mainnet). */
export const aggregatorV3Abi = parseAbi([
  'function decimals() view returns (uint8)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
]);

export const troveManagerAbi = parseAbi([
  'function MCR() view returns (uint256)',
  'function CCR() view returns (uint256)',
  'function getTCR(uint256 _price) view returns (uint256)',
  'function checkRecoveryMode(uint256 _price) view returns (bool)',
  /** 0 nonExistent, 1 active, 2 closedByOwner, 3 closedByLiquidation, 4 closedByRedemption. */
  'function getTroveStatus(address _borrower) view returns (uint8)',
  'function getEntireDebtAndColl(address _borrower) view returns (uint256 coll, uint256 principal, uint256 interest, uint256 pendingCollateral, uint256 pendingPrincipal, uint256 pendingInterest)',
  'function getCurrentICR(address _borrower, uint256 _price) view returns (uint256)',
  'function getTroveInterestRate(address _borrower) view returns (uint16)',
  'function getEntireSystemColl() view returns (uint256)',
  'function getEntireSystemDebt() view returns (uint256)',
]);

export const borrowerOperationsAbi = parseAbi([
  'function minNetDebt() view returns (uint256)',
  'function MUSD_GAS_COMPENSATION() view returns (uint256)',
  /** Fee fraction with 18 decimals (1e15 = 0.1%). Not charged while the system is in Recovery Mode. */
  'function borrowingRate() view returns (uint256)',
  'function getBorrowingFee(uint256 _debt) view returns (uint256)',
]);

export const interestRateManagerAbi = parseAbi([
  /** Annual simple interest in basis points for newly opened troves. */
  'function interestRate() view returns (uint16)',
]);
