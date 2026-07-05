import { useState } from "react";
import ArcChat from "./components/ArcChat";
import { createClient, type RpcClient } from "./rpc";
export default function App({ mode, monoLogo, prideLogo, monoLogoText, prideActive, toolTreeMode, version }: { mode: "sidebar" | "fullscreen"; monoLogo: string; prideLogo: string; monoLogoText: string; prideActive: boolean; toolTreeMode: "auto" | "collapsed"; version: string }) {
<<<<<<< HEAD
  const [client, setClient] = useState<RpcClient | null>(null);
  useEffect(() => {
    const c = createClient();
    setClient(c);
  }, []);
  if (!client) return null;
=======
  const [client] = useState<RpcClient>(() => createClient());
>>>>>>> dev
  return <ArcChat client={client} monoLogo={monoLogo} prideLogo={prideLogo} monoLogoText={monoLogoText} prideActive={prideActive} toolTreeMode={toolTreeMode} variant={mode} version={version} />;
}