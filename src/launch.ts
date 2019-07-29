import { PayPalEngineConfig, PayPalSettlementEngine } from '.'
import * as ioredis from 'ioredis'

const ENGINE_HOST = process.env.ENGINE_HOST || 'localhost'
const ENGINE_PORT = process.env.ENGINE_POST || 3000
const ENGINE_MODE = process.env.ENGINE_MODE || 'sandbox'

const CONNECTOR_URL = process.env.CONNECTOR_URL || 'http://localhost:7771'

const REDIS_PORT = process.env.REDIS_PORT || 6379

const LEDGER_EMAIL = process.env.LEDGER_EMAIL || ''
const LEDGER_CLIENT_ID = process.env.LEDGER_CLIENT_ID || ''
const LEDGER_SECRET = process.env.LEDGER_SECRET || ''

const LEDGER_PREFIX = process.env.LEDGER_PREFIX || 'paypal'
const LEDGER_ASSET_SCALE = process.env.LEDGER_ASSET_SCALE || 2
const LEDGER_MIN_CENTS = process.env.LEDGER_MIN_CENTS || 1000000
const LEDGER_CURRENCY = process.env.LEDGER_CURRENCY || 'USD'

const config: PayPalEngineConfig = {
  host: ENGINE_HOST,
  port: +ENGINE_PORT,
  mode: ENGINE_MODE,

  connectorUrl: CONNECTOR_URL,

  redisPort: +REDIS_PORT,
  redis: new ioredis(+REDIS_PORT),

  ppEmail: LEDGER_EMAIL,
  clientId: LEDGER_CLIENT_ID,
  secret: LEDGER_SECRET,

  prefix: LEDGER_PREFIX,
  assetScale: +LEDGER_ASSET_SCALE,
  minCents: +LEDGER_MIN_CENTS,
  currency: LEDGER_CURRENCY
}

const engine = new PayPalSettlementEngine(config)

engine.start().catch(err => console.error(err))
