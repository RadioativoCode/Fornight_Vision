import { DiscordSDK } from '@discord/embedded-app-sdk';
import { Room } from 'livekit-client';
import './style.css';

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;
const LIVEKIT_URL = (import.meta.env.VITE_LIVEKIT_URL as string | undefined) ?? '';
const isDiscordActivity = new URLSearchParams(window.location.search).has('frame_id');

// ---- Overlay de erro (evita tela branca) ----
const errorOverlay = document.getElementById('error-overlay') as HTMLDivElement;
const errorMessageEl = document.getElementById('error-message') as HTMLParagraphElement;
const errorReloadBtn = document.getElementById('error-reload') as HTMLButtonElement;

function showError(message: string) {
  console.error('[Fornight Vision]', message);
  setStatus(`Erro: ${message}`, 'err');
  errorMessageEl.textContent = message;
  errorOverlay.hidden = false;
}

errorReloadBtn.addEventListener('click', () => window.location.reload());

// Captura erros globais para nunca deixar tela branca
window.addEventListener('error', (e) => showError(e.message || 'Erro desconhecido'));
window.addEventListener('unhandledrejection', (e) => {
  showError((e.reason as Error)?.message || 'Erro desconhecido');
});

// O SDK exige frame_id e só deve ser criado dentro de uma Discord Activity.
const discordSdk = isDiscordActivity && CLIENT_ID ? new DiscordSDK(CLIENT_ID) : null;

// ---- Elementos da UI ----
const videoEl = document.getElementById('video') as HTMLVideoElement;
const cameraOverlayEl = document.getElementById('camera-overlay') as HTMLVideoElement;
const placeholderEl = document.getElementById('placeholder') as HTMLDivElement;
const startBtn = document.getElementById('start') as HTMLButtonElement;
const stopBtn = document.getElementById('stop') as HTMLButtonElement;
const sourceButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-source]'));
const fpsSelect = document.getElementById('fps') as HTMLSelectElement;
const qualitySelect = document.getElementById('quality') as HTMLSelectElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const shareLinkEl = document.getElementById('share-link') as HTMLInputElement;
const copyBtn = document.getElementById('copy') as HTMLButtonElement;
const cameraModal = document.getElementById('camera-modal') as HTMLDivElement;
const cameraList = document.getElementById('camera-list') as HTMLDivElement;
const cameraPreview = document.getElementById('camera-preview') as HTMLVideoElement;
const closeCameraBtn = document.getElementById('close-camera') as HTMLButtonElement;
const cancelCameraBtn = document.getElementById('cancel-camera') as HTMLButtonElement;
const confirmCameraBtn = document.getElementById('confirm-camera') as HTMLButtonElement;

// ---- Estado ----
let room: Room | null = null;
let localStream: MediaStream | null = null;
let identity = 'espectador';
let channelId = 'sala';
let selectedSource: 'screen' | 'camera' | 'both' = 'screen';
let selectedCameraId = '';
let cameraPreviewStream: MediaStream | null = null;
let cameraOverlayPosition = { x: 24, y: 24 };

function setStatus(text: string, kind: 'ok' | 'err' | 'info' = 'info') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

