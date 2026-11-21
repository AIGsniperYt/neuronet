export function rectsIntersect(a, b) {
  return a.left < b.left + b.width && a.left + a.width > b.left
    && a.top < b.top + b.height && a.top + a.height > b.top;
}

export function textItemsInRegion(items, viewport, region) {
  const selected = [];
  for (const item of items || []) {
    if (!item.str?.trim()) continue;
    const p1 = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    const p2 = viewport.convertToViewportPoint(item.transform[4] + item.width, item.transform[5] + item.height);
    const box = { left: Math.min(p1[0], p2[0]), top: Math.min(p1[1], p2[1]), width: Math.abs(p2[0] - p1[0]), height: Math.abs(p2[1] - p1[1]) };
    if (rectsIntersect(box, region)) selected.push({ item, box });
  }
  selected.sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
  return selected.map(({ item }) => item.str.trim()).filter(Boolean).join(" ");
}

export async function createPdfRegionWorkbench({ input, canvas, frame, pageLabel, previous, next, addRegion, cropToggle, onRegion, onFile = () => {} }) {
  const pdfjs = await import("../vendor/pdfjs/index.js");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.legacy.worker.min.mjs", import.meta.url).href;
  let documentRef = null;
  let pageNumber = 1;
  let pageRef = null;
  let viewport = null;
  let selection = null;
  let dragStart = null;
  let overlay = null;

  function paintSelection() {
    if (!overlay) return;
    overlay.hidden = !selection;
    if (selection) {
      overlay.style.left = `${selection.left}px`;
      overlay.style.top = `${selection.top}px`;
      overlay.style.width = `${selection.width}px`;
      overlay.style.height = `${selection.height}px`;
    }
  }

  async function render() {
    if (!documentRef) return;
    pageRef = await documentRef.getPage(pageNumber);
    const base = pageRef.getViewport({ scale: 1 });
    const available = Math.max(320, frame.clientWidth || 720);
    const scale = Math.min(1.6, available / base.width);
    viewport = pageRef.getViewport({ scale });
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    frame.style.width = `${viewport.width}px`;
    frame.style.height = `${viewport.height}px`;
    await pageRef.render({ canvasContext: canvas.getContext("2d"), viewport, transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0] }).promise;
    pageLabel.textContent = `Page ${pageNumber} of ${documentRef.numPages}`;
    previous.disabled = pageNumber <= 1;
    next.disabled = pageNumber >= documentRef.numPages;
    selection = null; paintSelection();
  }

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    documentRef = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    pageNumber = 1;
    onFile(file);
    await render();
  });
  previous.addEventListener("click", async () => { if (pageNumber > 1) { pageNumber--; await render(); } });
  next.addEventListener("click", async () => { if (documentRef && pageNumber < documentRef.numPages) { pageNumber++; await render(); } });

  overlay = document.createElement("div");
  overlay.className = "pdf-selection";
  overlay.hidden = true;
  frame.append(overlay);
  canvas.addEventListener("pointerdown", (event) => {
    if (!viewport) return;
    canvas.setPointerCapture(event.pointerId);
    const bounds = canvas.getBoundingClientRect();
    dragStart = { x: (event.clientX - bounds.left) * (viewport.width / bounds.width), y: (event.clientY - bounds.top) * (viewport.height / bounds.height) };
    selection = { left: dragStart.x, top: dragStart.y, width: 0, height: 0 };
    paintSelection();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragStart || !viewport) return;
    const bounds = canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * (viewport.width / bounds.width);
    const y = (event.clientY - bounds.top) * (viewport.height / bounds.height);
    selection = { left: Math.min(x, dragStart.x), top: Math.min(y, dragStart.y), width: Math.abs(x - dragStart.x), height: Math.abs(y - dragStart.y) };
    paintSelection();
  });
  const stopDrag = () => { dragStart = null; };
  canvas.addEventListener("pointerup", stopDrag);
  canvas.addEventListener("pointercancel", stopDrag);
  addRegion.addEventListener("click", async () => {
    if (!selection || selection.width < 2 || selection.height < 2 || !pageRef) return;
    const region = { ...selection };
    const textContent = await pageRef.getTextContent();
    const text = textItemsInRegion(textContent.items, viewport, region);
    let crop = null;
    if (cropToggle.checked) {
      const factor = canvas.width / viewport.width;
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = Math.max(1, Math.round(region.width * factor));
      cropCanvas.height = Math.max(1, Math.round(region.height * factor));
      cropCanvas.getContext("2d").drawImage(canvas, region.left * factor, region.top * factor, region.width * factor, region.height * factor, 0, 0, cropCanvas.width, cropCanvas.height);
      crop = await new Promise((resolve) => cropCanvas.toBlob(resolve, "image/png"));
    }
    await onRegion({ page: pageNumber, rect: region, text, crop, fileName: input.files?.[0]?.name || "" });
    selection = null; paintSelection();
  });

  return { render, get pageCount() { return documentRef?.numPages || 0; } };
}
