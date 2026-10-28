import { config } from './config.js';
import { inTransaction } from './db.js';
import { finalizeOrder } from './orderService.js';
import { connectAmqp } from './amqp.js';

const connection = await connectAmqp();
const channel = await connection.createChannel();
await channel.assertQueue(config.queue, { durable: true });
await channel.prefetch(8);

await channel.consume(config.queue, async message => {
  if (!message) return;
  try {
    const { requestId } = JSON.parse(message.content.toString());
    await inTransaction(client => finalizeOrder(client, requestId));
    channel.ack(message);
  } catch (error) {
    console.error('Worker error; retrying:', error);
    setTimeout(() => channel.nack(message, false, true), 1000);
  }
}, { noAck: false });
console.log('Worker ready');
