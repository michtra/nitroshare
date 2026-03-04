const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');
const fs = require('fs-extra');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { execFile } = require('child_process');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;

console.log('Environment check:');
console.log('- GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Missing');
console.log('- ALLOWED_EMAILS:', process.env.ALLOWED_EMAILS ? 'Set' : 'Missing');
console.log('- PORT:', process.env.PORT || 5000);

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

app.use(cors());

// increase payload limits for large video uploads
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

// add request timeout for large uploads (10 minutes)
app.use((req, res, next) => {
  req.setTimeout(10 * 60 * 1000); // 10 minutes
  res.setTimeout(10 * 60 * 1000); // 10 minutes
  next();
});

// serve static files under /nitroshare path
app.use('/nitroshare/uploads', express.static('uploads'));
app.use('/nitroshare', express.static(path.join(__dirname, 'frontend', 'build')));

// ensure uploads directory exists
fs.ensureDirSync('uploads');

// helper function to get user-specific directory
const getUserDirectory = (userEmail) => {
  // create a safe directory name from email
  const safeEmail = userEmail.replace(/[^a-zA-Z0-9]/g, '_');
  const userDir = path.join('uploads', safeEmail);
  fs.ensureDirSync(userDir);
  return userDir;
};

// enhanced file filter for better iPhone compatibility
const videoFileFilter = (req, file, cb) => {
  console.log('File upload attempt:', {
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size
  });

  // allowed extensions (case insensitive)
  const allowedExtensions = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.m4v', '.3gp'];
  
  // allowed MIME types (including common iPhone video types)
  const allowedMimeTypes = [
    'video/mp4',
    'video/avi',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-flv',
    'video/webm',
    'video/x-matroska',
    'video/3gpp',
    'video/x-m4v',
    // additional iPhone/mobile video types
    'video/mp4v-es',
    'video/x-mp4',
    'video/h264'
  ];

  const filename = file.originalname.toLowerCase();
  const extension = path.extname(filename);
  
  // check extension
  const hasValidExtension = allowedExtensions.includes(extension);
  
  // check MIME type (be more lenient with iPhone videos)
  const hasValidMimeType = allowedMimeTypes.includes(file.mimetype) || 
                          file.mimetype.startsWith('video/') ||
                          // Some iPhone videos might have application/octet-stream initially
                          (file.mimetype === 'application/octet-stream' && hasValidExtension);
  
  if (hasValidExtension || hasValidMimeType) {
    console.log('File accepted:', filename);
    return cb(null, true);
  } else {
    console.log('File rejected:', {
      filename,
      mimetype: file.mimetype,
      extension,
      reason: 'Invalid file type'
    });
    cb(new Error(`Only video files are allowed. Detected type: ${file.mimetype}, extension: ${extension}`));
  }
};

// template engine function for rendering the shared video page
function renderTemplate(templatePath, data) {
  let template = fs.readFileSync(templatePath, 'utf8');
  
  // Replace all {{variable}} placeholders with actual data
  Object.keys(data).forEach(key => {
    const regex = new RegExp(`{{${key}}}`, 'g');
    template = template.replace(regex, data[key]);
  });
  
  return template;
}
// storage configuration for multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userDir = getUserDirectory(req.user.email);
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const timestamp = new Date().toISOString().replace(/[:.-]/g, '_');
    const extension = path.extname(file.originalname);
    cb(null, `${timestamp}${extension}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit
    fieldSize: 500 * 1024 * 1024 // Also set field size limit
  },
  fileFilter: videoFileFilter
});

// get base URL with subdirectory
const getBaseUrl = (req) => {
  // check for forwarded protocol first, then fallback to req.protocol
  const protocol = req.get('X-Forwarded-Proto') || req.protocol;
  
  // force HTTPS in production if behind a proxy
  const finalProtocol = (process.env.NODE_ENV === 'production' && protocol === 'http') ? 'https' : protocol;
  
  return `${finalProtocol}://${req.get('host')}/nitroshare`;
};

