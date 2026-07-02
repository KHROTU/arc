export function useArcLogo(_monoUri: string, prideUri: string, hostChoice: boolean): string {
  return hostChoice ? prideUri : _monoUri;
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