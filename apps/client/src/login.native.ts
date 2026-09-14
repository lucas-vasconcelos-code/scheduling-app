import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { API } from "./api";
export async function login() {
  const bytes = await Crypto.getRandomBytesAsync(32),
    verifier = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const challenge = (
    await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      verifier,
      { encoding: Crypto.CryptoEncoding.BASE64 },
    )
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  await SecureStore.setItemAsync("aligned-oauth-verifier", verifier);
  const result = await WebBrowser.openAuthSessionAsync(
    API + "/auth/google?challenge=" + challenge,
    "aligned://auth",
  );
  if (result.type === "success") {
    const url = new URL(result.url);
    router.replace({
      pathname: "/auth",
      params: {
        code: url.searchParams.get("code") ?? "",
        error: url.searchParams.get("error") ?? "",
      },
    });
  } else {
    await SecureStore.deleteItemAsync("aligned-oauth-verifier");
    throw new Error(
      "Sign-in was cancelled. You can try again whenever you are ready.",
    );
  }
}
