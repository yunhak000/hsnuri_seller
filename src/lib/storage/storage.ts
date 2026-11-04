import localforage from "localforage";
import { TAppState } from "@/lib/types";

const KEY = "hansom-order-tool:v1";

let pending: Promise<unknown> = Promise.resolve();
const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
  const task = pending.catch(() => undefined).then(operation);
  pending = task;
  return task;
};

localforage.config({
  name: "hansom-order-tool",
  storeName: "app",
});

export const saveState = async (state: TAppState) => {
  // ArrayBuffer는 localforage가 저장 가능
  await enqueue(() => localforage.setItem(KEY, state));
};

export const loadState = async (): Promise<TAppState | null> => {
  const v = await enqueue(() => localforage.getItem<TAppState>(KEY));
  return v ?? null;
};

export const clearState = async () => {
  await enqueue(() => localforage.removeItem(KEY));
};
