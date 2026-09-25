// Dictation: tap to record, tap again to stop; the words land in the composer to review and send.
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useState } from "react";
import type { MuseApi } from "../../shared/api";
import { tap } from "../../shared/haptics";
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
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const { isRecording, durationMillis } = useAudioRecorderState(recorder, 250);
  const [transcribing, setTranscribing] = useState(false);
  async function start() {
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted)
      return onError("Libere o microfone para o Corgi em Ajustes para ditar mensagens.");
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    tap();
  }
  async function finish() {
    tap();
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    const uri = recorder.uri;
    if (!uri) return onError("A gravação não foi salva. Tente de novo.");
    setTranscribing(true);
    try {
      const form = new FormData();
      // React Native sends a { uri, name, type } part as the file itself.
      form.append("audio", { uri, name: "voz.m4a", type: "audio/m4a" } as unknown as Blob);
      const { text } = await api.request<{ text: string }>("/api/transcribe", form);
      if (text) onText(text);
      else onError("Não ouvi nada nessa gravação.");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setTranscribing(false);
    }
  }
  return (
    <VoiceControl
      recording={isRecording}
      transcribing={transcribing}
      seconds={Math.floor((durationMillis ?? 0) / 1000)}
      disabled={disabled}
      onPress={() => void (isRecording ? finish() : start()).catch((e) => onError(String(e)))}
    />
  );
}
