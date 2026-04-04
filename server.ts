import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import * as cheerio from 'cheerio';
import cors from 'cors';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;
  const CACHE_DIR = path.join(__dirname, 'cache');

  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR);
  }

  app.use(cors());
  app.use(express.json());

  // API: Clear cache
  app.post('/api/cache/clear', (req, res) => {
    try {
      fs.readdirSync(CACHE_DIR).forEach(file => {
        fs.unlinkSync(path.join(CACHE_DIR, file));
      });
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
    let folderId = (req.query.folderId as string) || process.env.DRIVE_FOLDER_ID;
    if (!folderId) {
      return res.status(400).json({ error: 'DRIVE_FOLDER_ID not set and no folderId provided' });
    }

    // Resolve shortened URLs or full URLs if provided
    if (folderId.startsWith('http')) {
      try {
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
        
        // Extract ID from resolved URL
        const match = finalUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
        const idMatch = finalUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        
        if (match) {
          folderId = match[1];
        } else if (idMatch) {
          folderId = idMatch[1];
        } else {
          // If it's still a URL but no ID found, it might be an invalid Drive link
          console.error(`Could not extract ID from resolved URL: ${finalUrl}`);
        }
      } catch (err: any) {
        console.error(`Error resolving URL ${folderId}:`, err.message);
        // Continue with original folderId, maybe it's already an ID
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
        `https://drive.google.com/drive/folders/${folderId}?usp=sharing`,
        `https://drive.google.com/drive/u/0/mobile/folders/${folderId}`
      ];

      let files: any[] = [];

      for (const viewUrl of views) {
        try {
          console.log(`Attempting to scrape view: ${viewUrl}`);
          const response = await axios.get(viewUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
              'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache'
            },
            timeout: 15000
          });

          const html = response.data;
          if (typeof html !== 'string') continue;

          // Check if we are being redirected to login
          if (html.includes('signin') || html.includes('login') || html.includes('ServiceLogin')) {
            console.log(`View ${viewUrl} redirected to login or requires auth.`);
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
              const isTxt = /\.txt$/i.test(name);
              
              if (isVideo || isImage || isTxt) {
                files.push({
                  id,
                  name,
                  isVideo,
                  isWebsite: isTxt,
                  thumbnail: isTxt 
                    ? `https://cdn-icons-png.flaticon.com/512/2965/2965306.png` 
                    : `https://drive.google.com/thumbnail?id=${id}&sz=w1000`,
                  url: isTxt ? `/api/website/${id}` : `/api/proxy/${id}`
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
                const isTxt = /\.txt$/i.test(name);
                
                if (isVideo || isImage || isTxt) {
                  files.push({
                    id,
                    name,
                    isVideo,
                    isWebsite: isTxt,
                    thumbnail: isTxt 
                      ? `https://cdn-icons-png.flaticon.com/512/2965/2965306.png` 
                      : `https://drive.google.com/thumbnail?id=${id}&sz=w1000`,
                    url: isTxt ? `/api/website/${id}` : `/api/proxy/${id}`
                  });
                }
              }
            }
          });

          // Method 3: Aggressive Regex on the entire HTML
          // Search for patterns like ["ID", "Name.ext"]
          const aggressivePatterns = [
            /\["([a-zA-Z0-9_-]{25,45})","([^"]+\.[a-zA-Z0-9]{2,4})"/g,
            /\["([a-zA-Z0-9_-]{25,45})",\["([^"]+\.[a-zA-Z0-9]{2,4})"/g,
            /"([a-zA-Z0-9_-]{25,45})",\["([^"]+\.[a-zA-Z0-9]{2,4})"/g
          ];

          for (const pattern of aggressivePatterns) {
            let match;
            while ((match = pattern.exec(html)) !== null) {
              const id = match[1];
              const name = match[2];
              if (id && name && !files.find(f => f.id === id)) {
                const isVideo = /\.(mp4|webm|mov|avi|mkv)$/i.test(name);
                const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(name);
                const isTxt = /\.txt$/i.test(name);
                
                if (isVideo || isImage || isTxt) {
                  files.push({
                    id,
                    name,
                    isVideo,
                    isWebsite: isTxt,
                    thumbnail: isTxt 
                      ? `https://cdn-icons-png.flaticon.com/512/2965/2965306.png` 
                      : `https://drive.google.com/thumbnail?id=${id}&sz=w1000`,
                    url: isTxt ? `/api/website/${id}` : `/api/proxy/${id}`
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
            const isTxt = /\.txt$/i.test(file.name);
            const ext = path.extname(file.name) || (file.isVideo ? '.mp4' : (isTxt ? '.txt' : '.jpg'));
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

  // API: Resolve website URL from .txt file
  app.get('/api/website/:id', async (req, res) => {
    const { id } = req.params;
    const filePath = path.join(CACHE_DIR, `${id}.txt`);
    
    try {
      // Ensure file exists in cache
      if (!fs.existsSync(filePath)) {
        await downloadFile(id, filePath);
      }
      
      const content = fs.readFileSync(filePath, 'utf8');
      // Simple regex to find the first URL in the file
      const urlMatch = content.match(/https?:\/\/[^\s\n\r]+/);
      
      if (urlMatch) {
        res.json({ url: urlMatch[0] });
      } else {
        res.status(404).json({ error: 'Nenhuma URL encontrada no arquivo .txt' });
      }
    } catch (error) {
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
