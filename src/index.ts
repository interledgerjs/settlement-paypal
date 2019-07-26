import * as PayPal from 'paypal-rest-sdk'
import * as Koa from 'koa'
import * as Router from 'koa-router'
import * as bodyParser from 'koa-bodyparser'
import * as ngrok from 'ngrok'
import * as ioredis from 'ioredis'
import * as toCamel from 'camelcase-keys'
import axios from 'axios'
import { Server } from 'net'
import { v4 as uuidv4 } from 'uuid'

import { Account } from './models/account'
import {
  create as createAccount,
  search as searchAccount,
  remove as removeAccount
} from './controllers/account'
import { create as createMessage } from './controllers/message'
import { create as createSettlement } from './controllers/settlement'

const DEFAULT_HOST = 'localhost'
const DEFAULT_PORT = 3000

// PayPal SDK mode
const DEFAULT_MODE = 'sandbox'

const DEFAULT_CONNECTOR_URL = 'http://localhost:7771'

const DEFAULT_REDIS_PORT = 6379

const DEFAULT_PREFIX = 'paypal'
const DEFAULT_ASSET_SCALE = 2
const DEFAULT_MIN_CENTS = 1000000
const DEFAULT_CURRENCY = 'USD'

export interface PayPalEngineConfig {
  host?: string
  port?: number
  mode?: string

  connectorUrl?: string

  redisPort?: number
  redis?: ioredis.Redis

  ppEmail: string
  clientId: string
  secret: string

  prefix?: string
  assetScale?: number
  minCents?: number
  currency?: string
}

export class PayPalSettlementEngine {
  app: Koa
  host: string
  port: number
  mode: string

  server: Server
  router: Router

  connectorUrl: string

  redisPort: number
  redis: ioredis.Redis

  ppEmail: string
  clientId: string
  secret: string

  prefix: string
  assetScale: number
  minCents: number
  currency: string

  constructor (config: PayPalEngineConfig) {
    this.app = new Koa()
    this.app.use(async (ctx, next) => {
      if (ctx.path.includes('messages')) ctx.disableBodyParser = true
      await next()
    })
    this.app.use(bodyParser())

    this.host = config.host || DEFAULT_HOST
    this.port = config.port || DEFAULT_PORT
    this.mode = config.mode || DEFAULT_MODE

    this.connectorUrl = config.connectorUrl || DEFAULT_CONNECTOR_URL

    this.redisPort = config.redisPort || DEFAULT_REDIS_PORT
    this.redis = config.redis || new ioredis(this.redisPort)

    this.ppEmail = config.ppEmail
    this.clientId = config.clientId
    this.secret = config.secret

    this.prefix = config.prefix || DEFAULT_PREFIX
    this.assetScale = config.assetScale || DEFAULT_ASSET_SCALE
    this.minCents = config.minCents || DEFAULT_MIN_CENTS
    this.currency = config.currency || DEFAULT_CURRENCY

    this.app.context.redis = this.redis
    this.app.context.ppEmail = this.ppEmail
    this.app.context.prefix = this.prefix
    this.app.context.assetScale = this.assetScale
    this.app.context.settleAccount = this.settleAccount.bind(this)

    // Routes
    this.router = new Router()
    this.setupRoutes()
    this.app.use(this.router.routes())
  }

  async findAccountMiddleware (ctx: Koa.Context, next: () => Promise<any>) {
    const { params, prefix, redis } = ctx
    const account = await redis.get(`${prefix}:accounts:${params.id}`)
    account ? (ctx.account = JSON.parse(account)) : ctx.throw(404)
    await next()
  }

  private setupRoutes () {
    // Accounts
    this.router.post('/accounts', ctx => createAccount(ctx))
    this.router.get('/accounts/:id', ctx => searchAccount(ctx))
    this.router.delete('/accounts/:id', ctx => removeAccount(ctx))

    // Messages
    this.router.post(
      '/accounts/:id/messages',
      this.findAccountMiddleware,
      createMessage
    )

    // Settlement
    this.router.post(
      '/accounts/:id/settlement',
      this.findAccountMiddleware,
      createSettlement
    )

    // Webhooks
    this.router.post('/accounts/:id/webhooks', ctx =>
      this.handleOutgoingTransaction(ctx)
    )

    // Instant Payment Notifications
    this.router.post('/accounts/:id/ipn', ctx =>
      this.handleIncomingTransaction(ctx)
    )
  }

  private async subscribeToTransactions () {
    const urlName =
      this.host === DEFAULT_HOST
        ? await ngrok.connect(this.port)
        : `https://${this.host}:${this.port}`
    const webhook = {
      url: `${urlName}/accounts/${this.clientId}/webhooks`,
      event_types: [
        {
          name: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED'
        }
      ]
    }
    PayPal.notification.webhook.create(webhook, (err, res) => {
      if (res) {
        console.log(`Initiated webhooks to listening at ${webhook.url}`)
      } else {
        console.error(`Failed to start webhooks at ${webhook.url}`, err)
      }
    })
  }

