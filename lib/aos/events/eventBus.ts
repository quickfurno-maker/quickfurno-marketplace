import type { AOSEvent } from "../types";

export type AOSEventHandler = (event: AOSEvent) => void | Promise<void>;

export function createEventBus() {
  const handlers: AOSEventHandler[] = [];

  return {
    subscribe(handler: AOSEventHandler) {
      handlers.push(handler);
      return () => {
        const index = handlers.indexOf(handler);
        if (index >= 0) handlers.splice(index, 1);
      };
    },
    async publish(event: AOSEvent) {
      for (const handler of handlers) {
        await handler(event);
      }
    },
  };
}

