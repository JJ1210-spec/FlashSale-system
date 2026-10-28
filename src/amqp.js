import amqp from 'amqplib';
import { config } from './config.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function connectAmqp() {
  for (;;) {
    try {
      const connection = await amqp.connect(config.amqpUrl);
      connection.on('close', () => {
        console.error('RabbitMQ connection closed; restarting service');
        process.exit(1);
      });
      connection.on('error', error => console.error('RabbitMQ connection error:', error));
      return connection;
    } catch (error) {
      console.error('RabbitMQ not ready; retrying:', error.message);
      await pause(1000);
    }
  }
}
