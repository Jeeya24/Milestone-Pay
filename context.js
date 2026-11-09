// Per-request context (who is acting), so deep code such as ai_runs logging can attribute work to a user.
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();

export const runWithUser = (userId, fn) => als.run({ userId: userId || null }, fn);
export const currentUserId = () => als.getStore()?.userId ?? null;
