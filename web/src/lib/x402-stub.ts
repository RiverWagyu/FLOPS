// Stub for @x402/* packages: optional crypto-payment helpers referenced by @coinbase/cdp-sdk
// (pulled in by the Base Account wallet SDK). FLOPS never uses x402 payments.
const unavailable = () => {
  throw new Error("x402 payments are not available in this app");
};

export const toClientEvmSigner = unavailable;
export const x402Client = unavailable;
export const registerExactEvmScheme = unavailable;
export const ExactEvmScheme = unavailable;
export const UptoEvmScheme = unavailable;
export const ExactSvmScheme = unavailable;
export const registerExactSvmScheme = unavailable;
export default {};