async function withTimeout<T>(operation: Promise<T>, label: string, timeoutMs = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} demorou mais de 15 segundos`)), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function setBroadcasting(on: boolean) {
  startBtn.disabled = on;
  stopBtn.disabled = !on;
  sourceButtons.forEach((button) => { button.disabled = on; });
  fpsSelect.disabled = on;
  qualitySelect.disabled = on;
}

// ---- Autenticação com o Discord ----
async function setupDiscord() {
  if (!LIVEKIT_URL) {
    throw new Error('VITE_LIVEKIT_URL não configurado no Vercel. Adicione a variável e faça um novo redeploy.');
  }

  // Links públicos não têm contexto de call; eles entram diretamente na sala LiveKit.
  if (!isDiscordActivity || !discordSdk || !CLIENT_ID) {
    identity = `visitante-${crypto.randomUUID().slice(0, 8)}`;
    channelId = new URLSearchParams(window.location.search).get('room') ?? 'sala-publica';
    setStatus('Modo espectador público', 'ok');
    return;
  }

  await discordSdk.ready();
  setStatus(`Activity detectada no canal ${discordSdk.channelId ?? 'atual'}...`);

  const { code } = await discordSdk.commands.authorize({
    client_id: CLIENT_ID,
    response_type: 'code',
    state: '',
    prompt: 'none',
    // Esses escopos são necessários para autenticar uma Discord Activity.
    scope: ['identify', 'applications.commands'],
  });

  setStatus('Validando sessão...');
  const response = await withTimeout(fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  }), 'A API de autenticação');
  if (!response.ok) {
    throw new Error(`A API de autenticação respondeu HTTP ${response.status}`);
  }
  const { access_token } = await response.json() as { access_token?: string };
  if (!access_token) {
    throw new Error('Falha ao obter access_token do Discord');
  }

  setStatus('Finalizando conexão com o Discord...');
  const auth = await withTimeout(
    discordSdk.commands.authenticate({ access_token }),
    'A autenticação do Discord',
  );
  identity = auth.user.username;

  // channelId/guildId vêm prontos no SDK
  channelId = discordSdk.channelId ?? 'sala';

  setStatus(`Conectado como ${identity}`, 'ok');
}

// ---- Captura da fonte (tela ou câmera) usando APIs nativas ----
async function captureScreen(fps: number): Promise<MediaStream> {
  // A lista de monitores e janelas é fornecida pelo seletor nativo do navegador/Discord.
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: fps } },
      audio: false,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new Error('O Discord bloqueia captura de tela dentro da Activity. Para transmitir sua tela, use o app desktop auxiliar do Fornight Vision.');
    }
    throw error;
  }
}

async function captureCamera(fps: number): Promise<MediaStream> {
  return await navigator.mediaDevices.getUserMedia({
    video: {
      ...(selectedCameraId ? { deviceId: { exact: selectedCameraId } } : {}),
      frameRate: { ideal: fps },
    },
    audio: false,
  });
}

async function openCameraModal(fps: number): Promise<boolean> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    throw new Error('Este ambiente não permite listar câmeras.');
  }

  let devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
  if (!devices.length || devices.every((device) => !device.label)) {
    const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    permissionStream.getTracks().forEach((track) => track.stop());
    devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
  }

  cameraList.replaceChildren();
  devices.forEach((device, index) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'camera-option';
    option.dataset.deviceId = device.deviceId;
    option.innerHTML = `<span class="camera-icon">📷</span><span>${device.label || `Câmera ${index + 1}`}</span>`;
    option.addEventListener('click', async () => {
      selectedCameraId = device.deviceId;
      cameraList.querySelectorAll('.camera-option').forEach((item) => item.classList.remove('selected'));
      option.classList.add('selected');
      cameraPreviewStream?.getTracks().forEach((track) => track.stop());
      cameraPreviewStream = await captureCamera(fps);
      cameraPreview.srcObject = cameraPreviewStream;
      confirmCameraBtn.disabled = false;
    });
    cameraList.append(option);
  });

  if (!devices.length) {
    throw new Error('Nenhuma câmera foi encontrada neste dispositivo.');
  }

  cameraModal.hidden = false;
  return await new Promise<boolean>((resolve) => {
    const finish = (confirmed: boolean) => {
      cameraModal.hidden = true;
      cameraPreviewStream?.getTracks().forEach((track) => track.stop());
      cameraPreviewStream = null;
      confirmCameraBtn.disabled = true;
      resolve(confirmed);
    };
    const confirm = () => finish(true);
    const cancel = () => finish(false);
    confirmCameraBtn.onclick = confirm;
    closeCameraBtn.onclick = cancel;
    cancelCameraBtn.onclick = cancel;
  });
}

// ---- Transmissão ----
async function startBroadcast() {
  try {
    setStatus('Capturando fonte...');
    const fps = Number(fpsSelect.value);
    const bitrate = Number(qualitySelect.value);

    if (selectedSource !== 'camera' && discordSdk) {
      const captureUrl = `${window.location.origin}/capture?room=${encodeURIComponent(channelId)}&identity=${encodeURIComponent(identity)}&mode=${selectedSource}`;
      await discordSdk.commands.openExternalLink({ url: captureUrl });
      setStatus('Capturador aberto em uma aba externa. Mantenha-o aberto durante a transmissão.', 'ok');
      shareLinkEl.value = `${window.location.origin}?room=${encodeURIComponent(channelId)}`;
      return;
    }

    if (selectedSource !== 'screen') {
      const confirmed = await openCameraModal(fps);
      if (!confirmed) {
        setStatus('Seleção cancelada', 'info');
        return;
      }
    }

    const screenStream = selectedSource === 'camera' ? null : await captureScreen(fps);
    const cameraStream = selectedSource === 'screen' ? null : await captureCamera(fps);
    localStream = new MediaStream([
      ...(screenStream?.getVideoTracks() ?? []),
      ...(cameraStream?.getVideoTracks() ?? []),
    ]);
    const videoTrack = screenStream?.getVideoTracks()[0] ?? cameraStream?.getVideoTracks()[0];
    if (!videoTrack) throw new Error('Nenhum vídeo foi capturado');
    const cameraTrack = cameraStream?.getVideoTracks()[0];

    // Preview local
    videoEl.srcObject = localStream;
    placeholderEl.style.display = 'none';
    videoEl.style.display = 'block';
    cameraOverlayEl.srcObject = cameraStream;
    cameraOverlayEl.hidden = selectedSource !== 'both';
    cameraOverlayPosition = { x: 24, y: 24 };
    cameraOverlayEl.style.left = `${cameraOverlayPosition.x}px`;
    cameraOverlayEl.style.top = `${cameraOverlayPosition.y}px`;

    setStatus('Conectando à sala de transmissão...');

    // Conecta ao LiveKit
    const tokenRes = await fetch('/api/livekit-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity, room: channelId }),
    });
    const { token } = await tokenRes.json();
    if (!token) {
      throw new Error('Falha ao obter token do LiveKit');
    }

    room = new Room();
    await room.connect(LIVEKIT_URL, token);

    // Publica o vídeo com FPS e bitrate escolhidos
    await room.localParticipant.publishTrack(videoTrack, {
      videoEncoding: {
        maxBitrate: bitrate,
        maxFramerate: fps,
      },
    });

    setBroadcasting(true);
    setStatus(
      `Transmitindo ${selectedSource === 'both' ? 'tela + câmera' : selectedSource} • ${fps} FPS • ${(bitrate / 1_000_000).toFixed(1)} Mbps`,
      'ok',
    );
    if (cameraTrack && cameraTrack !== videoTrack) {
      await room.localParticipant.publishTrack(cameraTrack, {
        videoEncoding: {
          maxBitrate: Math.floor(bitrate / 2),
          maxFramerate: fps,
        },
      });
    }

    // Gera o link de compartilhamento
    const shareUrl = `${window.location.origin}?room=${encodeURIComponent(channelId)}`;
    shareLinkEl.value = shareUrl;
  } catch (err) {
    console.error(err);
    setStatus(`Erro: ${(err as Error).message}`, 'err');
    stopBroadcast();
  }
}

async function stopBroadcast() {
  if (room) {
    room.disconnect();
    room = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  videoEl.srcObject = null;
  cameraOverlayEl.srcObject = null;
  cameraOverlayEl.hidden = true;
  videoEl.style.display = 'none';
  placeholderEl.style.display = 'flex';
  shareLinkEl.value = '';
  setBroadcasting(false);
  setStatus('Transmissão encerrada', 'info');
}

// ---- Modo espectador (quem entra pelo link) ----
async function watchStream() {
  const params = new URLSearchParams(window.location.search);
  const roomName = params.get('room') || channelId;

  setStatus('Entrando como espectador...');
  const tokenRes = await fetch('/api/livekit-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, room: roomName }),
  });
  const { token } = await tokenRes.json();
  if (!token) {
    throw new Error('Falha ao obter token do LiveKit');
  }

  room = new Room();
  room.on('trackSubscribed', (track) => {
    if (track.kind === 'video') {
      const el = track.attach();
      el.style.width = '100%';
      el.style.height = '100%';
      videoEl.replaceWith(el);
      placeholderEl.style.display = 'none';
    }
  });

  await room.connect(LIVEKIT_URL, token);
  setStatus('Assistindo transmissão', 'ok');
}

// ---- Eventos ----
startBtn.addEventListener('click', startBroadcast);
stopBtn.addEventListener('click', stopBroadcast);

sourceButtons.forEach((button) => {
  button.addEventListener('click', () => {
    selectedSource = button.dataset.source as 'screen' | 'camera' | 'both';
    sourceButtons.forEach((item) => item.classList.toggle('active', item === button));
  });
});

let draggingCamera = false;
let dragOffset = { x: 0, y: 0 };

cameraOverlayEl.addEventListener('pointerdown', (event) => {
  if (cameraOverlayEl.hidden) return;
  draggingCamera = true;
  dragOffset = {
    x: event.clientX - cameraOverlayEl.offsetLeft,
    y: event.clientY - cameraOverlayEl.offsetTop,
  };
  cameraOverlayEl.setPointerCapture(event.pointerId);
  cameraOverlayEl.classList.add('dragging');
});

cameraOverlayEl.addEventListener('pointermove', (event) => {
  if (!draggingCamera) return;
  const bounds = cameraOverlayEl.parentElement?.getBoundingClientRect();
  if (!bounds) return;
  const nextX = Math.max(8, Math.min(bounds.width - cameraOverlayEl.offsetWidth - 8, event.clientX - bounds.left - dragOffset.x));
  const nextY = Math.max(8, Math.min(bounds.height - cameraOverlayEl.offsetHeight - 8, event.clientY - bounds.top - dragOffset.y));
  cameraOverlayEl.style.left = `${nextX}px`;
  cameraOverlayEl.style.top = `${nextY}px`;
});

cameraOverlayEl.addEventListener('pointerup', () => {
  draggingCamera = false;
  cameraOverlayEl.classList.remove('dragging');
});

copyBtn.addEventListener('click', async () => {
  if (!shareLinkEl.value) return;
  await navigator.clipboard.writeText(shareLinkEl.value);
  copyBtn.textContent = '✓ Copiado';
  setTimeout(() => (copyBtn.textContent = 'Copiar'), 1500);
});

// ---- Inicialização ----
(async () => {
  try {
    await setupDiscord();
    // Se veio com ?room=, entra como espectador
    if (new URLSearchParams(window.location.search).has('room')) {
      await watchStream();
    }
  } catch (err) {
    console.error(err);
    const msg = (err as Error)?.message || 'Erro desconhecido';
    setStatus(`Falha na inicialização: ${msg}`, 'err');
    showError(msg);
  }
})();