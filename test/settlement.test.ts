import 'mocha'
import * as chai from 'chai'
import * as sinon from 'sinon'
import axios from 'axios'
import { getLocal, Mockttp } from 'mockttp'
import { randomBytes } from 'crypto'
import { PayPalSettlementEngine } from '../src'
import { Account } from '../src/models/account'

const Redis = require('ioredis-mock')
const assert = Object.assign(chai.assert, sinon.assert)

describe('Accounts Settlement', function () {
  let mockttp: Mockttp
  let engine: PayPalSettlementEngine

  let transaction = {
    txn_type: 'send_money',
    memo: 'Payout!',
    payment_status: 'Completed',
    mc_gross: '200.87'
  }

  const testAccount: Account = {
    id: 'testId'
  }

  beforeEach(async () => {
    mockttp = getLocal()
    await mockttp.start(7777)

    engine = new PayPalSettlementEngine({
      connectorUrl: 'http://localhost:7777',
      redis: new Redis(),
      ppEmail: 'ppEmail',
      clientId: 'clientId',
      secret: 'secret'
    })
    await engine.start()
  })

  afterEach(async () => {
    await mockttp.stop()
    await engine.close()
  })

  it('Notifies connector of incoming settlement', async () => {
    const mockEndpoint = await mockttp
      .post(`/accounts/${testAccount.id}/settlement`)
      .thenReply(200)

    await engine.redis.set(
      `${engine.prefix}:accounts:${testAccount.id}`,
      JSON.stringify(testAccount)
    )

    const tag = randomBytes(4).readUInt32BE(0)

    await engine.redis.set(
      `${engine.prefix}:tag:${tag}:accountId`,
      testAccount.id
    )

    await engine.redis.set(
      `${engine.prefix}:accountId:${testAccount.id}:tag`,
      tag
    )

    transaction.memo = tag.toString()

    const response = await axios
      .post(
        `http://localhost:3000/accounts/${engine.clientId}/ipn`,
        transaction
      )
      .catch(err => {
        throw new Error(err.message)
      })

    const requests = await mockEndpoint.getSeenRequests()
    const request = requests[0]

    assert.strictEqual(response.status, 200)
    assert.strictEqual(requests.length, 1)
    assert.deepEqual(request.body.json, {
      amount: '20087',
      scale: engine.assetScale
    })
  })

  it('Attempts to get payment details from counterparty during settlement', async () => {
    const paymentDetails = {
      ppEmail: 'test@ilp.com',
      tag: 123456
    }
    const mockMessageEndpoint = await mockttp
      .post(`/accounts/${testAccount.id}/messages`)
      .thenReply(200, Buffer.from(JSON.stringify(paymentDetails)))

    await engine.redis.set(
      `${engine.prefix}:accounts:${testAccount.id}`,
      JSON.stringify(testAccount)
    )

    const response = await axios.post(
      `http://localhost:3000/accounts/${testAccount.id}/settlement`,
      {
        amount: '5000000000',
        scale: 10
      }
    )

    const requests = await mockMessageEndpoint.getSeenRequests()
    const [request] = requests

    assert.strictEqual(response.status, 200)
    assert.strictEqual(requests.length, 1)
    assert.deepEqual(request.body.json, {
      type: 'paymentDetails'
    })
  })
})
