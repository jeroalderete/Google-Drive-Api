import express from 'express';
import { google } from 'googleapis';
import fs from 'fs';
import multer from 'multer';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();
const app = express();
app.use(cors({
  origin: [
    'http://localhost:8080',
    'https://google-drive-api-production-2e3b.up.railway.app'
  ],
  credentials: true
}));
app.use(express.json());

// ========================================================== //

// =======================
// OAuth2 Client para Google Drive
// =======================
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

app.locals.oauthReady = false;

// ========================================================== //

// =======================
// Borrar archivo en Drive
// =======================
app.delete('/drive/delete/:id', requireGoogleAuth, async (req, res) => {
  try {
    const fileId = req.params.id;
    if (!fileId) return res.status(400).json({ error: 'No file ID provided' });

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    await drive.files.delete({ fileId });

    res.json({ success: true, message: 'File deleted successfully' });
  } catch (err) {
    console.error('Delete failed:', err);
    res.status(500).json({ error: 'Failed to delete file', details: err.message });
  }
});

// ========================================================== //

// Endpoint de streaming
app.get('/drive/stream/:id', requireGoogleAuth, async (req, res) => {
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const fileId = req.params.id;

    const file = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    // Optional: set proper headers
    res.setHeader('Content-Type', 'audio/mpeg'); // mp3
    file.data.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to stream file' });
  }
});

// ========================================================== //

// Middleware para verificar OAuth
function requireGoogleAuth(req, res, next) {
  if (!app.locals.oauthReady) {
    return res.status(401).json({ error: 'google_auth_required', authUrl: '/auth/google' });
  }
  next();
}

// ========================================================== //

// =======================
// Multer para uploads
// =======================
const upload = multer({ dest: 'uploads/' });

// =======================
// Login Google
// =======================
app.get('/auth/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive'],
    prompt: 'consent',
  });
  res.redirect(url);
});

// ========================================================== //

// =======================
// OAuth Callback
// =======================
app.get('/v1/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code provided');

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  app.locals.oauthReady = true;

  res.redirect(`${process.env.FRONTEND_URL}/maquetas`);
});

// ========================================================== //

// =======================
// Subir archivo a Drive
// =======================
async function uploadToDrive(filePath, fileName) {
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const file = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID]
    },
    media: { body: fs.createReadStream(filePath) },
  });

  // Dar permiso de lectura a todos (opcional)
  await drive.permissions.create({
    fileId: file.data.id,
    requestBody: {
      role: 'reader',
      type: 'anyone', // anyone with the link puede ver
    },
  });

  return file.data;
}

// ========================================================== //

// =======================
// Endpoint upload
// =======================
app.post('/upload', requireGoogleAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const result = await uploadToDrive(req.file.path, req.file.originalname);
    fs.unlinkSync(req.file.path);

    res.json({ success: true, fileId: result.id, name: result.name });
  } catch (err) {
    console.error('Upload failed:', err); // <-- log completo
    res.status(500).json({ error: 'Upload failed', details: err.message }); // <-- enviar detalles
  }
});

// ========================================================== //

// =======================
// Listar archivos en Drive
// =======================
app.get('/drive/files', requireGoogleAuth, async (req, res) => {
  try {
    const folderId = req.query.folderId;
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    // const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType)',
      orderBy: 'createdTime desc',
    });

    const files = response.data.files
      .filter(f => f.name.match(/\.(mp3|wav)$/i))
      .map(f => ({
        id: f.id,
        name: f.name,
        url: `https://drive.google.com/uc?export=download&id=${f.id}`, // link directo
      }));

    res.json(files);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch Drive files' });
  }
});

// ========================================================== // a

// =======================
// Server
// =======================
app.listen(3000, () => console.log('🚀 Server running on http://localhost:3000'));
