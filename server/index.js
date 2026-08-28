import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import app from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Em produção local, serve o frontend buildado
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('/capture', (req, res) => {
  res.sendFile(path.join(distPath, 'capture.html'));
});
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Fornight Vision server rodando em http://localhost:${port}`);
});