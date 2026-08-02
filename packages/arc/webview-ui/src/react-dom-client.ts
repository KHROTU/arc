import { render } from "preact/compat";
type Root = { render: (vnode: unknown) => void };
export function createRoot(container: Element | DocumentFragment): Root {
  return {
    render: (vnode: unknown) => render(vnode as never, container as HTMLElement),
  };
}
export const hydrateRoot = createRoot;