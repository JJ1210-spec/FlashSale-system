import { pool } from './db.js';
import { redis } from './reservation.js';
import { config } from './config.js';

if (!Number.isInteger(config.stock) || config.stock < 1) throw new Error('SALE_STOCK must be a positive integer');

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory (
      product_id TEXT PRIMARY KEY,
      stock INTEGER NOT NULL CHECK (stock >= 0)
    );
    CREATE TABLE IF NOT EXISTS orders (
      request_id UUID PRIMARY KEY,
      buyer_id UUID NOT NULL,
      product_id TEXT NOT NULL REFERENCES inventory(product_id),
      status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (buyer_id, product_id)
    );
    CREATE TABLE IF NOT EXISTS outbox (
      request_id UUID PRIMARY KEY REFERENCES orders(request_id),
      published_at TIMESTAMPTZ
    );
  `);
  await pool.query('INSERT INTO inventory(product_id, stock) VALUES ($1, $2) ON CONFLICT DO NOTHING', [config.productId, config.stock]);
  await redis.connect();
  const stock = await pool.query('SELECT stock FROM inventory WHERE product_id = $1', [config.productId]);
  await redis.set('sale:phone-1:slots', String(stock.rows[0].stock), { NX: true });
  console.log(`Sale ready: ${config.productId}; database stock ${stock.rows[0].stock}`);
} finally {
  await Promise.allSettled([pool.end(), redis.quit()]);
}
