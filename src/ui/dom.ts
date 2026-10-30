/** Tiny DOM helper. It only ever sets text and attributes, never HTML, so data cannot become markup. */

type Child = Node | string | null | undefined | false | Child[];
type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2), value);
    } else if (key === "value" && "value" in el) {
      (el as unknown as HTMLInputElement).value = String(value);
    } else if (key === "checked" && "checked" in el) {
      (el as unknown as HTMLInputElement).checked = value === true;
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  const add = (child: Child): void => {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) child.forEach(add);
    else el.append(typeof child === "string" ? document.createTextNode(child) : child);
  };
  children.forEach(add);
  return el;
}

export function downloadText(filename: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
