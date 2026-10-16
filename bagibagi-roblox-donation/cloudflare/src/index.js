// Pintu masuk Cloudflare Worker + Durable Object penyimpan antrean.
import { DurableObject } from 'cloudflare:workers';
import { handleRequest } from './app.js';
import { Queue } from './queue.js';

// Satu objek bernama "main" menyimpan seluruh antrean (data tahan lama).
export class DonationQueue extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.queue = new Queue(ctx.storage, { maxQueue: Number(env.MAX_QUEUE) || 500 });
  }
  push(donation) {
    return this.queue.push(donation);
  }
  list(after) {
    return this.queue.list(after);
  }
  top() {
    return this.queue.top();
  }
}

const getQueue = (env) => env.QUEUE.get(env.QUEUE.idFromName('main'));

export default {
  fetch: (request, env) => handleRequest(request, env, getQueue),
};
