import { createClient } from 'redis';
import { config } from './config.js';

export const redis = createClient({ url: config.redisUrl });
redis.on('error', error => console.error('Redis:', error.message));

export const reserveScript = `
local old = redis.call('GET', KEYS[2])
if old then return { 'duplicate', old } end
local left = tonumber(redis.call('GET', KEYS[1]) or '0')
if left <= 0 then return { 'sold_out', '' } end
redis.call('DECR', KEYS[1])
redis.call('SET', KEYS[2], ARGV[1])
redis.call('SET', KEYS[3], ARGV[2])
return { 'reserved', ARGV[1] }
`;

export const releaseScript = `
local status = redis.call('GET', KEYS[3]) or ''
if redis.call('GET', KEYS[2]) == ARGV[1] and string.sub(status, 1, 9) == 'reserved:' then
  redis.call('DEL', KEYS[2], KEYS[3])
  redis.call('INCR', KEYS[1])
  return 1
end
return 0
`;

const stockKey = 'sale:phone-1:slots';
const buyerKey = buyerId => `sale:phone-1:buyer:${buyerId}`;
const requestKey = requestId => `sale:phone-1:request:${requestId}`;

export async function reserve(buyerId, requestId) {
  const result = await redis.eval(reserveScript, {
    keys: [stockKey, buyerKey(buyerId), requestKey(requestId)],
    arguments: [requestId, `reserved:${Date.now()}:${buyerId}`]
  });
  return { kind: result[0], requestId: result[1] };
}

export async function release(buyerId, requestId) {
  return redis.eval(releaseScript, {
    keys: [stockKey, buyerKey(buyerId), requestKey(requestId)],
    arguments: [requestId]
  });
}

export async function markRecorded(requestId) {
  await redis.set(requestKey(requestId), 'recorded');
}

export async function remainingSlots() {
  return Number(await redis.get(stockKey) ?? 0);
}

export async function* oldReservations(minAgeMs = 300000) {
  for await (const batch of redis.scanIterator({ MATCH: 'sale:phone-1:request:*', COUNT: 100 })) {
    for (const key of Array.isArray(batch) ? batch : [batch]) {
      const value = await redis.get(key);
      if (!value?.startsWith('reserved:')) continue;
      const [, timestamp, buyerId] = value.split(':');
      if (Date.now() - Number(timestamp) >= minAgeMs) {
        yield { requestId: key.slice('sale:phone-1:request:'.length), buyerId };
      }
    }
  }
}
