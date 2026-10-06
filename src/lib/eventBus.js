import { EventEmitter } from 'node:events';

// In-process pub/sub. With more than one API instance this becomes Redis pub/sub,
// and publish/subscribe keep the same signatures.
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export const channels = {
  search: (searchId) => `search:${searchId}`,
};

export function publish(channel, message) {
  emitter.emit(channel, message);
}

/** @returns {() => void} unsubscribe */
export function subscribe(channel, handler) {
  emitter.on(channel, handler);
  return () => emitter.off(channel, handler);
}
