import { z } from 'zod';
import type { Mode } from './types.js';
const num = (fallback: number) => z.coerce.number().finite().positive().default(fallback);
const schema = z.object({
  MODE: z.enum(['observe', 'paper', 'live']).default('observe'),
  RPC_URL: z.url().default('https://api.mainnet-beta.solana.com'),
  RPC_WS_URL: z.url().default('wss://api.mainnet-beta.solana.com'),
  JUPITER_BASE_URL: z.url().default('https://api.jup.ag/swap/v2'),
  JUPITER_RPS: num(.5),
  JUPITER_API_KEY: z.string().default(''), WALLET_KEYPAIR_PATH: z.string().default(''),
  DATA_DIR: z.string().default('./data'), PORT: num(8787), HOST: z.string().default('127.0.0.1'),
  DASHBOARD_TOKEN: z.string().default(''), POSITION_USD: num(2), MAX_CAPITAL_USD: num(10),
  MAX_POSITIONS: num(5).refine(Number.isInteger), PAPER_CASH_USD: num(20),
  MAX_DAILY_LOSS_USD: num(3), MAX_TRADE_COST_PCT: num(5), MAX_SLIPPAGE_BPS: num(150).refine(n => n <= 500),
  MAX_PRICE_IMPACT_PCT: num(2), RECOVER_MULTIPLE: num(3),
  MIN_SOL_RESERVE: num(0.01), MAX_PRIORITY_LAMPORTS: num(10000),
  LIVE_FUNDING_CAP_USD: z.coerce.number().nonnegative().default(0),
  LIVE_ACK: z.string().default(''), ENABLE_PUMP_CURVE: z.enum(['true','false']).default('false'),
});
export type Config = z.infer<typeof schema> & { MODE: Mode };
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cfg = schema.parse(env);
  if (cfg.MODE === 'live' && (cfg.LIVE_ACK !== 'I_ACCEPT_LIMITED_LIVE' || !cfg.WALLET_KEYPAIR_PATH || cfg.LIVE_FUNDING_CAP_USD <= 0))
    throw new Error('LIVE requires explicit acknowledgement, wallet file and positive funding cap');
  if (cfg.HOST !== '127.0.0.1' && cfg.HOST !== '::1' && cfg.DASHBOARD_TOKEN.length < 24)
    throw new Error('Non-loopback dashboard requires token >=24 characters and external TLS');
  return cfg;
}
