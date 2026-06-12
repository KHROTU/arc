import { useEffect, useState } from "react";
import ArcChat from "./components/ArcChat";
import Playground from "./components/Playground";
import SettingsView from "./components/SettingsView";
import { createClient, type RpcClient } from "./rpc";
export default function App({ mode, monoLogo, prideLogo, prideActive, compressIcon }: { mode: "sidebar" | "fullscreen" | "playground" | "settings"; monoLogo: string; prideLogo: string; prideActive: boolean; compressIcon?: string }) {
  const [client, setClient] = useState<RpcClient | null>(null);
  useEffect(() => {
    if (mode === "playground") return;
    const c = createClient();
    setClient(c);
  }, [mode]);
  if (mode === "playground") return <Playground monoLogo={monoLogo} prideLogo={prideLogo} prideActive={prideActive} />;
  if (mode === "settings") {
    if (!client) return null;
    return <SettingsView client={client} monoLogo={monoLogo} prideLogo={prideLogo} prideActive={prideActive} />;
  }
  if (!client) return null;
  return <ArcChat client={client} monoLogo={monoLogo} prideLogo={prideLogo} prideActive={prideActive} variant={mode} compressIcon={compressIcon} />;
}