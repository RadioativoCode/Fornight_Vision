import { Room } from 'livekit-client';
import './capture.css';

const params = new URLSearchParams(window.location.search);
const roomName = params.get('room') || 'sala-publica';
const identity = params.get('identity') || `capturador-${crypto.randomUUID().slice(0, 8)}`;
const livekitUrl = import.meta.env.VITE_LIVEKIT_URL as string | undefined;

const screenPreview = document.getElementById('screen-preview') as HTMLVideoElement;
const cameraOverlay = document.getElementById('camera-overlay') as HTMLVideoElement;
const emptyPreview = document.getElementById('empty-preview') as HTMLDivElement;
const audioCheck = document.getElementById('audio') as HTMLInputElement;
const startButton = document.getElementById('start') as HTMLButtonElement;
const stopButton = document.getElementById('stop') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLSpanElement;
const sourceSummary = document.getElementById('source-summary') as HTMLSpanElement;
const settingsSummary = document.getElementById('settings-summary') as HTMLSpanElement;

const mode = params.get('mode') === 'camera' || params.get('mode') === 'both' ? params.get('mode') : 'screen';
const fps = Number(params.get('fps')) || 30;
const bitrate = Number(params.get('quality')) || 2500000;
sourceSummary.textContent = mode === 'both' ? 'Tela + câmera' : mode === 'camera' ? 'Câmera' : 'Tela ou janela';
settingsSummary.textContent = `${fps} FPS · ${(bitrate / 1_000_000).toFixed(1)} Mbps`;

let room: Room | null = null;
let stream: MediaStream | null = null;
let cameraStream: MediaStream | null = null;

function setStatus(message: string, error = false) {
  status.textContent = message;
  status.className = `status${error ? ' error' : ''}`;
}

async function getToken() {
  const response = await fetch('/api/livekit-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, room: roomName, publish: true }),
  });
  if (!response.ok) throw new Error(`API LiveKit respondeu HTTP ${response.status}`);
  const data = await response.json() as { token?: string };
  if (!data.token) throw new Error('A API não retornou um token LiveKit');
  return data.token;
}

async function startCapture() {
  if (!livekitUrl) throw new Error('VITE_LIVEKIT_URL não foi incorporada neste deploy');
  setStatus('Escolha uma tela ou janela no seletor do navegador...');
  const screenStream = mode === 'camera' ? null : await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: fps } },
    audio: audioCheck.checked,
  });

  if (mode !== 'screen') {
    setStatus('Solicitando acesso à câmera...');
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { frameRate: { ideal: fps } }, audio: false });
  }

  stream = screenStream || cameraStream;
  if (!stream) throw new Error('Nenhuma fonte foi selecionada');
  screenPreview.srcObject = stream;
  screenPreview.style.display = 'block';
  emptyPreview.style.display = 'none';
  cameraOverlay.srcObject = cameraStream;
  cameraOverlay.hidden = mode !== 'both';

  setStatus('Conectando ao servidor de mídia...');
  room = new Room();
  await room.connect(livekitUrl, await getToken());
  const screenTrack = screenStream?.getVideoTracks()[0];
  const cameraTrack = cameraStream?.getVideoTracks()[0];
  if (screenTrack) await room.localParticipant.publishTrack(screenTrack, { videoEncoding: { maxBitrate: bitrate, maxFramerate: fps } });
  if (cameraTrack) await room.localParticipant.publishTrack(cameraTrack, { videoEncoding: { maxBitrate: Math.floor(bitrate / 2), maxFramerate: fps } });
  const audioTrack = screenStream?.getAudioTracks()[0];
  if (audioTrack) await room.localParticipant.publishTrack(audioTrack);

  startButton.disabled = true;
  stopButton.disabled = false;
  audioCheck.disabled = true;
  setStatus(`Transmitindo ${mode === 'both' ? 'tela + câmera' : mode}`);
  screenTrack?.addEventListener('ended', stopCapture);
}

function stopCapture() {
  room?.disconnect();
  room = null;
  stream?.getTracks().forEach((track) => track.stop());
  cameraStream?.getTracks().forEach((track) => track.stop());
  stream = null;
  cameraStream = null;
  screenPreview.srcObject = null;
  cameraOverlay.srcObject = null;
  cameraOverlay.hidden = true;
  screenPreview.style.display = 'none';
  emptyPreview.style.display = 'flex';
  startButton.disabled = false;
  stopButton.disabled = true;
  audioCheck.disabled = false;
  setStatus('Transmissão encerrada');
}

startButton.addEventListener('click', async () => {
  try { await startCapture(); } catch (error) { setStatus((error as Error).message, true); stopCapture(); }
});
stopButton.addEventListener('click', stopCapture);

let dragOffset = { x: 0, y: 0 };
let dragging = false;
cameraOverlay.addEventListener('pointerdown', (event) => {
  dragging = true;
  dragOffset = { x: event.clientX - cameraOverlay.offsetLeft, y: event.clientY - cameraOverlay.offsetTop };
  cameraOverlay.setPointerCapture(event.pointerId);
});
cameraOverlay.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  const bounds = cameraOverlay.parentElement?.getBoundingClientRect();
  if (!bounds) return;
  cameraOverlay.style.left = `${Math.max(8, Math.min(bounds.width - cameraOverlay.offsetWidth - 8, event.clientX - bounds.left - dragOffset.x))}px`;
  cameraOverlay.style.top = `${Math.max(8, Math.min(bounds.height - cameraOverlay.offsetHeight - 8, event.clientY - bounds.top - dragOffset.y))}px`;
});
cameraOverlay.addEventListener('pointerup', () => { dragging = false; });