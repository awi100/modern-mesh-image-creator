"use client";

import { SWRConfig } from "swr";
import { ReactNode } from "react";

// Default fetcher for SWR
const fetcher = (url: string) => fetch(url).then((res) => res.json());

// SWR configuration with caching
export function SWRProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher,
        revalidateOnFocus: true, // Refetch when the window/tab regains focus, so
        // a page left open self-heals after an edit made elsewhere.
        revalidateOnReconnect: true,
        dedupingInterval: 2000, // Dedupe bursts, but low enough that navigating
        // between pages a couple seconds after an edit still refetches.
        keepPreviousData: true, // Avoid a spinner flash; the fresh value lands right after.
      }}
    >
      {children}
    </SWRConfig>
  );
}
