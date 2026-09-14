import { it, expect, vi } from "vitest";
import { mkdtemp, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcribe } from "../apps/server/src/transcribe.js";
it("cleans uploaded audio when optional Whisper is unavailable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aligned-voice-test-")),
    file = join(directory, "audio.webm");
  await writeFile(file, "synthetic audio");
  vi.stubEnv("WHISPER_CLI", "");
  vi.stubEnv("WHISPER_MODEL", "");
  try {
    await expect(transcribe(file)).rejects.toMatchObject({ status: 503 });
    await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});
