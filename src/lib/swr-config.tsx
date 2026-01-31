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
        revalidateOnFocus: false, // Don't refetch when window regains focus
        revalidateOnReconnect: false, // Don't refetch on reconnect
        dedupingInterval: 5000, // Dedupe requests within 5 seconds
        keepPreviousData: true, // Keep showing old data while fetching new
      }}
    >
      {children}
    </SWRConfig>
  );
}
