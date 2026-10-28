export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://sale:sale_dev_password@localhost:5432/sale',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  amqpUrl: process.env.AMQP_URL ?? 'amqp://localhost:5672',
  stock: Number(process.env.SALE_STOCK ?? 500),
  port: Number(process.env.PORT ?? 3000),
  productId: 'phone-1',
  queue: 'purchase-orders'
};
