# 🎥 Fornight Vision

Aplicativo (Activity) para o Discord que permite **transmitir a tela ou a câmera** dentro de uma call — estilo **GoLive**. A interface roda **diretamente dentro do app do Discord**, como os jogos e outras atividades.

- 🖥️ Transmita a **tela** ou 📷 a **câmera**
- ⚙️ Escolha **FPS** (15/30/60) e **qualidade** (1 a 8 Mbps)
- 🔗 Envie um **link** para as pessoas assistirem, ou convide pela call
- 🏠 Funciona em **servidor** e em **DM** (chamadas privadas)

---

## 🧠 Como funciona

O app é uma **Discord Activity** (Embedded App SDK). Ele roda dentro de uma call do Discord e usa as APIs nativas do navegador (`getDisplayMedia`/`getUserMedia`) para capturar a tela/câmera. Como o Discord não retransmite o stream para os outros participantes, usamos um **servidor de mídia LiveKit** para fazer o relay:

```
[Transmissor] --captura tela/câmera--> [LiveKit] --> [Espectadores na call]
```

- **Transmissor**: captura a fonte, publica o vídeo na sala do LiveKit (com FPS/bitrate escolhidos) e gera o link.
- **Espectador**: entra pelo link, conecta na mesma sala do LiveKit e assiste.

### Seleção de tela e câmera

- **Tela**: o botão chama `getDisplayMedia()`. O navegador/Discord abre o seletor nativo com as telas inteiras e janelas disponíveis, incluindo as previews fornecidas pelo sistema.
- **Câmera**: o app lista as webcams autorizadas, mostra um preview e permite escolher o dispositivo antes de iniciar.
- **Tela + câmera**: ambas são publicadas no LiveKit; a câmera aparece como miniatura arrastável sobre o preview local.

Por segurança, uma página web não pode enumerar ou capturar todas as janelas do Windows por conta própria. Além disso, o Discord aplica uma Permissions Policy que bloqueia `display-capture` dentro do iframe da Activity. Portanto, a Activity web não consegue fazer captura própria de tela no Discord, mesmo com HTTPS e Vercel.

Para cumprir a proposta de não usar o Go Live do Discord, a arquitetura correta é um app desktop auxiliar em Electron ou Tauri. Esse app captura monitores/janelas usando a API do sistema, envia as faixas de vídeo (e, opcionalmente, áudio) ao LiveKit e a Activity mostra o estado, a sala e os controles. A câmera pode continuar sendo capturada na Activity quando o Discord permitir `camera`; a captura de tela, porém, precisa do auxiliar desktop.

---

## 📁 Estrutura

```
Fornight_Vision/
├── index.html          # Interface da Activity
├── src/
│   ├── main.ts         # Lógica (captura, LiveKit, espectador)
│   └── style.css       # Estilo (tema Discord)
├── server/
│   ├── app.js          # App Express (rotas da API)
│   └── index.js        # Servidor local (dev/produção)
├── api/
│   └── index.js        # Função serverless do Vercel
├── vercel.json         # Config de deploy no Vercel
├── vite.config.ts
├── .env.example        # Modelo de variáveis de ambiente
└── package.json
```

---

## 🚀 Como rodar

