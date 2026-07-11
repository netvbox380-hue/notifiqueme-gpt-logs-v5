import { httpBatchLink } from "@trpc/client";
import { QueryClient } from "@tanstack/react-query";
import superjson from "superjson";
import { trpc } from "./trpc";

// ==============================
// Query Client
// ==============================
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// ==============================
// Resolver URL da API
// ==============================

function getBaseUrl() {
  // Se definido no .env do frontend
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  // Produção (mesmo domínio)
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  // Fallback SSR
  return "http://localhost:10000";
}

// ==============================
// tRPC Client
// ==============================
export const trpcClient = trpc.createClient({
  transformer: superjson,
  links: [
    httpBatchLink({
      url: `${getBaseUrl()}/api/trpc`,
      fetch(url, options) {
        return fetch(url, {
          ...options,
          credentials: "include", // 🔴 essencial para cookies
        });
      },
    }),
  ],
});
