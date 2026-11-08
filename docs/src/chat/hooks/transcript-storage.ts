import {
  type ChatClientPersistence,
  localStoragePersistence,
} from "@tanstack/ai-react";
import {
  deserializeTranscript,
  serializeTranscript,
  TRANSCRIPT_KEY_PREFIX,
} from "../lib/chat-history";

/**
 * The one transcript, kept by `useChat` (D12). An invalid stored transcript is
 * removed on the read that finds it: the library treats a throwing adapter as
 * "nothing stored" but would leave the bad value in place.
 */
export function createTranscriptStorage(): ChatClientPersistence {
  const storage = localStoragePersistence({
    keyPrefix: TRANSCRIPT_KEY_PREFIX,
    serialize: serializeTranscript,
    deserialize: deserializeTranscript,
  });
  return {
    getItem(id) {
      try {
        return storage.getItem(id);
      } catch {
        try {
          Promise.resolve(storage.removeItem(id)).catch(() => {});
        } catch {
          // No storage to clean: the chat starts empty either way.
        }
        return null;
      }
    },
    setItem: (id, state) => storage.setItem(id, state),
    removeItem: (id) => storage.removeItem(id),
  };
}
