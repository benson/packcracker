export function buildCardPreviewDataset(card = {}) {
  const image = card.image || card.imageUrl || card.frontImageUrl || card.normal || '';
  const backImage = card.backImage || card.backImageUrl || '';
  const title = card.title || card.name || '';
  return {
    cardImage: image,
    cardBackImage: backImage,
    cardTitle: title,
  };
}

export function applyCardPreviewDataset(targetEl, card = {}) {
  if (!targetEl) return targetEl;
  const dataset = buildCardPreviewDataset(card);
  for (const [key, value] of Object.entries(dataset)) {
    if (value) targetEl.dataset[key] = value;
    else delete targetEl.dataset[key];
  }
  return targetEl;
}

export function cardPreviewDatasetAttrs(card = {}, esc = (value) => String(value)) {
  const dataset = buildCardPreviewDataset(card);
  return Object.entries(dataset)
    .filter(([, value]) => value)
    .map(([key, value]) => {
      const attr = `data-${key.replace(/[A-Z]/g, (char) => '-' + char.toLowerCase())}`;
      return ` ${attr}="${esc(value)}"`;
    })
    .join('');
}
