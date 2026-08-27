import express from 'express';
import cors from 'cors';
import { AccessToken } from 'livekit-server-sdk';

const app = express();
app.use(cors());
app.use(express.json());

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn('⚠️  DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET não configurados');
}
if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.warn('⚠️  LIVEKIT_API_KEY / LIVEKIT_API_SECRET não configurados');
}

// Troca o código OAuth2 do Discord por um access_token
app.post('/api/token', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Código ausente' });

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
  });

  try {
    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: params,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    res.json(data);
  } catch (err) {
    console.error('Erro ao trocar token:', err);
    res.status(500).json({ error: 'Falha ao trocar token' });
  }
});

// Gera um token de acesso ao LiveKit para entrar na sala
app.post('/api/livekit-token', async (req, res) => {
  const { identity, room } = req.body;
  if (!identity || !room) {
    return res.status(400).json({ error: 'identity e room são obrigatórios' });
  }

  try {
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
      name: identity,
    });
    at.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canSubscribe: true,
    });
    const token = await at.toJwt();
    res.json({ token });
  } catch (err) {
    console.error('Erro ao gerar token LiveKit:', err);
    res.status(500).json({ error: 'Falha ao gerar token LiveKit' });
  }
});

export default app;