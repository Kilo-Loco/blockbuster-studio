// Who made the current request: a person signed in with the password, or an agent with the token.
// Carried through the request with AsyncLocalStorage so the queue can tag jobs without every route
// passing it along.
import { AsyncLocalStorage } from 'node:async_hooks';

export type Actor = 'human' | 'agent';

const store = new AsyncLocalStorage<Actor>();

export function runAs<T>(actor: Actor, fn: () => T): T {
  return store.run(actor, fn);
}

/** The actor of the request being handled, or undefined outside a request (startup, the queue loop). */
export function currentActor(): Actor | undefined {
  return store.getStore();
}
