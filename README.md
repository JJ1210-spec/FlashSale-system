# Flash Sale System

A runnable case-study implementation of a flash sale with **500 phones** and many simultaneous buyers. Redis admits at most 500 purchase attempts, RabbitMQ buffers accepted work, and PostgreSQL decides which orders are finally confirmed. The database stock update is the final protection against overselling.

## What you will see

Open `http://localhost:8080` after starting the stack. The page shows the remaining reservation slots, a **Buy now** button, and the result of your purchase. A click first shows **Processing**; it shows **Confirmed** only after the worker commits the order in PostgreSQL. The browser remembers its demo buyer ID and tracking ID across refreshes.

## Requirements

- Docker Desktop with the **Linux container engine** running
- Docker Compose (included with Docker Desktop)
- Node.js 22 or newer and npm, only for running tests from your computer

Ports used on the host:

| Port | Use |
| --- | --- |
| `8080` | Public frontend and API through NGINX |
| `3000` | Direct development API on localhost, used by the load test |

Redis, RabbitMQ, and PostgreSQL remain inside the Docker network. The Compose file contains a demonstration database password; change it before using this outside a local development machine.

## Start the application

In PowerShell, open the folder containing this README and run:

```powershell
docker compose up --build -d
docker compose ps
```

The first run downloads container images and may take a few minutes. `api1`, `api2`, `nginx`, `postgres`, `redis`, `rabbitmq`, `publisher`, and `worker` should be running. The one-time `setup` container should have exited successfully with code 0.

Open <http://localhost:8080>. To check the API directly:

```powershell
Invoke-RestMethod http://localhost:8080/api/health
Invoke-RestMethod http://localhost:8080/api/sale
```

The first command returns `{ "ok": true }`. The second returns the product ID and remaining Redis reservation slots. If the page says **Sold out**, the sale has already used all 500 slots; see [Reset the demo](#reset-the-demo).

## Run the tests

Install local Node dependencies and run the three worker logic tests:

```powershell
npm ci
npm test
```

Run the end-to-end load test **on a fresh sale**:

```powershell
npm run test:load
```

It sends 600 distinct buyers directly to `http://localhost:3000`, bypassing NGINX's per-IP rate limit. On a fresh sale, expect **500 accepted, 100 sold out, 500 confirmed, 0 pending**. It can take about a minute to wait for final statuses. Running it again without resetting the demo will mostly report sold-out responses because inventory is already consumed. Use `BUYERS` and `CONCURRENCY` environment variables to change the load-test size and parallelism.

## How a purchase works

```text
Browser -> NGINX -> API -> Redis atomic reservation
                            |
                            v
                     PostgreSQL pending order + outbox
                            |
                            v
                     Outbox publisher -> RabbitMQ -> Worker
                                                   |
                                                   v
                                         PostgreSQL final stock update
                                                   |
                                                   v
                                         Confirmed or failed status
```

1. The frontend disables the Buy button and sends a buyer ID and product ID to the API.
2. NGINX balances requests across two stateless API containers. Its simple per-IP rate limit returns HTTP 429 when exceeded.
3. A Redis Lua script atomically reserves a slot. A buyer who repeats the request receives the same tracking ID. When no slots remain, the API returns `409` with `sold_out`.
4. The API saves a `pending` order and an outbox entry in one PostgreSQL transaction, then returns `202 Accepted` and a tracking URL. `202` means the request is durably recorded, **not** that the order is confirmed.
5. The publisher sends outbox entries as persistent messages to a durable RabbitMQ queue. It marks an entry published only after RabbitMQ confirms receipt.
6. A worker reads a message and uses a PostgreSQL transaction to reduce stock only if stock is greater than zero. It marks the order `confirmed` only if that update succeeds. The worker acknowledges the queue message after the transaction commits.
7. The frontend polls the tracking URL every two seconds and shows the final status.

The worker checks an order's status before updating stock. If RabbitMQ redelivers a message after a crash, processing it again does not decrement stock twice. If RabbitMQ is temporarily unavailable, unpublished outbox entries remain in PostgreSQL for later delivery. Old Redis reservations without a durable order are reconciled and released.

## API endpoints

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | Simple API health response |
| `GET /api/sale` | Product ID and remaining Redis reservation slots |
| `POST /api/purchase` | Start or retrieve one buyer's purchase attempt |
| `GET /api/purchase/:requestId` | Read `pending`, `confirmed`, or `failed` status |

Example request body for `POST /api/purchase`:

```json
{ "productId": "phone-1", "buyerId": "5f3ed21b-2f42-4295-b58d-275999e5abda" }
```

An accepted response has HTTP status `202` and contains `requestId`, `status`, and `statusUrl`. A sold-out response has HTTP status `409` and `status: "sold_out"`. The browser generates and stores a UUID buyer ID automatically. There is no real authentication or payment integration.

## Stop or reset

Stop containers while keeping orders and inventory:

```powershell
docker compose down
```

**Reset the demo to 500 phones** by deleting this project's Docker volumes, including all demo orders:

```powershell
docker compose down -v
docker compose up --build -d
```

The page clears an old tracking ID if its order no longer exists after a reset. A fresh private browser window is another way to start with a new demo buyer ID.

## Troubleshooting

```powershell
docker compose ps --all
docker compose logs --tail=100 publisher worker rabbitmq postgres nginx
```

- **Docker connection error:** Start Docker Desktop and wait for its engine to be running. Use Linux containers.
- **Page not available:** Check `docker compose ps --all`; NGINX must be running and port 8080 must be free.
- **Orders stay pending:** Check the publisher and worker logs. Both services retry RabbitMQ startup and are configured to restart after a connection closes. The outbox retains accepted work.
- **Page says Sold out:** All Redis slots were reserved. Reset the demo if you want another fresh sale.
- **Load test gets sold-out responses only:** It was run after inventory had already been consumed. Reset the demo and rerun it before making browser purchases.
- **Frontend changes do not appear:** Refresh the browser. The `public` directory is mounted into NGINX, so frontend edits do not require an image rebuild. Backend code changes do require `docker compose up --build -d`.

## Project layout

| Path | Responsibility |
| --- | --- |
| `public/` | Plain HTML, CSS, and JavaScript frontend |
| `src/api.js` | Purchase, sale, and tracking endpoints |
| `src/reservation.js` | Atomic Redis reservation and recovery scripts |
| `src/setup.js` | Database schema and initial inventory |
| `src/publisher.js` | PostgreSQL outbox to RabbitMQ |
| `src/worker.js`, `src/orderService.js` | Queue consumption and final database transaction |
| `tests/` | Worker logic tests and concurrent load test |
| `compose.yaml`, `Dockerfile`, `nginx.conf` | Local multi-service environment |

## Scope

This is a case-study demo, not a production checkout. It does not include real accounts, payments, a CDN, a dedicated bot-blocking service, observability, or a sale-management interface. The frontend's available count represents Redis reservations; PostgreSQL inventory and order status are authoritative. The enforced guarantee is **at most 500 confirmed orders**; a system cannot guarantee exactly 500 successful purchases if buyers or dependencies fail.
