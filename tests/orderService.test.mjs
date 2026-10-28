import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeOrder } from '../src/orderService.js';

function fakeClient(initialStock, initialStatus = 'pending') {
  const state = { stock: initialStock, status: initialStatus, decrements: 0 };
  return {
    state,
    async query(sql, params) {
      if (sql.startsWith('SELECT status')) return { rowCount: 1, rows: [{ status: state.status, product_id: 'phone-1' }] };
      if (sql.startsWith('UPDATE inventory')) {
        if (!state.stock) return { rowCount: 0, rows: [] };
        state.stock--;
        state.decrements++;
        return { rowCount: 1, rows: [{ stock: state.stock }] };
      }
      if (sql.startsWith('UPDATE orders')) { state.status = params[1]; return { rowCount: 1 }; }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
}

test('one stock decrement and confirmation', async () => {
  const client = fakeClient(1);
  assert.equal(await finalizeOrder(client, 'request-1'), 'confirmed');
  assert.deepEqual(client.state, { stock: 0, status: 'confirmed', decrements: 1 });
});

test('retry does not decrement stock again', async () => {
  const client = fakeClient(1);
  await finalizeOrder(client, 'request-1');
  assert.equal(await finalizeOrder(client, 'request-1'), 'already_processed');
  assert.equal(client.state.decrements, 1);
});

test('out of stock request fails without decrement', async () => {
  const client = fakeClient(0);
  assert.equal(await finalizeOrder(client, 'request-2'), 'failed');
  assert.deepEqual(client.state, { stock: 0, status: 'failed', decrements: 0 });
});
