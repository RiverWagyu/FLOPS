export const MARKETS = [
  { id: 0, symbol: "H100", name: "NVIDIA H100 80GB", vram: "80 GB HBM3", tier: "Frontier training" },
  { id: 1, symbol: "A100", name: "NVIDIA A100 80GB", vram: "80 GB HBM2e", tier: "Training & inference" },
  { id: 2, symbol: "RTX4090", name: "NVIDIA RTX 4090", vram: "24 GB GDDR6X", tier: "Fine-tuning & inference" },
  { id: 3, symbol: "L40S", name: "NVIDIA L40S", vram: "48 GB GDDR6", tier: "Inference & rendering" },
] as const;

export type MarketMeta = (typeof MARKETS)[number];

export function marketBySymbol(symbol: string): MarketMeta | undefined {
  return MARKETS.find((m) => m.symbol.toLowerCase() === symbol.toLowerCase());
}
