// Called inside a database transaction. Row locking and the conditional UPDATE
// make duplicate queue deliveries and concurrent workers safe.
export async function finalizeOrder(client, requestId) {
  const order = await client.query('SELECT status, product_id FROM orders WHERE request_id = $1 FOR UPDATE', [requestId]);
  if (!order.rowCount || order.rows[0].status !== 'pending') return 'already_processed';
  const stock = await client.query(
    'UPDATE inventory SET stock = stock - 1 WHERE product_id = $1 AND stock > 0 RETURNING stock',
    [order.rows[0].product_id]
  );
  const status = stock.rowCount ? 'confirmed' : 'failed';
  await client.query('UPDATE orders SET status = $2, updated_at = now() WHERE request_id = $1', [requestId, status]);
  return status;
}
