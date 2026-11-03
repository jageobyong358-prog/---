// Battle video recorder: captures this browser tab (DOM + canvas VFX + shake text)
// with getDisplayMedia, optionally cropped to the arena, and encodes with MediaRecorder.

let stream = null;
let rec = null;
let chunks = [];
let mime = '';
let stopResolve = null;
let onStateChange = () => {};

export function onRecorderChange(fn) { onStateChange = fn; }
export const isRecording = () => !!(rec && rec.state === 'recording');
export const recorderSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && window.MediaRecorder);

function pickMime() {
  const cands = ['video/mp4;codecs=avc3', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return cands.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

/**
 * Start recording. Must be called from a user gesture (click).
 * cropEl: element to crop the capture to (Chrome Region Capture), optional.
 */
export async function startRecording(cropEl) {
  if (!recorderSupported()) throw new Error('이 브라우저는 화면 녹화를 지원하지 않습니다. (PC용 Chrome / Edge 권장)');
  if (isRecording()) return;
  stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'browser', frameRate: 60 },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
  });
  const track = stream.getVideoTracks()[0];
  // Region capture: crop to the arena when supported and we are capturing this tab.
  if (cropEl && window.CropTarget && track.cropTo) {
    try { await track.cropTo(await CropTarget.fromElement(cropEl)); } catch { /* full tab */ }
  }
  track.addEventListener('ended', () => { if (isRecording()) rec.stop(); });
  mime = pickMime();
  chunks = [];
  rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    for (const t of stream.getTracks()) t.stop();
    stream = null;
    const blob = chunks.length ? new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] }) : null;
    chunks = [];
    onStateChange(false, blob);
    if (stopResolve) { stopResolve(blob); stopResolve = null; }
  };
  rec.start(1000);
  onStateChange(true, null);
}

/** Stop and resolve with the recorded Blob (or null). */
export function stopRecording() {
  if (!isRecording()) return Promise.resolve(null);
  return new Promise((res) => { stopResolve = res; rec.stop(); });
}

export function downloadVideo(blob, name = 'battle') {
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${stamp}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
