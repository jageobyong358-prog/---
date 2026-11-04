// Battle video recorder.
//  - PC: captures this browser tab with getDisplayMedia (cropped to the arena) — exact pixels.
//  - Phones / browsers without screen capture: repaints the arena onto a canvas every
//    frame (js/canvasRecorder.js) and records that canvas — no permission prompt.
import { canvasRecordingSupported, startCanvasRecording } from './canvasRecorder.js';

let stream = null;
let rec = null;
let chunks = [];
let mime = '';
let stopResolve = null;
let canvasRec = null;
let onStateChange = () => {};

export function onRecorderChange(fn) { onStateChange = fn; }
export const isRecording = () => !!(rec && rec.state === 'recording');
const screenCaptureSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && window.MediaRecorder);
const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && matchMedia('(pointer: coarse)').matches);
/** 'screen' (tab capture) or 'canvas' (repaint), or null when neither works. */
export function recorderMode() {
  if (screenCaptureSupported() && !isMobile()) return 'screen';
  if (canvasRecordingSupported()) return 'canvas';
  return null;
}
export const recorderSupported = () => !!recorderMode();

function pickMime() {
  const cands = ['video/mp4;codecs=avc3', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return cands.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

/**
 * Start recording. Must be called from a user gesture (click).
 * cropEl: element to crop the capture to (Chrome Region Capture), optional.
 */
export async function startRecording(cropEl) {
  const mode = recorderMode();
  if (!mode) throw new Error('이 브라우저는 녹화를 지원하지 않습니다. 최신 Chrome / Safari / Edge 를 사용해 주세요.');
  if (isRecording()) return;
  if (mode === 'canvas') return startCanvasMode();
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
  startRecorder(stream);
}

function startRecorder(s) {
  mime = pickMime();
  chunks = [];
  rec = new MediaRecorder(s, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    if (canvasRec) { canvasRec.stop(); canvasRec = null; }
    if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
    const blob = chunks.length ? new Blob(chunks, { type: (rec.mimeType || mime || 'video/webm').split(';')[0] }) : null;
    chunks = [];
    onStateChange(false, blob);
    if (stopResolve) { stopResolve(blob); stopResolve = null; }
  };
  rec.start(1000);
  onStateChange(true, null);
}

function startCanvasMode() {
  canvasRec = startCanvasRecording(() => document.getElementById('arena'));
  startRecorder(canvasRec.stream);
}

/** Stop and resolve with the recorded Blob (or null). */
export function stopRecording() {
  if (!isRecording()) return Promise.resolve(null);
  return new Promise((res) => { stopResolve = res; rec.stop(); });
}

export async function downloadVideo(blob, name = 'battle') {
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const filename = `${name}-${stamp}.${ext}`;
  // Phones: the share sheet lets the user save the video to the gallery / send it.
  if (isMobile() && navigator.canShare) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: '전투 영상' }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
