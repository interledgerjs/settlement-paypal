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

describe('Messages', function () {
  let mockttp: Mockttp
  let engine: PayPalSettlementEngine

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
    await engine.close()
    await mockttp.stop()
  })

  it('Requests payment details from counterparty', async () => {
    await engine.redis.set(
      `${engine.prefix}:accounts:${testAccount.id}`,
      JSON.stringify(testAccount)
    )

    const message = {
      type: 'paymentDetails'
    }
    const rawBytes = Buffer.from(JSON.stringify(message))

    const response = await axios
      .post(
        `http://localhost:3000/accounts/${testAccount.id}/messages`,
        rawBytes,
        {
          headers: {
            'content-type': 'application/octet-stream'
          }
        }
      )
      .catch(err => {
        throw new Error(err.message)
      })

    const tag = Number(
      await engine.redis.get(`${engine.prefix}:accountId:${testAccount.id}:tag`)
    )

    assert.strictEqual(response.status, 200)
    assert.deepEqual(response.data, {
      ppEmail: engine.ppEmail,
      tag
    })
  })

  it('Returns correct payment details if previously set', async () => {
    await engine.redis.set(
      `${engine.prefix}:accounts:${testAccount.id}`,
      JSON.stringify(testAccount)
    )

    const tag = randomBytes(4).readUInt32BE(0)

    await engine.redis.set(
      `${engine.prefix}:destinationTag:${tag}:accountId`,
      testAccount.id
    )

    await engine.redis.set(
      `${engine.prefix}:accountId:${testAccount.id}:tag`,
      tag
    )

    const message = {
      type: 'paymentDetails'
    }
    const rawBytes = Buffer.from(JSON.stringify(message))

    const response = await axios
      .post(
        `http://localhost:3000/accounts/${testAccount.id}/messages`,
        rawBytes,
        {
          headers: {
            'content-type': 'application/octet-stream'
          }
        }
      )
      .catch(err => {
        throw new Error(err.message)
      })

    assert.strictEqual(response.status, 200)
    assert.deepEqual(response.data, {
      ppEmail: engine.ppEmail,
      tag: tag.toString()
    })
  })
})
