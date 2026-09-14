import "../src/background";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 15000 },
    mutations: { retry: false },
  },
});
export default function Layout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={client}>
        <Stack screenOptions={{ headerShown: false, animation: "fade" }} />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
