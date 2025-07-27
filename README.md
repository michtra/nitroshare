# nitroshare

A full-stack web application for uploading and sharing videos. Features Google OAuth authentication, shareable links with proper social media embedding, and automatic file deletion after 24 hours.

Named after Discord Nitro because Discord prevents uploads of files over 10MB and I don't want to buy it.

**Note: This version is configured to run as a subdirectory `/nitroshare` on your website.**

## Setup

### 1. Google OAuth Setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API and Google OAuth2 API
4. Go to "Credentials" and create an OAuth 2.0 Client ID
5. Add your domain to authorized domains:
   - For development: `http://localhost:3000` and `http://localhost:5000`
   - For production: `https://yourdomain.com`
6. Add authorized JavaScript origins:
   - Development: `http://localhost:3000`
   - Production: `https://yourdomain.com`
7. Add authorized redirect URIs:
   - Development: `http://localhost:3000`
   - Production: `https://yourdomain.com/nitroshare`

### 2. Environment Setup

Create your backend environment file:
```bash
cp .env.example .env
```

`.env`:
```bash
# Backend Environment Variables
PORT=5000
GOOGLE_CLIENT_ID=your_google_client_id_here.apps.googleusercontent.com
ALLOWED_EMAILS=your_email@gmail.com,alternate_email@gmail.com
```

Create your frontend environment file:
```bash
cp frontend/.env.example frontend/.env
```

`frontend/.env`:
```bash
REACT_APP_GOOGLE_CLIENT_ID=your_google_client_id_here.apps.googleusercontent.com
REACT_APP_API_BASE=https://yourdomain.com/nitroshare
```

### 3. Development Setup

```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd frontend
npm install
cd ..

# Start backend (runs on port 5000)
npm run dev

# In another terminal, start frontend (runs on port 3000)
cd frontend
npm start
```

Visit `http://localhost:3000` to access the application during development.

## Production Deployment

1. **Clone and setup the backend:**
```bash
git clone https://github.com/michtra/nitroshare /opt/nitroshare
cd /opt/nitroshare
npm install
```

2. **Build the frontend:**
```bash
cd frontend
npm run build
cd ..
```

3. **Start with PM2:**
```bash
pm2 start server.js --name nitroshare
pm2 save
```

4. **Configure Nginx:**
Add ```nginx.conf```'s contents to your existing server block:

5. **Reload Nginx:**
```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Configuration

### File Upload Limits

The application supports files up to 500MB by default. To change this:

1. Update `server.js` multer configuration:
```javascript
limits: {
  fileSize: 1000 * 1024 * 1024, // 1GB limit
}
```

2. Update Nginx configuration:
```nginx
client_max_body_size 1000M;
```

3. Update the frontend validation in `App.jsx`:
```javascript
const maxSize = 1000 * 1024 * 1024; // 1GB in bytes
```

### Cleanup Schedule

The application automatically deletes videos older than 24 hours. The cleanup job runs every hour. You can modify the schedule in `server.js`:

```javascript
// Current: every hour
cron.schedule('0 * * * *', () => { ... });

// Daily at 2 AM
cron.schedule('0 2 * * *', () => { ... });

// Every 6 hours
cron.schedule('0 */6 * * *', () => { ... });
```

### Retention Period

To change how long videos are kept before deletion, modify the cleanup job in `server.js`:

```javascript
// Current: 24 hours
const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

// Change to 48 hours
const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

// Change to 1 week
const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
```

## API Endpoints

All endpoints are prefixed with `/nitroshare`

### Authentication Required

- `POST /nitroshare/api/upload` - Upload a video file
- `GET /nitroshare/api/videos` - List user's videos
- `DELETE /nitroshare/api/videos/:filename` - Delete a specific video

### Public
- `GET /nitroshare/api/health` - Health check endpoint
- `GET /nitroshare/share/:userEmail/:filename` - View shareable video page
- `GET /nitroshare/uploads/:userEmail/:filename` - Direct video file access

## Social Media Embedding

The shareable links include proper Open Graph and Twitter Card meta tags for embedding on platforms.

## Monitoring and Logs

### PM2 Monitoring
```bash
# View logs
pm2 logs nitroshare

# Monitor resources
pm2 monit

# Restart application
pm2 restart nitroshare

# View detailed info
pm2 info nitroshare
```

### Nginx Logs
```bash
# Access logs
sudo tail -f /var/log/nginx/access.log

# Error logs
sudo tail -f /var/log/nginx/error.log

# Filter for nitroshare requests
sudo tail -f /var/log/nginx/access.log | grep nitroshare
```

## Troubleshooting

### Common Issues

1. **"Access denied" error:**
   - Verify your email matches `ALLOWED_EMAILS` in .env exactly
   - Check Google OAuth configuration and client ID
   - Ensure domain is properly configured in Google Console
   - Verify environment variables are loaded correctly

2. **Upload fails with 404 error:**
   - Check that API calls are using correct base path (`/nitroshare/api/`)
   - Verify frontend `REACT_APP_API_BASE` environment variable
   - Ensure backend is running and accessible
   - Check nginx configuration for proper proxying

3. **Upload fails with 413 (Request Entity Too Large):**
   - Increase `client_max_body_size` in nginx configuration
   - Verify multer file size limits in server.js
   - Check that frontend enforces file size limits
   - Ensure sufficient disk space

4. **Upload timeout:**
   - Increase timeout values in nginx configuration
   - Check network connectivity and upload speed
   - Consider reducing file size or improving server resources
   - Verify axios timeout configuration in frontend

5. **Videos not embedding on social media:**
   - Ensure HTTPS is properly configured
   - Check Open Graph meta tags in share page HTML
   - Verify video file is accessible at direct URL
   - Test with social media debugger tools (Facebook, Twitter)

6. **Authentication issues:**
   - Clear browser cookies and localStorage
   - Verify Google OAuth configuration
   - Check browser console for JavaScript errors
   - Ensure CORS is properly configured

7. **Cleanup not working:**
   - Check server logs for cron job errors
   - Verify file permissions in uploads directory
   - Ensure sufficient disk space
   - Check that cron service is running

8. **Frontend not loading:**
   - Verify frontend was built successfully (`npm run build`)
   - Check that static files are being served correctly
   - Ensure nginx configuration serves React app for non-API routes
   - Verify `homepage` field in package.json is set to `/nitroshare`


## URLs

- Main application: `https://yourdomain.com/nitroshare/`
- API endpoints: `https://yourdomain.com/nitroshare/api/*`
- Shared videos: `https://yourdomain.com/nitroshare/share/:userEmail/:filename`
- Direct video access: `https://yourdomain.com/nitroshare/uploads/:userEmail/:filename`
