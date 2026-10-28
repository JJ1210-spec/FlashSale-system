import { config } from './config.js';
import { pool, inTransaction } from './db.js';
import { redis, oldReservations, markRecorded, release } from './reservation.js';
import { connectAmqp } from './amqp.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function reconcile() {
  for await (const { requestId, buyerId } of oldReservations()) {
    const found = await pool.query('SELECT 1 FROM orders WHERE request_id = $1', [requestId]);
    if (found.rowCount) await markRecorded(requestId);
    else await release(buyerId, requestId);
  }
}

await redis.connect();
const connection = await connectAmqp();
const channel = await connection.createConfirmChannel();
await channel.assertQueue(config.queue, { durable: true });

let lastReconcile = 0;
while (true) {
  try {
    const published = await inTransaction(async client => {
      const result = await client.query(
        'SELECT request_id FROM outbox WHERE published_at IS NULL ORDER BY request_id LIMIT 1 FOR UPDATE SKIP LOCKED'
      );
      if (!result.rowCount) return false;
      const requestId = result.rows[0].request_id;
      channel.sendToQueue(config.queue, Buffer.from(JSON.stringify({ requestId })), {
        persistent: true,
        messageId: requestId,
        contentType: 'application/json'
      });
      await channel.waitForConfirms();
      await client.query('UPDATE outbox SET published_at = now() WHERE request_id = $1', [requestId]);
      return true;
    });
    if (Date.now() - lastReconcile > 60000) {
      await reconcile();
      lastReconcile = Date.now();
    }
    if (!published) await pause(250);
  } catch (error) {
    console.error('Publisher error:', error);
    await pause(1000);
  }
}
