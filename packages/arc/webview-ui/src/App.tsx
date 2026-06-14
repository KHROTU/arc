import { useEffect, useState } from "react";
import ArcChat from "./components/ArcChat";
import { createClient, type RpcClient } from "./rpc";
export default function App({ mode, monoLogo, prideLogo, prideActive }: { mode: "sidebar" | "fullscreen"; monoLogo: string; prideLogo: string; prideActive: boolean }) {
  const [client, setClient] = useState<RpcClient | null>(null);
  useEffect(() => {
    const c = createClient();
    setClient(c);
  }, []);
  if (!client) return null;
  return <ArcChat client={client} monoLogo={monoLogo} prideLogo={prideLogo} prideActive={prideActive} variant={mode} />;
}