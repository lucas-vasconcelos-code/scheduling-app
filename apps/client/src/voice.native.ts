import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
let subscriptions: { remove: () => void }[] = [];
export async function startVoice(
  onText: (text: string) => void,
  onState: (state: string) => void,
  onError: (message: string) => void,
) {
  const permission =
    await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  if (!permission.granted)
    throw new Error("Microphone permission denied. You can keep typing.");
  disposeVoice();
  subscriptions = [
    ExpoSpeechRecognitionModule.addListener("result", (e) => {
      if (e.isFinal && e.results[0]) onText(e.results[0].transcript);
    }),
    ExpoSpeechRecognitionModule.addListener("end", () => onState("")),
    ExpoSpeechRecognitionModule.addListener("error", (e) => {
      onState("");
      onError(e.message);
    }),
  ];
  onState("Listening");
  ExpoSpeechRecognitionModule.start({
    lang: "en-US",
    interimResults: true,
    continuous: false,
  });
}
export function stopVoice() {
  ExpoSpeechRecognitionModule.stop();
}
export function disposeVoice() {
  subscriptions.forEach((s) => s.remove());
  subscriptions = [];
  ExpoSpeechRecognitionModule.abort();
}
