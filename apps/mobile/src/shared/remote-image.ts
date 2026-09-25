export interface RemoteImageProps {
  uri: string;
  label?: string;
  width: number | `${number}%`;
  height: number | `${number}%`;
  radius?: number;
  fit?: "cover" | "contain";
  onSize?: (width: number, height: number) => void;
  onError?: () => void;
}
