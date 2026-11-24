import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ClientProviders } from "./client-providers";
import { Header } from "@/components/Header";
import { Assistant } from "@/components/Assistant";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-jb" });

export const metadata: Metadata = {
  title: "FLOPS — GPU-hour perpetuals",
  description:
    "Long or short the hourly rental price of H100, A100, RTX 4090 and L40S GPUs with up to 25x leverage. Testnet demo with simulated prices.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <ClientProviders>
          <Header />
          <main className="mx-auto w-full max-w-[1600px] px-2 pb-8 sm:px-3">{children}</main>
          <Assistant />
        </ClientProviders>
      </body>
    </html>
  );
}
