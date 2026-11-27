import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let factory;

// Keep disabled Redis lanes out of the startup import graph without adding an async race.
export function createRedisClient(options) {
  factory ||= require('redis').createClient;
  return factory(options);
}
