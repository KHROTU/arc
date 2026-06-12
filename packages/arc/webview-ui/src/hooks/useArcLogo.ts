import { useState, useEffect } from "react";
export function useArcLogo(monoUri: string, prideUri: string, hostChoice: boolean): string {
  const [override, setOverride] = useState<string | null>(null);
  useEffect(() => { setOverride(null); }, [monoUri, prideUri, hostChoice]);
  if (override) return override;
  return hostChoice ? prideUri : monoUri;
}
export function swapOnError(fallback: string) {
  return (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.src !== fallback) {
      img.onerror = null;
      img.src = fallback;
    }
  };
}