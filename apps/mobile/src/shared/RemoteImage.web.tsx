import type { RemoteImageProps } from "./remote-image";

/**
 * A picture from the server (signed URL). A plain <img> so the browser loads it lazily and
 * decodes off the main thread: long libraries only fetch the thumbnails on screen.
 */
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
    <img
      src={uri}
      alt={label ?? ""}
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={(event) => {
        const { naturalWidth: w, naturalHeight: h } = event.currentTarget;
        if (w && h) onSize?.(w, h);
      }}
      onError={onError}
      style={{
        display: "block",
        width,
        height,
        objectFit: fit,
        borderRadius: radius,
        backgroundColor: fit === "contain" ? "transparent" : "#EEF0F2",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    />
  );
}
