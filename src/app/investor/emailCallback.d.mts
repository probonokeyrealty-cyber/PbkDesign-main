export function consumeEmailCallback(
  location: { hash: string; pathname: string; search: string },
  history: { replaceState(data: unknown, unused: string, url: string): void }
): { token?: string; error?: string } | null;
