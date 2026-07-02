import { useRef } from 'react';
import { NetworkError } from '../api/client';
import { generateUuid } from './uuid';

// Keeps the Idempotency-Key across retries after a network failure;
// any server response (success or error) invalidates the key.
export function useIdempotentAction() {
  const keyRef = useRef<string | null>(null);
  return async function run<T>(action: (key: string) => Promise<T>): Promise<T> {
    const key = keyRef.current ?? generateUuid();
    keyRef.current = key;
    try {
      const result = await action(key);
      keyRef.current = null;
      return result;
    } catch (error) {
      if (!(error instanceof NetworkError)) keyRef.current = null;
      throw error;
    }
  };
}
