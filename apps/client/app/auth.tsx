import { useEffect, useState } from "react";
import { Text, View, Button } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useQueryClient } from "@tanstack/react-query";
import { api, saveSession } from "../src/api";
// A return link may be delivered twice by the OS/router; exchange once per code.
const completions = new Map<string, Promise<void>>();
function finish(code: string) {
  let completion = completions.get(code);
  if (!completion) {
    completion = (async () => {
      const verifier = await SecureStore.getItemAsync("aligned-oauth-verifier");
      const s = await api("/auth/exchange", "POST", { code, verifier });
      await saveSession(s);
      await SecureStore.deleteItemAsync("aligned-oauth-verifier");
    })();
    completions.set(code, completion);
    if (completions.size > 5)
      completions.delete(completions.keys().next().value!);
  }
  return completion;
}
export default function Auth() {
  const query = useQueryClient();
  const { code, error: cancelled } = useLocalSearchParams<{
      code: string;
      error?: string;
    }>(),
    [error, setError] = useState("Finishing sign-in…");
  useEffect(() => {
    void (async () => {
      try {
        if (cancelled || !code)
          throw new Error("Google sign-in was cancelled. Please try again.");
        await finish(code);
        query.removeQueries({ queryKey: ["state"] });
        await query.invalidateQueries({ queryKey: ["session"] });
        router.replace("/");
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [code]);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>{error}</Text>
      <Button title="Back to Aligned" onPress={() => router.replace("/")} />
    </View>
  );
}
