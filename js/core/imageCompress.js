/**
 * Kompresja / downscale zdjęć przed uploadem do Storage (panel CMS).
 * Zachowuje rozsądną rozdzielczość (Retina), ucina megapiksele z telefonu.
 */
;(function () {
  const PRESETS = {
    logo: { maxEdge: 1024, quality: 0.88, mime: 'image/webp' },
    hero: { maxEdge: 1920, quality: 0.82, mime: 'image/webp' },
    gallery: { maxEdge: 1600, quality: 0.8, mime: 'image/webp' },
    og: { maxEdge: 1200, quality: 0.85, mime: 'image/jpeg' },
    default: { maxEdge: 1600, quality: 0.82, mime: 'image/webp' },
  };

  function presetFor(section, field) {
    const s = String(section || '');
    const f = String(field || '');
    if (s === 'nav' || f === 'logoImage') return PRESETS.logo;
    if (s === 'hero' && f === 'image') return PRESETS.hero;
    if (s === 'gallery' || f === 'images') return PRESETS.gallery;
    if (s === 'seo' || f === 'ogImage') return PRESETS.og;
    if (f === 'qrImage') return PRESETS.logo;
    return PRESETS.default;
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Nie udało się odczytać obrazu.'));
      };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob),
        mime,
        quality,
      );
    });
  }

  /**
   * @param {File} file
   * @param {string} [section]
   * @param {string} [field]
   * @returns {Promise<File>} skompresowany plik (lub oryginał gdy nie trzeba / błąd)
   */
  async function compressImageFile(file, section, field) {
    if (!file || !(file instanceof Blob)) return file;
    const mimeIn = String(file.type || '').toLowerCase();
    if (!/^image\/(jpeg|jpg|png|webp)$/.test(mimeIn)) return file;
    // Małe pliki (< 400 KB) — bez rekompresji, chyba że ogromne wymiary.
    const preset = presetFor(section, field);

    let img;
    try {
      img = await loadImageFromFile(file);
    } catch (_) {
      return file;
    }

    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    if (!w || !h) return file;

    const longest = Math.max(w, h);
    const needsResize = longest > preset.maxEdge;
    const needsReencode = file.size > 400 * 1024 || needsResize;
    if (!needsReencode) return file;

    const scale = needsResize ? preset.maxEdge / longest : 1;
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, tw, th);

    let outMime = preset.mime;
    let blob = await canvasToBlob(canvas, outMime, preset.quality);
    // Safari / starsze: brak WEBP → JPEG
    if (!blob || blob.size === 0) {
      outMime = 'image/jpeg';
      blob = await canvasToBlob(canvas, outMime, preset.quality);
    }
    if (!blob || blob.size === 0) return file;
    // Jeśli kompresja nic nie dała (rzadkie dla PNG→WebP przy małym pliku) — zostaw oryginał.
    if (blob.size >= file.size && !needsResize) return file;

    const ext = outMime === 'image/webp' ? 'webp' : outMime === 'image/png' ? 'png' : 'jpg';
    const base = String(file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
    return new File([blob], `${base}.${ext}`, { type: outMime, lastModified: Date.now() });
  }

  window.DFOPS_compressImageFile = compressImageFile;
  window.DFOPS_imageCompressPreset = presetFor;
})();