### 1. Pré-requisitos
- [Node.js](https://nodejs.org) 18+
- Uma conta no [LiveKit Cloud](https://cloud.livekit.io) (tem plano gratuito) — ou um servidor LiveKit próprio

### 2. Instalar dependências
```bash
npm install
```

### 3. Configurar o `.env`
Copie o `.env.example` para `.env` e preencha:

```env
# Discord
DISCORD_CLIENT_ID=SEU_CLIENT_ID_AQUI
DISCORD_CLIENT_SECRET=SEU_CLIENT_SECRET_AQUI

# LiveKit
LIVEKIT_URL=wss://SEU_PROJETO.livekit.cloud
LIVEKIT_API_KEY=SUA_API_KEY
LIVEKIT_API_SECRET=SUA_API_SECRET

PORT=3000
```

Crie também um arquivo `.env.local` (ou use o mesmo `.env`) com as variáveis do frontend:

```env
VITE_DISCORD_CLIENT_ID=SEU_CLIENT_ID_AQUI
VITE_LIVEKIT_URL=wss://SEU_PROJETO.livekit.cloud
```

> ⚠️ O Vite só expõe variáveis com prefixo `VITE_` para o frontend.
>
> ⚠️ O **LiveKit API Secret** é obrigatório (aba **Keys** no LiveKit Cloud). Sem ele, o servidor não consegue gerar os tokens de transmissão.

> ⚠️ No Vercel, `VITE_DISCORD_CLIENT_ID` e `VITE_LIVEKIT_URL` precisam estar cadastradas antes do build. Marque **Production**, **Preview** e **Development** e faça um novo **Redeploy** depois de salvar. O arquivo `.env` local não é enviado automaticamente ao Vercel.

### 4. Rodar em desenvolvimento
```bash
npm run dev:all
```
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`

### 5. Build de produção
```bash
npm run build
npm run server
```
O servidor Express serve o frontend buildado e a API na mesma porta.

---

## 🛠️ Criando o app no Discord (token)

1. Acesse o **[Discord Developer Portal](https://discord.com/developers/applications)** e clique em **New Application**.
2. Dê o nome **Fornight Vision** e crie.
3. Copie o **Application ID** → é o `DISCORD_CLIENT_ID`.
4. Vá em **OAuth2 → General** e copie o **Client Secret** → é o `DISCORD_CLIENT_SECRET`.
5. Em **OAuth2 → General**, adicione o redirect URI:
   - `http://localhost:3000` (desenvolvimento)
   - `https://SEU-DOMINIO.com` (produção)
6. Em **General → URL Mappings → Mapeamento de raízes**, use prefixo `/` e, no alvo, apenas o hostname de produção, sem `https://` (ex.: `fornight-vision-pe1mrrn8b-radioativo.vercel.app`). Não use `localhost:3000` em produção.
7. Em **Rich Presence → Rich Presence Assets**, adicione um ícone (opcional, para a imagem da atividade).
8. Em **General**, marque a opção **"Activity"** / habilite o **Embedded App SDK** se solicitado.

> 💡 Para testar localmente, o Discord exige HTTPS. Use um túnel como [ngrok](https://ngrok.com) ou [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):
> ```bash
> ngrok http 3000
> ```
> E use a URL `https://...ngrok.io` no URL Mapping e no redirect URI.

---

## ☁️ Deploy no Vercel (gratuito)

O projeto já está configurado para o Vercel (arquivo `vercel.json` + pasta `api/`).

### 1. Suba o código para o GitHub
```bash
git add .
git commit -m "Deploy Fornight Vision"
git push origin main
```

### 2. Importe no Vercel
1. Acesse [vercel.com](https://vercel.com) e clique em **Add New → Project**.
2. Importe o repositório **Fornight_Vision**.
3. O Vercel detecta o Vite automaticamente:
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Em **Environment Variables**, adicione **todas** as variáveis do `.env`:
   - `DISCORD_CLIENT_ID`
   - `DISCORD_CLIENT_SECRET`
   - `LIVEKIT_URL`
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`
   - `VITE_DISCORD_CLIENT_ID`
   - `VITE_LIVEKIT_URL`
5. Clique em **Deploy**.

> ⚠️ As variáveis `VITE_*` são usadas no build do frontend. Se você mudá-las, precisa fazer um novo deploy (o Vercel re-builda).

### 3. Configure o Discord
1. No [Discord Developer Portal](https://discord.com/developers/applications), no seu app:
   - **OAuth2 → General**: adicione o redirect URI `https://SEU-PROJETO.vercel.app`
   - **General → URL Mappings → Mapeamento de raízes**: prefixo `/`, alvo `SEU-PROJETO.vercel.app` (sem `https://`)
2. Em **General → Terms of Service / Privacy Policy**, adicione as URLs:
   - **Terms of Service URL**: `https://SEU-PROJETO.vercel.app/terms`
   - **Privacy Policy URL**: `https://SEU-PROJETO.vercel.app/privacy`
3. Pronto! Entre numa call → Atividades 🚀 → **Fornight Vision**.

### Importante: Deployment Protection

O domínio usado pelo Discord precisa responder diretamente com o HTML da Activity. No Vercel, abra **Settings → Deployment Protection** e desative a proteção por senha/login para **Production**. Caso contrário, o Vercel responde com `X-Frame-Options: DENY` e o Discord mostra `ERR_BLOCKED_BY_RESPONSE` ao tentar abrir o app dentro do iframe.

Teste a URL em uma janela anônima. Ela deve mostrar a interface do Fornight Vision, sem pedir login do Vercel. Também confirme que o **URL Mapping** do Discord aponta exatamente para esse mesmo domínio.

### Verificação antes de testar no Discord

- Abra a URL de produção em uma janela anônima. Ela deve mostrar o Fornight Vision, e não **Login – Vercel**. Se aparecer login, vá em **Vercel → Settings → Deployment Protection** e desative a proteção para o deployment de produção, ou use um domínio público sem autenticação.
- Em **Vercel → Deployments**, confira se o deployment mais recente foi criado depois de adicionar as variáveis `VITE_*`. Essas variáveis entram no bundle durante o build; apenas cadastrá-las não altera um deployment antigo.
- Abra o arquivo JavaScript carregado pela página e confirme que o deployment é o deste repositório. Se aparecer `/_next/static/...`, o domínio está apontando para outro projeto Next.js; o build deste projeto deve carregar `/_assets/...` ou `/assets/...` e exibir o Fornight Vision.
- No Discord, o **Mapeamento de raízes** deve apontar exatamente para o hostname público (sem `https://`). A Activity deve ser aberta pelo botão **Atividades** dentro da call; abrir a URL em uma aba comum não fornece `frame_id` nem `channelId`.

### Link avulso

Um link como `https://SEU-PROJETO.vercel.app/?room=...` não consegue descobrir ou entrar na sua call do Discord. Ele funciona como página de espectador e entra diretamente na sala LiveKit. Para transmitir dentro de um servidor ou DM, abra a atividade pelo botão **Atividades** dentro da call; o Discord fornecerá o `frame_id` e o `channelId` necessários.

### Captura híbrida

Quando o usuário escolhe **Tela** ou **Tela + câmera** dentro da Activity, o botão abre `/capture` em uma aba externa. Essa página é necessária porque somente o navegador em primeiro plano pode solicitar `getDisplayMedia()` e mostrar o seletor nativo de monitores e janelas. A aba precisa permanecer aberta enquanto a transmissão estiver ativa.

---

## 🎮 Usando a Activity

1. Entre em uma **call** (servidor ou DM).
2. Clique no botão de **Atividades** (ícone de foguete 🚀) na barra inferior.
3. Selecione **Fornight Vision** e inicie.
4. Escolha a **fonte** (tela/câmera), **FPS** e **qualidade**.
5. Clique em **▶ Iniciar Transmissão**.
6. Copie o **link** gerado e envie para quem quiser assistir, ou use o botão nativo **"Convidar para a Atividade"** do Discord.

---

## 🔒 Notas de segurança
- O `DISCORD_CLIENT_SECRET` e as chaves do LiveKit **nunca** devem ir para o frontend — ficam apenas no servidor.
- Em produção, use HTTPS obrigatoriamente (o Discord exige).
- O token do LiveKit é gerado no servidor e tem validade curta.

---

## 📄 Licença
Veja o arquivo [LICENSE](LICENSE).