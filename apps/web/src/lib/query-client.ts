import { QueryClient } from "@tanstack/react-query";

/**
 * App-wide QueryClient. Pages fetch client-side (no SSR prefetch of the API),
 * so a single instance is safe and keeps cache invalidation simple.
 */
export const queryClient = new QueryClient();
