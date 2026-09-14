import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { unlink } from "node:fs/promises";
import { ServiceError } from "./calendar.js";
const exec = promisify(execFile);
export async function transcribe(path: string) {
  const wav = path + ".wav";
  try {
    if (!process.env.WHISPER_CLI || !process.env.WHISPER_MODEL)
      throw new ServiceError(
        503,
        "Voice upload is not configured. Use device recognition or type your request.",
      );
    await exec(
      "ffmpeg",
      ["-y", "-i", path, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav],
      { timeout: 30000, maxBuffer: 2 * 1024 * 1024 },
    );
    const { stdout } = await exec(
      process.env.WHISPER_CLI,
      ["-m", process.env.WHISPER_MODEL, "-f", wav, "-nt"],
      { timeout: 60000, maxBuffer: 2 * 1024 * 1024 },
    );
    const transcript = stdout
      .split("\n")
      .map((v) => v.trim())
      .filter((v) => v && !/^\[.*\]$/.test(v))
      .join(" ");
    if (!transcript)
      throw new ServiceError(
        422,
        "No speech was detected. Try again or type your request.",
      );
    return transcript;
  } finally {
    await Promise.allSettled([unlink(path), unlink(wav)]);
  }
}
