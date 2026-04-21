import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import * as cheerio from 'cheerio';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Log file for debugging
const LOG_FILE = path.join(process.cwd(), 'firebase_debug.log');
const log = (msg: string) => {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(msg);
};

// Initialize Firebase Admin
let db: any = null;
try {
  log('Checking for Firebase config...');
  const firebaseConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(firebaseConfigPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
    log(`Config found for project: ${firebaseConfig.projectId}`);
    
    // PROPERLY set projectId from config
    const app = initializeApp({
      projectId: firebaseConfig.projectId,
    });
    log(`Firebase app initialized for project: ${firebaseConfig.projectId}`);
    
    db = getFirestore(firebaseConfig.firestoreDatabaseId);
    log(`Firestore initialized with DB ID: ${firebaseConfig.firestoreDatabaseId}`);
    
    // Verify connection and migrate
    (async () => {
      try {
        log('Attempting to list collections to verify permissions...');
        const collections = await db.listCollections();
        log(`Successfully connected. Found ${collections.length} collections.`);
      } catch (e: any) {
        log(`Verification failed: ${e.message}`);
        if (e.message.includes('PERMISSION_DENIED')) {
          log('PERMISSION_DENIED suggests IAM issues with the named database. Trying default database as fallback...');
          try {
             const defaultDb = getFirestore();
             await defaultDb.listCollections();
             log('Default database is accessible! Switching to default database.');
             db = defaultDb;
          } catch (e2: any) {
             log(`Default database also inaccessible: ${e2.message}`);
          }
        }
      }

      // Run Migration on whatever database we ended up with
      if (db) {
        const LICENSES_FILE = path.join(process.cwd(), 'licenses.json');
        if (fs.existsSync(LICENSES_FILE)) {
          try {
            const localLicenses = JSON.parse(fs.readFileSync(LICENSES_FILE, 'utf8'));
            if (Array.isArray(localLicenses) && localLicenses.length > 0) {
              log(`Found ${localLicenses.length} local licenses to migrate...`);
              for (const lic of localLicenses) {
                const snapshot = await db.collection('licenses').where('code', '==', lic.code).get();
                if (snapshot.empty) {
                  const { id, ...licData } = lic;
                  await db.collection('licenses').add({ ...licData });
                  log(`Migrated license: ${lic.code} (${lic.clientName})`);
                } else {
                  log(`License ${lic.code} already in Firebase, skipping.`);
                }
              }
              fs.renameSync(LICENSES_FILE, LICENSES_FILE + '.backup');
              log('Migration completed successfully.');
            }
          } catch (e: any) {
            log(`Migration failed: ${e.message}`);
          }
        }
      }
    })();
  } else {
    log('firebase-applet-config.json not found.');
  }
} catch (err: any) {
  log(`Failed to initialize Firebase Admin: ${err.message}`);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;
  const CACHE_DIR = path.join(__dirname, 'cache');

  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn('Could not create cache directory, caching will be disabled:', err);
  }

  app.use(cors());
  app.use(express.json());

  const LICENSES_FILE = path.join(process.cwd(), 'licenses.json');
  
  const getLicensesLocal = () => {
    try {
      if (fs.existsSync(LICENSES_FILE)) {
        return JSON.parse(fs.readFileSync(LICENSES_FILE, 'utf8'));
      }
      const BACKUP = LICENSES_FILE + '.backup';
      if (fs.existsSync(BACKUP)) {
        return JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
      }
    } catch (e) {}
    return [];
  };

  const saveLicensesLocal = (licenses: any[]) => {
    try {
      fs.writeFileSync(LICENSES_FILE, JSON.stringify(licenses, null, 2));
    } catch (e) {
      log(`Failed to save local licenses: ${e}`);
    }
  };

  // API: Get all licenses
  app.get('/api/admin/licenses', async (req, res) => {
    try {
      if (db) {
        const snapshot = await db.collection('licenses').get();
        const licenses = snapshot.docs.map((doc: any) => {
          const data = doc.data();
          const isOnline = data.lastSeen ? (new Date().getTime() - new Date(data.lastSeen).getTime() < 30000) : false;
          return { id: doc.id, ...data, isOnline };
        });
        return res.json(licenses);
      }
    } catch (error: any) {
      log(`GET /api/admin/licenses failed: ${error.message}`);
    }
    const local = getLicensesLocal().map((l: any) => ({
      ...l,
      isOnline: l.lastSeen ? (new Date().getTime() - new Date(l.lastSeen).getTime() < 30000) : false
    }));
    res.json(local);
  });

  // API: Check license status (public)
  app.get('/api/status/:code', async (req, res) => {
    let { code } = req.params;
    if (!code) return res.status(400).json({ error: 'Code required' });
    code = code.trim().toUpperCase();

    try {
      if (db) {
        const snapshot = await db.collection('licenses').where('code', '==', code).limit(1).get();
        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          const data = doc.data();
          const isOnline = data.lastSeen ? (new Date().getTime() - new Date(data.lastSeen).getTime() < 30000) : false;
          return res.json({
            clientName: data.clientName,
            lastSeen: data.lastSeen,
            isPlaying: data.isPlaying,
            isOnline,
            isActivated: !!data.activatedAt
          });
        }
      }
    } catch (error: any) {
      log(`GET /api/status/${code} Firebase failure: ${error.message}`);
    }

    const licenses = getLicensesLocal();
    const found = licenses.find((l: any) => l.code && l.code.trim().toUpperCase() === code);
    if (found) {
      const isOnline = found.lastSeen ? (new Date().getTime() - new Date(found.lastSeen).getTime() < 30000) : false;
      return res.json({
        clientName: found.clientName,
        lastSeen: found.lastSeen,
        isPlaying: found.isPlaying,
        isOnline,
        isActivated: !!found.activatedAt
      });
    }
    res.status(404).json({ error: 'Código não encontrado' });
  });

  // API: Create new license
  app.post('/api/admin/licenses', async (req, res) => {
    const { code, clientName } = req.body;
    if (!code || !clientName) return res.status(400).json({ error: 'Missing data' });
    
    const newLic = {
      code,
      clientName,
      createdAt: new Date().toISOString(),
      isPlaying: false
    };

    try {
      if (db) {
        await db.collection('licenses').add(newLic);
        return res.json({ success: true });
      }
    } catch (error: any) {
      log(`POST /api/admin/licenses failed: ${error.message}`);
    }
    
    const licenses = getLicensesLocal();
    licenses.push({ id: Math.random().toString(36).substr(2, 9), ...newLic });
    saveLicensesLocal(licenses);
    res.json({ success: true });
  });

  // API: Update license (Edit)
  app.put('/api/admin/licenses/:id', async (req, res) => {
    const { id } = req.params;
    const { clientName, code, resetActivation } = req.body;
    
    try {
      if (db) {
        const updateData: any = {};
        if (clientName) updateData.clientName = clientName;
        if (code) updateData.code = code.trim().toUpperCase();
        if (resetActivation) {
          updateData.activatedAt = FieldValue.delete();
          updateData.deviceId = FieldValue.delete();
        }
        await db.collection('licenses').doc(id).update(updateData);
        log(`License updated in Firebase: ${id}`);
        return res.json({ success: true });
      }
    } catch (error: any) {
      log(`PUT /api/admin/licenses failed: ${error.message}`);
    }

    const licenses = getLicensesLocal();
    const index = licenses.findIndex((l: any) => l.id === id);
    if (index !== -1) {
      if (clientName) licenses[index].clientName = clientName;
      if (code) licenses[index].code = code.trim().toUpperCase();
      if (resetActivation) {
        delete licenses[index].activatedAt;
        delete licenses[index].deviceId;
      }
      saveLicensesLocal(licenses);
      log(`License updated locally: ${id}`);
      return res.json({ success: true });
    }
    res.status(404).json({ error: 'License not found locally' });
  });

  // API: Delete license
  app.delete('/api/admin/licenses/:id', async (req, res) => {
    const { id } = req.params;
    log(`Deletando licença: ${id}`);
    try {
      if (db) {
        await db.collection('licenses').doc(id).delete();
        log(`Licença deletada do Firebase: ${id}`);
        return res.json({ success: true });
      }
    } catch (error: any) {
      log(`DELETE /api/admin/licenses failed: ${error.message}`);
    }
    const licenses = getLicensesLocal();
    const filtered = licenses.filter((l: any) => l.id !== id);
    saveLicensesLocal(filtered);
    log(`Licença deletada localmente (ou não encontrada no Firebase): ${id}`);
    res.json({ success: true });
  });

  // API: Activate license
  app.post('/api/activate', async (req, res) => {
    let { code, deviceId, isPlaying } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'DeviceId required' });
    if (!code) return res.status(400).json({ error: 'Code required' });
    
    code = code.trim().toUpperCase();
    log(`Activation attempt - Code: ${code}, Device: ${deviceId}`);

    try {
      if (db) {
        const snapshot = await db.collection('licenses').where('code', '==', code).limit(1).get();
        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          const license = doc.data();
          if (license.deviceId && license.deviceId !== deviceId) {
            log(`Activation failed - Device mismatch for ${code}`);
            return res.status(403).json({ error: 'Este código já está em uso em outro dispositivo.' });
          }
          const updateData: any = { lastSeen: new Date().toISOString(), isPlaying: !!isPlaying };
          if (!license.activatedAt) {
            updateData.activatedAt = new Date().toISOString();
            updateData.deviceId = deviceId;
          }
          await doc.ref.update(updateData);
          log(`Activation success (Firebase) for ${code}`);
          return res.json({ 
            success: true, 
            clientName: license.clientName,
            settings: license.settings || null
          });
        }
      }
    } catch (error: any) {
      log(`POST /api/activate Firebase failure: ${error.message}`);
    }

    // Try Local
    const licenses = getLicensesLocal();
    log(`Searching in ${licenses.length} local licenses...`);
    const index = licenses.findIndex((l: any) => l.code && l.code.trim().toUpperCase() === code);
    
    if (index !== -1) {
      const license = licenses[index];
      if (license.deviceId && license.deviceId !== deviceId) {
        log(`Activation failed (Local) - Device mismatch for ${code}`);
        return res.status(403).json({ error: 'Este código já está em uso em outro dispositivo.' });
      }
      if (!license.activatedAt) {
        licenses[index].activatedAt = new Date().toISOString();
        licenses[index].deviceId = deviceId;
      }
      licenses[index].lastSeen = new Date().toISOString();
      licenses[index].isPlaying = !!isPlaying;
      saveLicensesLocal(licenses);
      log(`Activation success (Local) for ${code}`);
      return res.json({ 
        success: true, 
        clientName: licenses[index].clientName,
        settings: licenses[index].settings || null
      });
    }
    
    log(`Activation failed - Code ${code} not found anywhere`);
    res.status(404).json({ error: 'Código não encontrado' });
  });

  // API: Heartbeat
  app.post('/api/heartbeat', async (req, res) => {
    let { code, deviceId, isPlaying } = req.body;
    if (!code) return res.status(400).json({ error: 'Code required' });
    code = code.trim().toUpperCase();

    try {
      if (db) {
        const snapshot = await db.collection('licenses').where('code', '==', code).limit(1).get();
        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          const data = doc.data();
          if (data.deviceId === deviceId) {
            await doc.ref.update({ lastSeen: new Date().toISOString(), isPlaying: !!isPlaying });
            return res.json({ success: true, settings: data.settings || null });
          } else {
            log(`Heartbeat mismatch (Firebase) - Code: ${code}. DB: ${data.deviceId}, Req: ${deviceId}`);
            return res.status(403).json({ error: 'Este código está sendo usado em outro dispositivo.' });
          }
        }
      }
    } catch (error: any) {
      log(`POST /api/heartbeat Firebase failure: ${error.message}`);
    }

    const licenses = getLicensesLocal();
    const index = licenses.findIndex((l: any) => l.code && l.code.trim().toUpperCase() === code);
    if (index !== -1) {
      const license = licenses[index];
      if (license.deviceId === deviceId) {
        licenses[index].lastSeen = new Date().toISOString();
        licenses[index].isPlaying = !!isPlaying;
        saveLicensesLocal(licenses);
        return res.json({ success: true, settings: licenses[index].settings || null });
      } else {
        log(`Heartbeat mismatch (Local) - Code: ${code}. DB: ${license.deviceId}, Req: ${deviceId}`);
        return res.status(403).json({ error: 'Este código está sendo usado em outro dispositivo.' });
      }
    }
    res.status(404).json({ error: 'Monitoramento não encontrado' });
  });

  // API: Client Login (Remote Access)
  app.post('/api/client/login', async (req, res) => {
    let { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code required' });
    code = code.trim().toUpperCase();

    try {
      if (db) {
        const snapshot = await db.collection('licenses').where('code', '==', code).limit(1).get();
        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          const data = doc.data();
          return res.json({ 
            success: true, 
            clientName: data.clientName,
            settings: data.settings || {}
          });
        }
      }
    } catch (error) {
      log(`Client login Firebase failure: ${error}`);
    }

    const licenses = getLicensesLocal();
    const found = licenses.find((l: any) => l.code && l.code.trim().toUpperCase() === code);
    if (found) {
      return res.json({ 
        success: true, 
        clientName: found.clientName,
        settings: found.settings || {}
      });
    }
    res.status(404).json({ error: 'Código não encontrado' });
  });

  // API: Client Update Settings (Remote Access)
  app.put('/api/client/settings', async (req, res) => {
    let { code, settings } = req.body;
    if (!code || !settings) return res.status(400).json({ error: 'Missing data' });
    code = code.trim().toUpperCase();

    try {
      if (db) {
        const snapshot = await db.collection('licenses').where('code', '==', code).limit(1).get();
        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          await doc.ref.update({ settings });
          log(`Settings updated (Firebase) for client ${code}`);
          return res.json({ success: true });
        }
      }
    } catch (error) {
      log(`Client settings update Firebase failure: ${error}`);
    }

    const licenses = getLicensesLocal();
    const index = licenses.findIndex((l: any) => l.code && l.code.trim().toUpperCase() === code);
    if (index !== -1) {
      licenses[index].settings = settings;
      saveLicensesLocal(licenses);
      log(`Settings updated (Local) for client ${code}`);
      return res.json({ success: true });
    }
    res.status(404).json({ error: 'Código não encontrado' });
  });

  // API: Clear cache
  app.post('/api/cache/clear', (req, res) => {
    try {
      if (fs.existsSync(CACHE_DIR)) {
        fs.readdirSync(CACHE_DIR).forEach(file => {
          fs.unlinkSync(path.join(CACHE_DIR, file));
        });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to clear cache' });
    }
  });

  // Service Worker: No cache
  app.get(['/sw.js', '/manifest.json'], (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    next();
  });

  // API: List files from Google Drive Folder
  app.get('/api/files', async (req, res) => {
    let folderId = (req.query.folderId as string) || process.env.DRIVE_FOLDER_ID || '1RqCmlyP_sl9Jdr49SNVOkub80He1AYIR';
    console.log(`[API] Fetching files for folderId: ${folderId}`);
    
    if (!folderId) {
      return res.status(400).json({ error: 'DRIVE_FOLDER_ID not set and no folderId provided' });
    }

    // Resolve shortened URLs or full URLs if provided
    if (folderId.includes('http')) {
      try {
        // Handle cases where the user might have pasted the URL with extra text
        const urlMatch = folderId.match(/https?:\/\/[^\s]+/);
        if (urlMatch) folderId = urlMatch[0];

        console.log(`Resolving URL: ${folderId}`);
        const resolveResponse = await axios.get(folderId, {
          maxRedirects: 5,
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
          }
        });
        const finalUrl = resolveResponse.request.res.responseUrl || folderId;
        console.log(`Final resolved URL: ${finalUrl}`);
        
        // Extract ID from resolved URL - expanded regex
        const match = finalUrl.match(/folders\/([a-zA-Z0-9_-]{25,})/) || 
                     finalUrl.match(/\/file\/d\/([a-zA-Z0-9_-]{25,})/) ||
                     finalUrl.match(/[?&]id=([a-zA-Z0-9_-]{25,})/);
        
        if (match) {
          folderId = match[1];
          console.log(`Extracted ID: ${folderId}`);
        } else {
          // Try one last desperate attempt to find anything that looks like a Drive ID
          const idOnlyMatch = finalUrl.match(/([a-zA-Z0-9_-]{28,40})/);
          if (idOnlyMatch) {
            folderId = idOnlyMatch[1];
          }
        }
      } catch (err: any) {
        console.error(`Error resolving URL ${folderId}:`, err.message);
      }
    }

    // Final check: if it's still a URL, we couldn't resolve it to a folder ID
    if (folderId.startsWith('http')) {
      return res.status(400).json({ 
        error: 'Não foi possível extrair o ID da pasta do Google Drive deste link. Certifique-se de que é um link válido de uma pasta do Drive.' 
      });
    }

    try {
      // Try different views in order of reliability
      const views = [
        `https://drive.google.com/embeddedfolderview?id=${folderId}#list`,
        `https://drive.google.com/embeddedfolderview?id=${folderId}`,
        `https://drive.google.com/drive/folders/${folderId}?usp=sharing`,
        `https://drive.google.com/drive/u/0/mobile/folders/${folderId}`
      ];

      let files: any[] = [];

      for (const viewUrl of views) {
        try {
          console.log(`Attempting to scrape view: ${viewUrl}`);
          const response = await axios.get(viewUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
              'Cache-Control': 'no-cache'
            },
            timeout: 8000
          });

          const html = response.data;
          if (typeof html !== 'string') {
            console.log(`[Scraper] View ${viewUrl} returned non-string data`);
            continue;
          }
          
          console.log(`[Scraper] Fetched HTML for ${viewUrl}, length: ${html.length}`);

          // Check if we are being redirected to login
          if (html.includes('signin') || html.includes('login') || html.includes('ServiceLogin')) {
            console.log(`[Scraper] View ${viewUrl} redirected to login or requires auth.`);
            continue;
          }

          const $ = cheerio.load(html);

          // Method 1: Embedded View Table (.flip-entry)
          $('.flip-entry').each((_, el) => {
            const id = $(el).attr('data-id');
            const name = $(el).find('.flip-entry-title').text().trim();
            if (id && name && !files.find(f => f.id === id)) {
              const isVideo = /\.(mp4|webm|mov|avi|mkv)$/i.test(name);
              const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(name);
              const isAudio = /\.(mp3|wav|ogg|m4a)$/i.test(name);
              const isWeb = /\.(txt|url)$/i.test(name);
              
              if (isVideo || isImage || isWeb || isAudio) {
                files.push({
                  id,
                  name,
                  isVideo,
                  isAudio,
                  isWebsite: isWeb,
                  mimeType: isVideo ? 'video/mp4' : isAudio ? 'audio/mpeg' : isWeb ? 'text/html' : 'image/jpeg',
                  thumbnail: isWeb 
                    ? `https://cdn-icons-png.flaticon.com/512/2965/2965306.png` 
                    : isAudio
                    ? `https://cdn-icons-png.flaticon.com/512/3083/3083417.png`
                    : `https://drive.google.com/thumbnail?id=${id}&sz=w1000`,
                  url: isWeb ? `/api/website/${id}` : `/api/proxy/${id}`
                });
              }
            }
          });

          // Method 2: Look for any /file/d/ or ?id= links
          $('a').each((_, el) => {
            const href = $(el).attr('href') || '';
            const name = $(el).text().trim() || $(el).attr('title') || '';
            const idMatch = href.match(/\/file\/d\/([a-zA-Z0-9_-]{25,})/) || href.match(/[?&]id=([a-zA-Z0-9_-]{25,})/);
            if (idMatch && !files.find(f => f.id === idMatch[1])) {
              const id = idMatch[1];
              // If name is just "view" or empty, it's not a good candidate unless we find it elsewhere
              if (name && name.length > 4 && name.includes('.')) {
                const isVideo = /\.(mp4|webm|mov|avi|mkv)$/i.test(name);
                const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(name);
                const isAudio = /\.(mp3|wav|ogg|m4a)$/i.test(name);
                const isWeb = /\.(txt|url)$/i.test(name);
                
                if (isVideo || isImage || isWeb || isAudio) {
                  files.push({
                    id,
                    name,
                    isVideo,
                    isAudio,
                    isWebsite: isWeb,
                    mimeType: isVideo ? 'video/mp4' : isAudio ? 'audio/mpeg' : isWeb ? 'text/html' : 'image/jpeg',
                    thumbnail: isWeb 
                      ? `https://cdn-icons-png.flaticon.com/512/2965/2965306.png` 
                      : isAudio
                      ? `https://cdn-icons-png.flaticon.com/512/3083/3083417.png`
                      : `https://drive.google.com/thumbnail?id=${id}&sz=w1000`,
                    url: isWeb ? `/api/website/${id}` : `/api/proxy/${id}`
                  });
                }
              }
            }
          });

          // Method 3: Aggressive Regex on the entire HTML
          // Search for patterns like ["ID", "Name.ext"]
          const aggressivePatterns = [
            /\["([a-zA-Z0-9_-]{20,60})","([^"]+\.[a-zA-Z0-9]{2,4})"/g,
            /\["([a-zA-Z0-9_-]{20,60})",\["([^"]+\.[a-zA-Z0-9]{2,4})"/g,
            /"([a-zA-Z0-9_-]{20,60})",\["([^"]+\.[a-zA-Z0-9]{2,4})"/g,
            /id:"([a-zA-Z0-9_-]{20,60})",name:"([^"]+\.[a-zA-Z0-9]{2,4})"/g,
            /\{"id":"([a-zA-Z0-9_-]{20,60})","name":"([^"]+)"/g
          ];

          for (const pattern of aggressivePatterns) {
            let match;
            while ((match = pattern.exec(html)) !== null) {
              const id = match[1];
              const name = match[2].replace(/\\u002e/g, '.'); // Fix escaped dots
              if (id && name && !files.find(f => f.id === id)) {
                const isVideo = /\.(mp4|webm|mov|avi|mkv)$/i.test(name);
                const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(name);
                const isAudio = /\.(mp3|wav|ogg|m4a)$/i.test(name);
                const isWeb = /\.(txt|url)$/i.test(name);
                
                if (isVideo || isImage || isWeb || isAudio) {
                  files.push({
                    id,
                    name,
                    isVideo,
                    isAudio,
                    isWebsite: isWeb,
                    mimeType: isVideo ? 'video/mp4' : isAudio ? 'audio/mpeg' : isWeb ? 'text/html' : 'image/jpeg',
                    thumbnail: isWeb 
                      ? `https://cdn-icons-png.flaticon.com/512/2965/2965306.png` 
                      : isAudio
                      ? `https://cdn-icons-png.flaticon.com/512/3083/3083417.png`
                      : `https://drive.google.com/thumbnail?id=${id}&sz=w1000`,
                    url: isWeb ? `/api/website/${id}` : `/api/proxy/${id}`
                  });
                }
              }
            }
          }

          // Method 4: AF_initDataCallback parsing (Modern Drive structure)
          if (files.length === 0) {
            const initDataMatches = html.match(/AF_initDataCallback\(\{key: 'ds:[^']+'[^}]+\}\);/g);
            if (initDataMatches) {
              initDataMatches.forEach(match => {
                // Extract the data array part - more flexible regex
                const dataMatch = match.match(/data:(\[.*\])\s*\}\);/);
                if (dataMatch) {
                  try {
                    const data = JSON.parse(dataMatch[1]);
                    // Recursively find IDs and names in the nested array
                    const findFiles = (arr: any) => {
                      if (!Array.isArray(arr)) return;
                      
                      // Check for [ID, Name, ...] pattern
                      if (arr.length >= 2 && 
                          typeof arr[0] === 'string' && arr[0].length >= 25 && arr[0].length <= 50 &&
                          typeof arr[1] === 'string' && arr[1].includes('.') && arr[1].length < 255) {
                        
                        const id = arr[0];
                        const name = arr[1].replace(/\\u002e/g, '.');
                        
                        if (!files.find(f => f.id === id)) {
                          const isVideo = /\.(mp4|webm|mov|avi|mkv)$/i.test(name);
                          const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(name);
                          const isAudio = /\.(mp3|wav|ogg|m4a)$/i.test(name);
                          
                          if (isVideo || isImage || isAudio) {
                            files.push({
                              id, name, isVideo, isAudio, isWebsite: false,
                              thumbnail: isAudio ? `https://cdn-icons-png.flaticon.com/512/3083/3083417.png` : `https://drive.google.com/thumbnail?id=${id}&sz=w1000`,
                              url: `/api/proxy/${id}`
                            });
                          }
                        }
                      }
                      arr.forEach(item => findFiles(item));
                    };
                    findFiles(data);
                  } catch (e) {}
                }
              });
            }
          }

          // Method 5: Extreme Regex - find any ID-like string near a filename-like string
          if (files.length === 0) {
            // This regex looks for an ID, then some characters (up to 100), then a filename
            const extremeRegex = /"([a-zA-Z0-9_-]{25,50})"[^"]{1,100}"([^"]+\.(?:jpg|jpeg|png|gif|mp4|webm|mov|avi|mkv|mp3|wav|ogg|m4a))"/gi;
            let match;
            while ((match = extremeRegex.exec(html)) !== null) {
              const id = match[1];
              const name = match[2].replace(/\\u002e/g, '.');
              if (id && name && !files.find(f => f.id === id)) {
                const isVideo = /\.(mp4|webm|mov|avi|mkv)$/i.test(name);
                const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(name);
                const isAudio = /\.(mp3|wav|ogg|m4a)$/i.test(name);
                
                if (isVideo || isImage || isAudio) {
                  files.push({
                    id, name, isVideo, isAudio, isWebsite: false,
                    thumbnail: isAudio ? `https://cdn-icons-png.flaticon.com/512/3083/3083417.png` : `https://drive.google.com/thumbnail?id=${id}&sz=w1000`,
                    url: `/api/proxy/${id}`
                  });
                }
              }
            }
          }

          if (files.length > 0) {
            console.log(`Successfully found ${files.length} files in view ${viewUrl}`);
            break;
          }
        } catch (err: any) {
          console.error(`Error scraping ${viewUrl}:`, err.message);
        }
      }

      if (files.length === 0) {
        console.log(`No files found for folder: ${folderId}`);
        return res.status(404).json({ 
          error: 'Nenhum arquivo encontrado. Certifique-se de que a pasta é PÚBLICA (Qualquer pessoa com o link pode ver) e contém imagens ou vídeos.' 
        });
      }

      console.log(`Returning ${files.length} files for folder ${folderId}`);
      res.json(files);

      // Background tasks (non-blocking)
      (async () => {
        try {
          // Background sync: Download new files
          for (const file of files) {
            const isWeb = /\.(txt|url)$/i.test(file.name);
            const ext = path.extname(file.name) || (file.isVideo ? '.mp4' : (isWeb ? '.txt' : '.jpg'));
            const filePath = path.join(CACHE_DIR, `${file.id}${ext}`);
            if (!fs.existsSync(filePath)) {
              await downloadFile(file.id, filePath);
            }
          }

          // Cleanup: Remove files not in Drive
          const driveIds = new Set(files.map((f: any) => f.id));
          const cachedFiles = fs.readdirSync(CACHE_DIR);
          for (const file of cachedFiles) {
            const id = file.split('.')[0];
            if (!driveIds.has(id)) {
              try { fs.unlinkSync(path.join(CACHE_DIR, file)); } catch(e) {}
            }
          }
        } catch (bgError) {
          console.error('Background task error:', bgError);
        }
      })();

    } catch (error: any) {
      console.error('Main scraping error:', error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Erro ao processar a pasta do Google Drive. Verifique o link.' });
      }
    }
  });

  // API: Resolve website URL from .txt or .url file
  app.get('/api/website/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
      // Try to find in cache with either extension
      let filePath = path.join(CACHE_DIR, `${id}.txt`);
      if (!fs.existsSync(filePath)) {
        filePath = path.join(CACHE_DIR, `${id}.url`);
      }
      
      // If not in cache, we don't know the original extension here, 
      // so we try to download it. We'll save it as .txt by default for simplicity.
      if (!fs.existsSync(filePath)) {
        filePath = path.join(CACHE_DIR, `${id}.txt`);
        await downloadFile(id, filePath);
      }
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Arquivo não encontrado' });
      }

      const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
      console.log(`Processing website file ${id}, content length: ${content.length}`);
      
      // Robust URL extraction
      let url = '';
      
      // 1. Try URL=... (standard .url format)
      const urlMatch = content.match(/URL\s*=\s*([^\s\n\r]+)/i);
      if (urlMatch) {
        url = urlMatch[1].trim();
      } 
      
      // 2. If not found, try any http/https link anywhere in the file
      if (!url || !url.includes('.')) {
        const genericUrlMatch = content.match(/https?:\/\/[^\s\n\r"']+/);
        if (genericUrlMatch) {
          url = genericUrlMatch[0].trim();
        }
      }

      // 3. Special check for m3u8 or /ts links which might not have http
      if (!url || (!url.toLowerCase().includes('.m3u8') && !url.toLowerCase().includes('/ts'))) {
        const streamMatch = content.match(/[^\s\n\r"']+(\.m3u8|\/ts)[^\s\n\r"']*/i);
        if (streamMatch) {
          url = streamMatch[0].trim();
        }
      }
      
      // 4. Fallback: find the first line that looks like a domain/path
      if (!url || !url.includes('.')) {
        const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        for (const line of lines) {
          // Skip headers like [InternetShortcut]
          if (line.startsWith('[') && line.endsWith(']')) continue;
          
          // Take the first word that contains a dot
          const words = line.split(/\s+/);
          for (const word of words) {
            if (word.includes('.') && !word.includes('=') && word.length > 3 && !word.startsWith('[')) {
              url = word;
              break;
            }
          }
          if (url) break;
        }
      }
      
      if (url) {
        // Clean up the URL
        url = url.replace(/["'\]\);,]+$/, '').trim();
        
        // Remove common trailing garbage words from user notes
        const garbageWords = ['ai', 'pula', 'os', 'inicio', 'abra', 'so', 'o', 'site', 'clique', 'aqui'];
        let parts = url.split('/');
        let lastPart = parts[parts.length - 1].toLowerCase();
        
        if (garbageWords.includes(lastPart)) {
          parts.pop();
          url = parts.join('/');
        }
        
        // Ensure protocol
        if (!url.startsWith('http')) {
          url = url.startsWith('//') ? `https:${url}` : `https://${url}`;
        }
        
        console.log(`Resolved website URL for ID ${id}: ${url}`);
        res.json({ url });
      } else {
        console.warn(`No URL found in file content for ID ${id}: ${content.substring(0, 100)}...`);
        res.status(404).json({ error: 'Nenhuma URL encontrada no arquivo' });
      }
    } catch (error) {
      console.error('Error resolving website URL:', error);
      res.status(500).json({ error: 'Erro ao ler arquivo de website' });
    }
  });

  // API: Proxy/Stream file
  app.get('/api/proxy/:id', async (req, res) => {
    const { id } = req.params;
    
    // Check cache first
    const cachedFile = fs.readdirSync(CACHE_DIR).find(f => f.startsWith(id));
    if (cachedFile && !cachedFile.endsWith('.tmp')) {
      const filePath = path.join(CACHE_DIR, cachedFile);
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      const ext = path.extname(cachedFile).toLowerCase();
      const contentType = ext === '.mp4' ? 'video/mp4' : 
                          ext === '.webm' ? 'video/webm' : 
                          ext === '.png' ? 'image/png' : 'image/jpeg';

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(filePath, { start, end });
        const head = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType,
        };
        res.writeHead(206, head);
        file.pipe(res);
      } else {
        const head = {
          'Content-Length': fileSize,
          'Content-Type': contentType,
        };
        res.writeHead(200, head);
        fs.createReadStream(filePath).pipe(res);
      }
      return;
    }

    // If not in cache, stream from Drive with confirmation handling
    try {
      const driveUrl = `https://drive.google.com/uc?export=download&id=${id}`;
      
      // First request to check for confirmation token
      const checkResponse = await axios.get(driveUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        validateStatus: () => true
      });

      let finalUrl = driveUrl;
      if (typeof checkResponse.data === 'string' && checkResponse.data.includes('confirm=')) {
        const confirmMatch = checkResponse.data.match(/confirm=([a-zA-Z0-9_-]+)/);
        if (confirmMatch) {
          finalUrl = `${driveUrl}&confirm=${confirmMatch[1]}`;
        }
      }

      const response = await axios({
        method: 'get',
        url: finalUrl,
        responseType: 'stream',
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
      response.data.pipe(res);
    } catch (error) {
      res.status(404).send('File not found');
    }
  });

  // Generic stream proxy to bypass CORS and Mixed Content
  app.get('/api/stream-proxy', async (req, res) => {
    const streamUrl = req.query.url as string;
    if (!streamUrl) return res.status(400).send('URL is required');

    try {
      console.log(`Proxying stream: ${streamUrl}`);
      const response = await axios({
        method: 'get',
        url: streamUrl,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Referer': new URL(streamUrl).origin,
          'Accept': '*/*',
          'Connection': 'keep-alive'
        },
        timeout: 30000,
        maxRedirects: 5
      });

      console.log(`Stream response status: ${response.status}`);
      console.log(`Stream headers:`, JSON.stringify(response.headers));

      // Forward headers
      if (response.headers['content-type']) {
        res.setHeader('Content-Type', response.headers['content-type']);
      } else {
        // Force content type for TS streams if missing
        if (streamUrl.toLowerCase().includes('/ts')) {
          res.setHeader('Content-Type', 'video/mp2t');
        }
      }
      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }
      if (response.headers['accept-ranges']) {
        res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
      }

      response.data.pipe(res);
      
      response.data.on('error', (err: any) => {
        console.error('Proxy stream error:', err.message);
        if (!res.headersSent) res.status(500).send('Stream error');
      });
    } catch (error: any) {
      console.error('Proxy fetch error:', error.message);
      res.status(500).send('Failed to fetch stream');
    }
  });

  const downloading = new Set<string>();

  async function downloadFile(id: string, dest: string) {
    if (downloading.has(id)) return;
    downloading.add(id);
    const tempPath = `${dest}.tmp`;
    try {
      const driveUrl = `https://drive.google.com/uc?export=download&id=${id}`;
      
      // Get confirmation token
      const checkResponse = await axios.get(driveUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        validateStatus: () => true
      });

      let finalUrl = driveUrl;
      if (typeof checkResponse.data === 'string' && checkResponse.data.includes('confirm=')) {
        const confirmMatch = checkResponse.data.match(/confirm=([a-zA-Z0-9_-]+)/);
        if (confirmMatch) {
          finalUrl = `${driveUrl}&confirm=${confirmMatch[1]}`;
        }
      }

      const response = await axios({
        method: 'get',
        url: finalUrl,
        responseType: 'stream',
        timeout: 300000, // 5 minutes
      });

      const writer = fs.createWriteStream(tempPath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          fs.renameSync(tempPath, dest);
          console.log(`Downloaded: ${dest}`);
          downloading.delete(id);
          resolve(true);
        });
        writer.on('error', (err) => {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          downloading.delete(id);
          reject(err);
        });
      });
    } catch (error) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      downloading.delete(id);
      console.error(`Download failed for ${id}`);
    }
  }

  // Vite middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
