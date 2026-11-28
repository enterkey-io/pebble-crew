/** Saves media the way the platform expects. On iPhone and iPad the share sheet
 *  offers "Save Image"/"Save Video", which adds it to Photos; a download link
 *  would send it to Files (and inside the installed app opens a preview that
 *  can leave the app in a broken state). Everything else downloads normally. */
export async function saveMedia(blob: Blob, name: string): Promise<'shared' | 'downloaded'> {
  const media = /^(?:image|video)\//.test(blob.type);
  if (media && typeof navigator.share === 'function' && typeof File === 'function') {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return 'shared';
      } catch (cause) {
        // The owner closed the sheet; nothing else to do.
        if (cause instanceof DOMException && cause.name === 'AbortError') return 'shared';
        // A lost user activation or unsupported type falls back to a download.
      }
    }
  }
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
