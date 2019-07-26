import { Context } from 'koa'
import { normalizeAsset } from '../utils/normalizeAsset'

export async function create (ctx: Context) {
  const { assetScale, params, prefix, redis, request } = ctx
  const accJSON = await redis.get(`${prefix}:accounts:${params.id}`)
  const account = JSON.parse(accJSON)

  const { body } = request
  const amnt = normalizeAsset(body.scale, assetScale, BigInt(body.amount))
  await ctx.settleAccount(account, amnt.toString())

  ctx.status = 200
}
