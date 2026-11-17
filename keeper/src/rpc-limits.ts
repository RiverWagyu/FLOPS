/**
 * If the RPC rejects a log query for spanning too many blocks, the size it should use instead.
 * Public endpoints differ (sepolia.base.org allows 200); returns null for unrelated errors.
 */
export function smallerChunk(message: string, current: bigint): bigint | null {
  const stated = /limited to an? (\d+)[ -]?(?:block )?range|maximum (?:block )?range (?:of |is )?(\d+)/i.exec(message);
  if (stated) {
    const n = BigInt(stated[1] ?? stated[2]);
    return n < current ? n : current > 1n ? current / 2n : null;
  }
  if (/block range|range (?:is )?too (?:large|wide)|too many (?:blocks|results|logs)|exceed/i.test(message)) {
    return current > 1n ? current / 2n : null;
  }
  return null;
}