  async getPaymentDetails (accountId: string) {
    const url = `${this.connectorUrl}\\accounts\\${accountId}\\messages`
    const message = {
      type: 'paymentDetails'
    }
    const res = await axios.post(url, Buffer.from(JSON.stringify(message)), {
      timeout: 10000,
      headers: {
        'Content-type': 'application/octet-stream',
        'Idempotency-Key': uuidv4()
      }
    })
    return res.data
  }

  async settleAccount (account: Account, cents: string) {
    const { id } = account
    console.log(`Attempting to send ${cents} cents to account: ${id}`)
    try {
      const details = await this.getPaymentDetails(id).catch(err => {
        console.error('Error getting payment details from counterparty', err)
        throw err
      })
      const { ppEmail, tag } = details
      const value = Number(cents) / 10 ** this.assetScale
      const payment = {
        sender_batch_header: {
          sender_batch_id: uuidv4(),
          email_subject: `Payout of ${cents} cents!`,
          email_message: tag
        },
        items: [
          {
            recipient_type: 'EMAIL',
            amount: {
              value,
              currency: this.currency
            },
            note: `ILP Settlement from ${id}!`,
            receiver: ppEmail
          }
        ]
      }
      PayPal.payout.create(payment, (err: PayPal.SDKError, pay: any) => {
        if (pay) {
          console.log('Created PayPal payment for approval:', pay)
        } else {
          console.error('Failed to initiate PayPal payment:', err)
        }
      })
    } catch (err) {
      console.error(`Settlement to ${id} for ${cents} cents failed:`, err)
    }
  }

  private async handleOutgoingTransaction (ctx: Koa.Context) {
    const { body } = ctx.request
    const tx = toCamel(body)
    // TODO: Webhook Verification
    const { eventType }: any = tx
    switch (eventType) {
      case 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED':
        const info = toCamel(body.resource, { deep: true })
        const { transactionStatus, payoutItem }: any = info
        switch (transactionStatus) {
          case 'SUCCESS':
            const { amount, receiver } = payoutItem
            const cents = Number(amount.value) * 10 ** this.assetScale
            console.log(`${receiver} claimed settlement of ${cents} cents!`)
            ctx.body = 200
            return
          default:
            ctx.body = 404
            throw new Error(`Unsuccessful transaction!`)
        }
      default:
        ctx.body = 404
        throw new Error(`Handler received incorrect webhook: ${eventType}!`)
    }
  }

  async notifySettlement (accountId: string, amount: string) {
    const url = `${this.connectorUrl}\\accounts\\${accountId}\\settlement`
    const message = {
      amount,
      scale: this.assetScale
    }
    const res = await axios
      .post(url, message, {
        timeout: 10000
      })
      .catch(err => {
        console.error('Failed to notify connector of settlement:', err)
      })
  }

  private async handleIncomingTransaction (ctx: Koa.Context) {
    const { body } = ctx.request
    const tx = toCamel(body)
    // TODO: IPN Verification
    const { txnType, mcGross, memo, paymentStatus }: any = tx
    switch (txnType) {
      case 'send_money':
        switch (paymentStatus) {
          case 'Completed':
            try {
              const accountId = await this.redis.get(
                `${this.prefix}:tag:${memo}:accountId`
              )
              const accJSON = await this.redis.get(
                `${this.prefix}:accounts:${accountId}`
              )
              if (accJSON) {
                const acc = JSON.parse(accJSON)
                const cents = Number(mcGross) * 10 ** this.assetScale
                await this.notifySettlement(acc.id, cents.toString())
                console.log(`Credits ${acc.id} with ${cents} cents!`)
                ctx.body = 200
              }
            } catch (err) {
              console.error('Failed to find account under', memo, err)
              ctx.body = 404
            }
            return
          default:
            ctx.body = 404
            console.log(`IPN handler received an incomplete payment.`)
        }
        return
      default:
        ctx.body = 404
        console.log(`IPN handler received a type ${txnType} payment.`)
    }
  }

  public async start () {
    console.log('Starting to listen on', this.port)
    this.server = this.app.listen(this.port, this.host)

    // PayPal
    console.log(`Starting PayPal in ${this.mode} mode!`)
    PayPal.configure({
      mode: this.mode,
      client_id: this.clientId,
      client_secret: this.secret
    })

    // Webhooks
    await this.subscribeToTransactions()
  }

  public async close () {
    console.log('Shutting down!')
    this.host === DEFAULT_HOST
      ? await Promise.all([ngrok.disconnect(), this.server.close()])
      : this.server.close()
  }
}
