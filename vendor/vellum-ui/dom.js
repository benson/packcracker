export function el(tag, options = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) {
    if (value == null || value === false) continue;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'htmlFor') node.htmlFor = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'onClick') node.addEventListener('click', value);
    else if (key.startsWith('aria')) {
      // ariaSelected -> aria-selected (the leading capital after "aria"
      // supplies the hyphen; further capitals kebab as usual)
      const attr = key.replace(/[A-Z]/g, (char) => '-' + char.toLowerCase());
      node.setAttribute(attr, String(value));
    } else if (key in node) {
      node[key] = value;
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clearNode(node) {
  if (!node) return;
  while (node.firstChild) node.firstChild.remove();
}
