const buyButton = document.querySelector('#buy');
const stockText = document.querySelector('#stock');
const message = document.querySelector('#message');
const buyerKey = 'flashSaleBuyerId';
const requestKey = 'flashSaleRequestId';

let buyerId = localStorage.getItem(buyerKey);
if (!buyerId) {
  buyerId = crypto.randomUUID();
  localStorage.setItem(buyerKey, buyerId);
}

function show(text) { message.textContent = text; }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function loadStock() {
  try {
    const response = await fetch('/api/sale');
    if (!response.ok) throw new Error('Sale unavailable');
    const sale = await response.json();
    stockText.textContent = sale.remainingSlots;
    buyButton.disabled = sale.remainingSlots === 0 || Boolean(localStorage.getItem(requestKey));
    if (!localStorage.getItem(requestKey)) show(sale.remainingSlots ? 'Ready to buy.' : 'Sold out.');
  } catch {
    stockText.textContent = 'Unavailable';
    buyButton.disabled = true;
    show('Cannot connect. Refresh the page to try again.');
  }
}

async function trackOrder(requestId) {
  for (;;) {
    try {
      const response = await fetch(`/api/purchase/${requestId}`);
      if (response.status === 404) {
        // The demo may have been reset while the browser kept an old request ID.
        localStorage.removeItem(requestKey);
        await loadStock();
        return;
      }
      if (!response.ok) throw new Error('Status unavailable');
      const order = await response.json();
      if (order.status === 'confirmed') { show('Confirmed! Your order was placed.'); return; }
      if (order.status === 'failed') { show('Sorry, your order failed.'); return; }
      show('Processing your order…');
    } catch {
      show('Waiting for an update…');
    }
    await wait(2000);
  }
}

buyButton.addEventListener('click', async () => {
  buyButton.disabled = true;
  show('Sending your request…');
  try {
    const response = await fetch('/api/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: 'phone-1', buyerId })
    });
    const result = await response.json();
    if (result.status === 'sold_out') { await loadStock(); return; }
    if (!response.ok) throw new Error('Could not send your request');
    localStorage.setItem(requestKey, result.requestId);
    show('Request accepted. Processing your order…');
    trackOrder(result.requestId);
  } catch {
    show('Something went wrong. Please try again.');
    await loadStock();
  }
});

async function start() {
  const previousRequest = localStorage.getItem(requestKey);
  await loadStock();
  if (previousRequest) {
    show('Checking your order…');
    trackOrder(previousRequest);
  }
}

start();
