import { Context } from 'koa'
import { Account } from '../models/account'

export async function create (ctx: Context) {
  const { prefix, redis, request } = ctx
  const { id } = request.body
  const account: Account = {
    id
  }
  const existingAccount = await redis.get(`${prefix}:accounts:${account.id}`)
  if (!existingAccount) {
    await redis.set(
      `${prefix}:accounts:${account.id}`,
      JSON.stringify(account)
    )
  }
  ctx.status = 200
}

export async function search (ctx: Context) {
  const { params, prefix, redis } = ctx
  const account = await redis.get(`${prefix}:accounts:${params.id}`)
  if (account) {
    ctx.body = JSON.parse(account)
    ctx.status = 200
  } else {
    ctx.status = 404
  }
}

export async function remove (ctx: Context) {
  const { params, prefix, redis } = ctx
  await redis.del(`${prefix}:accounts:${params.id}`)
  ctx.status = 200
}
