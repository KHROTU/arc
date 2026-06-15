import { useEffect, useState } from "react";
import ArcChat from "./components/ArcChat";
import { createClient, type RpcClient } from "./rpc";
export default function App({ mode, monoLogo, prideLogo, monoLogoText, prideLogoText, prideActive, version }: { mode: "sidebar" | "fullscreen"; monoLogo: string; prideLogo: string; monoLogoText: string; prideLogoText: string; prideActive: boolean; version: string }) {
  const [client, setClient] = useState<RpcClient | null>(null);
  useEffect(() => {
    const c = createClient();
    setClient(c);
  }, []);
  if (!client) return null;
  return <ArcChat client={client} monoLogo={monoLogo} prideLogo={prideLogo} monoLogoText={monoLogoText} prideLogoText={prideLogoText} prideActive={prideActive} variant={mode} version={version} />;
}