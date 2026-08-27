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
const placeholderEl = document.getElementById('placeholder') as HTMLDivElement;
const startBtn = document.getElementById('start') as HTMLButtonElement;
const stopBtn = document.getElementById('stop') as HTMLButtonElement;
const sourceSelect = document.getElementById('source') as HTMLSelectElement;
const fpsSelect = document.getElementById('fps') as HTMLSelectElement;
const qualitySelect = document.getElementById('quality') as HTMLSelectElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const shareLinkEl = document.getElementById('share-link') as HTMLInputElement;
const copyBtn = document.getElementById('copy') as HTMLButtonElement;

// ---- Estado ----
let room: Room | null = null;
let localStream: MediaStream | null = null;
let identity = 'espectador';
let channelId = 'sala';

function setStatus(text: string, kind: 'ok' | 'err' | 'info' = 'info') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

function setBroadcasting(on: boolean) {
  startBtn.disabled = on;
  stopBtn.disabled = !on;
  sourceSelect.disabled = on;
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
  setStatus('Autorizando com o Discord...');

  const { code } = await discordSdk.commands.authorize({
    client_id: CLIENT_ID,
    response_type: 'code',
    state: '',
    prompt: 'none',
    // 'identify' funciona em servidores e DMs. 'guilds' pode falhar em chamadas privadas.
    scope: ['identify'],
  });

  const response = await fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const { access_token } = await response.json();
  if (!access_token) {
    throw new Error('Falha ao obter access_token do Discord');
  }

  const auth = await discordSdk.commands.authenticate({ access_token });
  identity = auth.user.username;

  // channelId/guildId vêm prontos no SDK
  channelId = discordSdk.channelId ?? 'sala';

  setStatus(`Conectado como ${identity}`, 'ok');
}

// ---- Captura da fonte (tela ou câmera) usando APIs nativas ----
async function captureStream(source: 'screen' | 'camera', fps: number): Promise<MediaStream> {
  if (source === 'screen') {
    return await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: fps } },
      audio: false,
    });
  }
  return await navigator.mediaDevices.getUserMedia({
    video: { frameRate: { ideal: fps } },
    audio: false,
  });
}

// ---- Transmissão ----
async function startBroadcast() {
  try {
    setStatus('Capturando fonte...');
    const source = sourceSelect.value as 'screen' | 'camera';
    const fps = Number(fpsSelect.value);
    const bitrate = Number(qualitySelect.value);

    localStream = await captureStream(source, fps);
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) {
      throw new Error('Nenhum track de vídeo capturado');
    }

    // Preview local
    videoEl.srcObject = localStream;
    placeholderEl.style.display = 'none';
    videoEl.style.display = 'block';

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
      `Transmitindo ${source === 'screen' ? 'tela' : 'câmera'} • ${fps} FPS • ${(bitrate / 1_000_000).toFixed(1)} Mbps`,
      'ok',
    );

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