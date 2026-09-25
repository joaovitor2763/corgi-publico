import { Image } from "react-native";
import type { RemoteImageProps } from "./remote-image";

/** A picture from the server (signed URL); reports its natural size once loaded. */
export default function RemoteImage({
  uri,
  label,
  width,
  height,
  radius = 0,
  fit = "cover",
  onSize,
  onError,
}: RemoteImageProps) {
  return (
    <Image
      accessibilityLabel={label}
      accessible={!!label}
      source={{ uri }}
      resizeMode={fit}
      onLoad={(event) => {
        const { width: w, height: h } = event.nativeEvent.source;
        if (w && h) onSize?.(w, h);
      }}
      onError={onError}
      style={{
        width,
        height,
        borderRadius: radius,
        backgroundColor: fit === "contain" ? "transparent" : "#EEF0F2",
      }}
    />
  );
}