// authentication middleware - only allows specific google accounts
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.sendStatus(401);
  }

  try {
    let payload;
    
    // try to verify as Google ID token first
    try {
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (idTokenError) {
      // if ID token verification fails, try as access token
      try {
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        
        if (!response.ok) {
          throw new Error('Invalid access token');
        }
        
        payload = await response.json();
      } catch (accessTokenError) {
        console.error('Token verification failed:', accessTokenError);
        return res.sendStatus(403);
      }
    }
    
    const allowedEmails = process.env.ALLOWED_EMAILS?.split(',').map(email => email.trim()) || [];
    
    if (allowedEmails.length === 0) {
      return res.status(500).json({ error: 'Server configuration error - no allowed emails configured' });
    }
    
    if (!allowedEmails.includes(payload.email)) {
      return res.status(403).json({ 
        error: 'Access denied - your email is not authorized',
        userEmail: payload.email 
      });
    }
    
    console.log(`✅ Access granted for: ${payload.email}`);
    req.user = payload;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.sendStatus(403);
  }
};

// routes
app.get('/nitroshare/*', (req, res, next) => {
  // skip API routes
  if (req.path.startsWith('/nitroshare/api/') || 
      req.path.startsWith('/nitroshare/uploads/') || 
      req.path.startsWith('/nitroshare/share/')) {
    return next();
  }
  
  // serve the React app
  const frontendPath = path.join(__dirname, 'frontend', 'build', 'index.html');
  
  if (fs.existsSync(frontendPath)) {
    res.sendFile(frontendPath);
  } else {
    res.status(404).send('Frontend not built. Please run: cd frontend && npm run build');
  }
});

// health check endpoint
app.get('/nitroshare/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.post('/nitroshare/api/upload', authenticateToken, (req, res, next) => {
  upload.single('video')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error('Multer error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Maximum size is 500MB.' });
      }
      return res.status(400).json({ error: err.message });
    } else if (err) {
      console.error('Upload error:', err);
      return res.status(400).json({ error: err.message });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    console.log('File uploaded successfully:', {
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });

    const safeEmail = req.user.email.replace(/[^a-zA-Z0-9]/g, '_');
    const baseUrl = getBaseUrl(req);
    const videoUrl = `${baseUrl}/uploads/${safeEmail}/${req.file.filename}`;
    const shareUrl = `${baseUrl}/share/${safeEmail}/${req.file.filename}`;
    
    res.json({
      message: 'Video uploaded successfully',
      filename: req.file.filename,
      videoUrl: videoUrl,
      shareUrl: shareUrl,
      uploadTime: new Date().toISOString()
    });
  });
});

app.get('/nitroshare/api/videos', authenticateToken, (req, res) => {
  const userDir = getUserDirectory(req.user.email);
  
  fs.readdir(userDir, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Unable to read user directory' });
    }
    
    const safeEmail = req.user.email.replace(/[^a-zA-Z0-9]/g, '_');
    const baseUrl = getBaseUrl(req);
    const videos = files
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.m4v', '.3gp'].includes(ext);
      })
      .map(file => {
        const filePath = path.join(userDir, file);
        const stats = fs.statSync(filePath);
        return {
          filename: file,
          uploadTime: stats.birthtime,
          size: stats.size,
          videoUrl: `${baseUrl}/uploads/${safeEmail}/${file}`,
          shareUrl: `${baseUrl}/share/${safeEmail}/${file}`
        };
      })
      .sort((a, b) => new Date(b.uploadTime) - new Date(a.uploadTime));
    
    res.json(videos);
  });
});

app.get('/nitroshare/share/:userEmail/:filename', (req, res) => {
  const userEmail = req.params.userEmail;
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'uploads', userEmail, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Video not found');
  }
  
  const baseUrl = getBaseUrl(req);
  const videoUrl = `${baseUrl}/uploads/${userEmail}/${filename}`;
  const shareUrl = `${baseUrl}/share/${userEmail}/${filename}`;
  
  // check if template exists
  const templatePath = path.join(__dirname, 'templates', 'share-template.html');
  
  if (fs.existsSync(templatePath)) {
    // use the template file
    const html = renderTemplate(templatePath, {
      filename: filename,
      videoUrl: videoUrl,
      shareUrl: shareUrl
    });
    res.send(html);
  } else {
    // fallback to inline HTML if template doesn't exist
    res.status(500).send('Share template not found. Please create templates/share-template.html');
  }
});

