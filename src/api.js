import express from 'express';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { pool, inTransaction } from './db.js';
import { redis, reserve, release, markRecorded, remainingSlots } from './reservation.js';

const app = express();
app.use(express.json({ limit: '8kb' }));
const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/sale', async (_req, res) => {
  try { res.json({ productId: config.productId, remainingSlots: await remainingSlots() }); }
  catch { res.status(503).json({ error: 'Sale temporarily unavailable' }); }
});

app.post('/api/purchase', async (req, res) => {
  const { buyerId, productId } = req.body ?? {};
  if (!isUuid(buyerId) || productId !== config.productId) {
    return res.status(400).json({ error: 'Valid buyerId and productId are required' });
  }
  const requestId = randomUUID();
  let reservation;
  try {
    reservation = await reserve(buyerId, requestId);
    if (reservation.kind === 'sold_out') return res.status(409).json({ status: 'sold_out' });
    if (reservation.kind === 'duplicate') {
      return res.status(202).json({ requestId: reservation.requestId, status: 'processing', statusUrl: `/api/purchase/${reservation.requestId}` });
    }
    await inTransaction(async client => {
      await client.query(
        'INSERT INTO orders(request_id, buyer_id, product_id, status) VALUES ($1, $2, $3, $4)',
        [requestId, buyerId, productId, 'pending']
      );
      await client.query('INSERT INTO outbox(request_id) VALUES ($1)', [requestId]);
    });
  } catch (error) {
    console.error('Purchase acceptance failed:', error);
    // Refund only when we can prove no durable order was recorded.
    if (reservation?.kind === 'reserved') {
      try {
        const found = await pool.query('SELECT 1 FROM orders WHERE request_id = $1', [requestId]);
        if (found.rowCount === 0) await release(buyerId, requestId);
      } catch (checkError) { console.error('Reservation needs reconciliation:', requestId, checkError); }
    }
    return res.status(503).json({ error: 'Purchase temporarily unavailable; retry with the same buyer ID' });
  }
  try { await markRecorded(requestId); }
  catch (error) { console.error('Redis status update failed; durable order exists:', requestId, error); }
  res.status(202).json({ requestId, status: 'processing', statusUrl: `/api/purchase/${requestId}` });
});

app.get('/api/purchase/:requestId', async (req, res) => {
  if (!isUuid(req.params.requestId)) return res.status(400).json({ error: 'Invalid request ID' });
  try {
    const result = await pool.query('SELECT status FROM orders WHERE request_id = $1', [req.params.requestId]);
    if (result.rowCount) return res.json({ requestId: req.params.requestId, status: result.rows[0].status });
    const reservation = await redis.get(`sale:phone-1:request:${req.params.requestId}`);
    if (reservation?.startsWith('reserved:')) return res.json({ requestId: req.params.requestId, status: 'processing' });
    res.status(404).json({ error: 'Request not found' });
  } catch (error) {
    console.error('Status lookup failed:', error);
    res.status(503).json({ error: 'Status temporarily unavailable' });
  }
});

await redis.connect();
await pool.query('SELECT 1');
app.listen(config.port, '0.0.0.0', () => console.log(`API listening on ${config.port}`));
