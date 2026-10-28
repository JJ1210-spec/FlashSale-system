// Run against the direct development API, which bypasses the gateway's per-IP rate limit.
const base = process.env.API_URL ?? 'http://localhost:3000';
const buyers = Number(process.env.BUYERS ?? 600);
const concurrency = Number(process.env.CONCURRENCY ?? 30);
const outcomes = [];
let next = 0;

async function sendOne() {
  const buyerId = crypto.randomUUID();
  const response = await fetch(`${base}/api/purchase`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buyerId, productId: 'phone-1' })
  });
  const result = await response.json();
  outcomes.push({ code: response.status, ...result });
}

await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < buyers) { next++; await sendOne(); }
}));

const accepted = outcomes.filter(o => o.code === 202);
const soldOut = outcomes.filter(o => o.status === 'sold_out');
const unexpected = outcomes.filter(o => o.code !== 202 && o.status !== 'sold_out');
console.log({ buyers, accepted: accepted.length, soldOut: soldOut.length, unexpected: unexpected.length });
if (unexpected.length) throw new Error(`Unexpected responses: ${JSON.stringify(unexpected.slice(0, 3))}`);

let pending = accepted.map(o => o.requestId);
let confirmed = 0;
let failed = 0;
for (let attempt = 0; attempt < 60 && pending.length; attempt++) {
  await new Promise(resolve => setTimeout(resolve, 1000));
  const statuses = await Promise.all(pending.map(async id => (await (await fetch(`${base}/api/purchase/${id}`)).json())));
  pending = statuses.filter(s => s.status === 'pending' || s.status === 'processing').map(s => s.requestId);
  confirmed += statuses.filter(s => s.status === 'confirmed').length;
  failed += statuses.filter(s => s.status === 'failed').length;
}
console.log({ confirmed, failed, pending: pending.length });
if (pending.length || confirmed > 500) throw new Error('Sale invariant or completion check failed');
