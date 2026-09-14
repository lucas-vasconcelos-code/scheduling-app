import { api } from "./api";
let recognition: any,
  recorder: MediaRecorder | undefined,
  stream: MediaStream | undefined;
export async function startVoice(
  onText: (text: string) => void,
  onState: (state: string) => void,
  onError: (message: string) => void,
) {
  const Speech =
    (window as any).SpeechRecognition ??
    (window as any).webkitSpeechRecognition;
  if (Speech) {
    recognition = new Speech();
    recognition.lang = navigator.language;
    recognition.interimResults = true;
    recognition.onstart = () => onState("Listening");
    recognition.onresult = (e: any) => {
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++)
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
      onState("Listening");
      if (final) onText(final);
    };
    recognition.onerror = (e: any) => {
      onState("");
      onError(
        e.error === "not-allowed"
          ? "Microphone permission denied. You can keep typing."
          : "Speech recognition stopped. Try again or type your request.",
      );
    };
    recognition.onend = () => onState("");
    recognition.start();
    return;
  }
  const config = await api("/api/v1/config");
  if (!config.voiceUpload)
    throw new Error(
      "Speech recognition is unavailable in this browser. You can keep typing.",
    );
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = MediaRecorder.isTypeSupported("audio/webm")
    ? "audio/webm"
    : "audio/mp4";
  recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  recorder.onstop = async () => {
    stream?.getTracks().forEach((t) => t.stop());
    onState("Transcribing");
    try {
      const form = new FormData();
      form.append(
        "audio",
        new Blob(chunks, { type: mimeType }),
        "voice." + (mimeType.includes("mp4") ? "mp4" : "webm"),
      );
      const r = await api("/transcribe", "POST", form);
      onText(r.transcript);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      onState("");
    }
  };
  recorder.start();
  onState("Listening");
}
export function stopVoice() {
  recognition?.stop();
  if (recorder?.state === "recording") recorder.stop();
}
export function disposeVoice() {
  recognition?.abort();
  if (recorder?.state === "recording") {
    recorder.onstop = null;
    recorder.stop();
  }
  stream?.getTracks().forEach((t) => t.stop());
}