// trim video endpoint - concatenates kept segments using filter_complex
app.post('/nitroshare/api/videos/:filename/trim', authenticateToken, async (req, res) => {
  const filename = req.params.filename;
  const { keepSegments } = req.body;

  if (!Array.isArray(keepSegments) || keepSegments.length === 0) {
    return res.status(400).json({ error: 'keepSegments must be a non-empty array' });
  }
  for (const seg of keepSegments) {
    if (typeof seg.start !== 'number' || typeof seg.end !== 'number' || seg.start >= seg.end || seg.start < 0) {
      return res.status(400).json({ error: 'Invalid segment: ' + JSON.stringify(seg) });
    }
  }

  const userDir = getUserDirectory(req.user.email);
  const inputPath = path.join(userDir, filename);
  if (!fs.existsSync(inputPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }

  const ext = path.extname(filename);
  const baseName = path.basename(filename, ext);
  const outputFilename = `${baseName}_trim_${Date.now()}.mp4`;
  const outputPath = path.join(userDir, outputFilename);

  // probe whether the file has an audio stream
  const hasAudio = await new Promise((resolve) => {
    execFile('ffmpeg', ['-i', inputPath], (_err, _stdout, stderr) => {
      resolve(/Stream.*Audio/i.test(stderr));
    });
  });

  // build filter_complex that trims and concatenates all segments
  const n = keepSegments.length;
  const filterParts = [];
  keepSegments.forEach((seg, i) => {
    filterParts.push(`[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[v${i}]`);
    if (hasAudio) filterParts.push(`[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[a${i}]`);
  });
  const streamRefs = keepSegments.map((_, i) => (hasAudio ? `[v${i}][a${i}]` : `[v${i}]`)).join('');
  filterParts.push(`${streamRefs}concat=n=${n}:v=1:a=${hasAudio ? 1 : 0}[outv]${hasAudio ? '[outa]' : ''}`);

  const args = [
    '-i', inputPath,
    '-filter_complex', filterParts.join(';'),
    '-map', '[outv]',
    ...(hasAudio ? ['-map', '[outa]'] : []),
    '-y', outputPath
  ];

  try {
    await new Promise((resolve, reject) => {
      execFile('ffmpeg', args, (err, _stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve();
      });
    });

    const safeEmail = req.user.email.replace(/[^a-zA-Z0-9]/g, '_');
    const baseUrl = getBaseUrl(req);
    res.json({
      message: 'Video trimmed successfully',
      filename: outputFilename,
      videoUrl: `${baseUrl}/uploads/${safeEmail}/${outputFilename}`,
      shareUrl: `${baseUrl}/share/${safeEmail}/${outputFilename}`
    });
  } catch (error) {
    console.error('FFmpeg trim error:', error.message);
    res.status(500).json({ error: 'Trim failed: ' + error.message });
  }
});

// delete video endpoint - user can only delete their own videos
app.delete('/nitroshare/api/videos/:filename', authenticateToken, (req, res) => {
  const filename = req.params.filename;
  const userDir = getUserDirectory(req.user.email);
  const filePath = path.join(userDir, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Video not found' });
  }
  
  fs.remove(filePath, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to delete video' });
    }
    res.json({ message: 'Video deleted successfully' });
  });
});

// enhanced cleanup job - runs every hour and deletes files older than 24 hours from all user directories
cron.schedule('0 * * * *', () => {
  console.log('Running cleanup job...');
  
  const uploadsDir = path.join(__dirname, 'uploads');
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  fs.readdir(uploadsDir, (err, userDirs) => {
    if (err) {
      console.error('Error reading uploads directory:', err);
      return;
    }
    
    userDirs.forEach(userDir => {
      const userPath = path.join(uploadsDir, userDir);
      
      // check if it's a directory
      fs.stat(userPath, (err, stats) => {
        if (err || !stats.isDirectory()) return;
        
        // read files in user directory
        fs.readdir(userPath, (err, files) => {
          if (err) {
            console.error(`Error reading user directory ${userDir}:`, err);
            return;
          }
          
          files.forEach(file => {
            const filePath = path.join(userPath, file);
            
            fs.stat(filePath, (err, stats) => {
              if (err) {
                console.error('Error getting file stats:', err);
                return;
              }
              
              if (stats.birthtime < oneDayAgo) {
                fs.remove(filePath, (err) => {
                  if (err) {
                    console.error(`Error deleting file ${file}:`, err);
                  } else {
                    console.log(`Deleted old file: ${userDir}/${file}`);
                  }
                });
              }
            });
          });
        });
      });
    });
  });
});

app.listen(PORT, () => {
  console.log(`NitroShare server running on port ${PORT}`);
});
