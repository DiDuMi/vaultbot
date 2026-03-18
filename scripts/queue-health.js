const { Queue } = require("bullmq");
const IORedis = require("ioredis");

const connection = new IORedis("redis://127.0.0.1:6379", { maxRetriesPerRequest: null });
const queue = new Queue("replication", { connection });

queue
  .add("health", { ok: true })
  .then(() => queue.close())
  .then(() => connection.quit())
  .then(() => {
    console.log("queue ok");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
