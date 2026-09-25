// Dictation on the web: the browser's recorder, then the same transcription as the phone.
import { useEffect, useRef, useState } from "react";
import type { MuseApi } from "../../shared/api";
import { VoiceControl } from "./voice-control";

export function VoiceButton({
  api,
  onText,
  onError,
  disabled,
}: {
  api: MuseApi;
  onText: (text: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const recorder = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, [recording]);
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices) return null;
  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks: Blob[] = [];
    const media = new MediaRecorder(stream);
    media.ondataavailable = (event) => chunks.push(event.data);
    media.onstop = async () => {
      for (const track of stream.getTracks()) track.stop();
      setRecording(false);
      setTranscribing(true);
      try {
        const type = media.mimeType || "audio/webm";
        const form = new FormData();
        form.append(
          "audio",
          new Blob(chunks, { type }),
          type.includes("mp4") ? "voz.m4a" : "voz.webm",
        );
        const { text } = await api.request<{ text: string }>("/api/transcribe", form);
        if (text) onText(text);
        else onError("Não ouvi nada nessa gravação.");
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      } finally {
        setTranscribing(false);
      }
    };
    recorder.current = media;
    media.start();
    setSeconds(0);
    setRecording(true);
  }
  return (
    <VoiceControl
      recording={recording}
      transcribing={transcribing}
      seconds={seconds}
      disabled={disabled}
      onPress={() =>
        recording
          ? recorder.current?.stop()
          : void start().catch(() => onError("Libere o microfone no navegador para ditar."))
      }
    />
  );
}
