import { useState } from "react";
import ArcChat from "./components/ArcChat";
import { createClient, type RpcClient } from "./rpc";
export default function App({ mode, monoLogo, prideLogo, monoLogoText, prideActive, toolTreeMode, version, providerCatalog }: { mode: "sidebar" | "fullscreen"; monoLogo: string; prideLogo: string; monoLogoText: string; prideActive: boolean; toolTreeMode: "auto" | "collapsed"; version: string; providerCatalog: { kind: string; label: string; tags: string[]; defaultBaseUrl?: string }[] }) {
  const [client] = useState<RpcClient>(() => createClient());
  return <ArcChat client={client} monoLogo={monoLogo} prideLogo={prideLogo} monoLogoText={monoLogoText} prideActive={prideActive} toolTreeMode={toolTreeMode} variant={mode} version={version} providerCatalog={providerCatalog as any} />;
}