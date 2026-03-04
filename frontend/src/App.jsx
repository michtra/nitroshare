import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';

function mergeRegions(regions) {
  if (!regions.length) return [];
  const sorted = [...regions].sort((a, b) => a.start - b.start);
  const merged = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push({ ...sorted[i] });
    }
  }
  return merged;
}

function TrimModal({ video, token, onClose, onTrimSaved }) {
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [keepRegions, setKeepRegions] = useState([]);
  const [pendingStart, setPendingStart] = useState(null);
  const [trimming, setTrimming] = useState(false);
  const videoRef = useRef(null);
  const timelineRef = useRef(null);
  const scrubbingRef = useRef(false);

  const formatTime = (s) => {
    if (!s || isNaN(s)) return '0:00';
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };

  const scrubFromPointer = (e) => {
    if (!timelineRef.current || !videoRef.current?.duration) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    videoRef.current.currentTime = frac * videoRef.current.duration;
  };

  useEffect(() => {
    const handleMove = (e) => { if (scrubbingRef.current) scrubFromPointer(e); };
    const handleUp = () => { scrubbingRef.current = false; };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, []);

  const markStart = () => {
    const t = videoRef.current?.currentTime ?? 0;
    setPendingStart(t);
  };

  const markEnd = () => {
    if (pendingStart === null || !videoRef.current) return;
    const t = videoRef.current.currentTime;
    const start = Math.min(pendingStart, t);
    const end = Math.max(pendingStart, t);
    if (end - start < 0.5) {
      alert('Section must be at least 0.5 seconds.');
      return;
    }
    setKeepRegions(prev => [...prev, { id: Date.now(), start, end }]);
    setPendingStart(null);
  };

  const mergedKeep = mergeRegions(keepRegions);
  const keptDuration = mergedKeep.reduce((sum, s) => sum + (s.end - s.start), 0);
  const pct = (t) => `${(t / (duration || 1)) * 100}%`;

  const saveTrim = async () => {
    if (!mergedKeep.length) { alert('Mark at least one section to keep.'); return; }
    setTrimming(true);
    try {
      await axios.post(
        `/nitroshare/api/videos/${video.filename}/trim`,
        { keepSegments: mergedKeep },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      onTrimSaved();
      onClose();
    } catch (err) {
      alert('Trim failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setTrimming(false);
    }
  };

  return (
    <div className="trim-modal-overlay" onClick={onClose}>
      <div className="trim-modal" onClick={e => e.stopPropagation()}>
        <div className="trim-modal-header">
          <h3>Keep Working Sets</h3>
          <button onClick={onClose} className="trim-close-btn">Close</button>
        </div>

        <video
          ref={videoRef}
          src={video.videoUrl}
          controls
          playsInline
          onLoadedMetadata={() => setDuration(videoRef.current.duration)}
          onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
          className="trim-video-player"
        />

        <div
          className="trim-timeline"
          ref={timelineRef}
          onPointerDown={e => { e.preventDefault(); scrubbingRef.current = true; scrubFromPointer(e); }}
        >
          {duration > 0 && mergedKeep.map((seg, i) => (
            <div key={i} className="trim-keep-region" style={{ left: pct(seg.start), width: pct(seg.end - seg.start) }} />
          ))}
          {duration > 0 && keepRegions.map(r => (
            <div
              key={r.id}
              className="trim-keep-region-clickable"
              style={{ left: pct(r.start), width: pct(r.end - r.start) }}
              onPointerDown={e => e.stopPropagation()}
              onClick={() => setKeepRegions(prev => prev.filter(x => x.id !== r.id))}
            >
              <span className="trim-keep-label">{formatTime(r.end - r.start)}</span>
            </div>
          ))}
          {pendingStart !== null && duration > 0 && (
            <div className="trim-pending-marker" style={{ left: pct(pendingStart) }} />
          )}
          {duration > 0 && (
            <div className="trim-playhead" style={{ left: pct(currentTime) }} />
          )}
        </div>

        <div className="trim-time-row">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>

        <div className="trim-mark-buttons">
          {pendingStart === null ? (
            <button onClick={markStart} disabled={!duration} className="trim-mark-btn trim-start-btn">
              Mark Keep Start
            </button>
          ) : (
            <>
              <button onClick={() => setPendingStart(null)} className="trim-mark-btn trim-cancel-btn">
                Cancel ({formatTime(pendingStart)})
              </button>
              <button onClick={markEnd} className="trim-mark-btn trim-end-btn">
                Mark Keep End
              </button>
            </>
          )}
        </div>

        {pendingStart !== null && (
          <p className="trim-pending-hint">
            Keep starts at {formatTime(pendingStart)} - play to where the set ends, then tap Mark Keep End
          </p>
        )}

        {keepRegions.length > 0 && (
          <div className="trim-regions-list">
            {[...keepRegions].sort((a, b) => a.start - b.start).map((r, i) => (
              <div key={r.id} className="trim-region-item">
                <span>Set {i + 1}: {formatTime(r.start)} - {formatTime(r.end)} ({formatTime(r.end - r.start)})</span>
                <button onClick={() => setKeepRegions(prev => prev.filter(x => x.id !== r.id))} className="trim-region-delete">
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="trim-stats">
          <span>Original: {formatTime(duration)}</span>
          <span>Keeping: {formatTime(keptDuration)}</span>
        </div>

        <div className="trim-actions">
          {keepRegions.length > 0 && (
            <button onClick={() => setKeepRegions([])} className="action-button delete-button">Clear All</button>
          )}
          <button onClick={onClose} className="action-button delete-button">Cancel</button>
          <button onClick={saveTrim} disabled={trimming || !duration || !keepRegions.length} className="action-button share-button">
            {trimming ? 'Processing...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// axios base URL
const API_BASE_URL = '/nitroshare/api';

function App() {
  const [user, setUser] = useState(null);
  const [videos, setVideos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [trimVideo, setTrimVideo] = useState(null);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = restoreSession;
    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  const restoreSession = async () => {
    const saved = localStorage.getItem('nitroshare_user');
    if (!saved) return;
    try {
      const savedUser = JSON.parse(saved);
      // validate stored token is still active
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${savedUser.token}` }
      });
      if (!response.ok) {
        localStorage.removeItem('nitroshare_user');
        return;
      }
      setUser(savedUser);
      fetchVideos(savedUser.token);
    } catch {
      localStorage.removeItem('nitroshare_user');
    }
  };

  const signIn = () => {
    if (!window.google) {
      alert('Google Sign-In is not loaded yet. Please try again.');
      return;
    }

    // use popup directly
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: process.env.REACT_APP_GOOGLE_CLIENT_ID,
      scope: 'openid email profile',
      callback: async (tokenResponse) => {
        try {
          // get user info using the access token
          const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
              Authorization: `Bearer ${tokenResponse.access_token}`
            }
          });
          
          if (!response.ok) {
            throw new Error('Failed to get user info');
          }
          
          const userInfo = await response.json();
          
          const userData = {
            name: userInfo.name,
            email: userInfo.email,
            imageUrl: userInfo.picture,
            token: tokenResponse.access_token
          };
          setUser(userData);
          localStorage.setItem('nitroshare_user', JSON.stringify(userData));

          fetchVideos(tokenResponse.access_token);
        } catch (error) {
          console.error('Failed to get user info:', error);
          alert('Sign-in failed. Please try again.');
        }
      },
      error_callback: (error) => {
        console.error('OAuth error:', error);
        if (error.type !== 'popup_closed') {
          alert('Sign-in failed. Please try again.');
        }
      }
    });

    // request access token (this will open the popup)
    client.requestAccessToken();
  };

  const signOut = () => {
    if (window.google && user?.token) {
      window.google.accounts.oauth2.revoke(user.token, () => {
        console.log('Token revoked successfully');
      });
    }
    localStorage.removeItem('nitroshare_user');
    setUser(null);
    setVideos([]);
  };

  const fetchVideos = async (token) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/videos`, {
        headers: {
          Authorization: `Bearer ${token || user?.token}`
        }
      });
      setVideos(response.data);
    } catch (error) {
      console.error('Failed to fetch videos:', error);
      if (error.response?.status === 401 || error.response?.status === 403) {
        alert('Access denied. Please make sure you are using the authorized email.');
        signOut();
      }
    }
  };

  // file validation function
  const validateVideoFile = (file) => {
    // file size (500MB limit)
    const maxSize = 500 * 1024 * 1024; // 500MB in bytes
    if (file.size > maxSize) {
      return { valid: false, error: 'File size exceeds 500MB limit. Please choose a smaller file.' };
    }

    // more comprehensive video type checking
    const allowedExtensions = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.m4v', '.3gp'];
    const allowedMimeTypes = [
      'video/mp4',
      'video/avi',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-flv',
      'video/webm',
      'video/x-matroska',
      'video/3gpp',
      'video/x-m4v'
    ];

    const fileName = file.name.toLowerCase();
    const fileExtension = fileName.substring(fileName.lastIndexOf('.'));
    
    // check by extension first
    const hasValidExtension = allowedExtensions.some(ext => fileName.endsWith(ext));
    
    // then MIME type
    const hasValidMimeType = allowedMimeTypes.includes(file.type) || file.type.startsWith('video/');
    
    // if file has video in the type or valid extension, consider it valid
    // helps with iPhone videos that might have different MIME types
    if (hasValidExtension || hasValidMimeType) {
      return { valid: true };
    }

    return { 
      valid: false, 
      error: `Unsupported file type. Please upload a video file.\nFile type detected: ${file.type || 'unknown'}\nFile extension: ${fileExtension}` 
    };
  };

  const processFileUpload = async (file) => {
    if (!file) return;

    // Validate the file
    const validation = validateVideoFile(file);
    if (!validation.valid) {
      alert(validation.error);
      return;
    }

    const formData = new FormData();
    formData.append('video', file);

    setUploading(true);
    setUploadProgress(0);

    try {
      const response = await axios.post(`${API_BASE_URL}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          Authorization: `Bearer ${user.token}`
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          setUploadProgress(percentCompleted);
        },
        timeout: 10 * 60 * 1000, // 10 minutes timeout
        maxContentLength: 500 * 1024 * 1024,
        maxBodyLength: 500 * 1024 * 1024
      });

      alert('Video uploaded successfully!');
      fetchVideos();
    } catch (error) {
      console.error('Upload failed:', error);
      if (error.response?.status === 401 || error.response?.status === 403) {
        alert('Access denied. Please make sure you are using the authorized email.');
        signOut();
      } else if (error.response?.status === 413) {
        alert('File too large. Please choose a file smaller than 500MB.');
      } else if (error.code === 'ECONNABORTED') {
        alert('Upload timeout. Please try with a smaller file or check your connection.');
      } else {
        alert(`Upload failed: ${error.response?.data?.error || error.message}`);
      }
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    await processFileUpload(file);
    event.target.value = ''; // reset file input
  };

  // drag and drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!uploading) {
      setDragOver(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    if (uploading) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const file = files[0]; // only process the first file
      await processFileUpload(file);
    }
  };

  const deleteVideo = async (filename) => {
    if (!window.confirm('Are you sure you want to delete this video?')) {
      return;
    }

    try {
      await axios.delete(`${API_BASE_URL}/videos/${filename}`, {
        headers: {
          Authorization: `Bearer ${user.token}`
        }
      });
      alert('Video deleted successfully!');
      fetchVideos();
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Failed to delete video. Please try again.');
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      alert('Link copied to clipboard!');
    });
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  if (!user) {
    return (
      <div className="App">
        <div className="login-container">
          <h1>nitroshare</h1>
          <button onClick={signIn} className="sign-in-button">
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="App">
      <header className="header">
        <h1>nitroshare</h1>
        <div className="user-info">
          <img src={user.imageUrl} alt={user.name} className="user-avatar" />
          <span>{user.name}</span>
          <button onClick={signOut} className="sign-out-button">Sign Out</button>
        </div>
      </header>

      <main className="main-content">
        <div className="upload-section">
          <h2>Upload Video</h2>
          <div 
            className={`upload-area ${uploading ? 'disabled' : ''} ${dragOver ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              type="file"
              accept="video/*"
              onChange={handleFileUpload}
              disabled={uploading}
              className="file-input"
              id="video-upload"
            />
            <label htmlFor="video-upload" className={`upload-label ${uploading ? 'disabled' : ''}`}>
              {uploading ? 'Uploading...' : dragOver ? 'Drop video here' : 'Choose Video File'}
            </label>
            {!uploading && !dragOver && (
              <p className="drag-hint">
                Click to browse or drag a video file here
              </p>
            )}
            {uploading && (
              <div className="progress-container">
                <div className="progress-bar">
                  <div 
                    className="progress-fill" 
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
                <span className="progress-text">{uploadProgress}%</span>
              </div>
            )}
          </div>
          <p className="upload-info">
            Supported formats: MP4, AVI, MOV, WMV, FLV, WebM, MKV, M4V, 3GP<br/>
            Maximum file size: 500MB<br/>
            Videos are automatically deleted after 24 hours
          </p>
        </div>

        <div className="videos-section">
          <h2>Your Videos ({videos.length})</h2>
          {videos.length === 0 ? (
            <p className="no-videos">No videos uploaded yet.</p>
          ) : (
            <div className="videos-grid">
              {videos.map((video) => (
                <div key={video.filename} className="video-card">
                  <div className="video-preview">
                    <video controls preload="metadata">
                      <source src={video.videoUrl} type="video/mp4" />
                      Your browser does not support the video tag.
                    </video>
                  </div>
                  <div className="video-info">
                    <h3 className="video-filename">{video.filename}</h3>
                    <p className="video-details">
                      <span>Size: {formatFileSize(video.size)}</span><br/>
                      <span>Uploaded: {formatDate(video.uploadTime)}</span>
                    </p>
                    <div className="video-actions">
                      <button
                        onClick={() => copyToClipboard(video.shareUrl)}
                        className="action-button share-button"
                      >
                        Copy Share Link
                      </button>
                      <a
                        href={video.shareUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="action-button view-button"
                      >
                        View Share Page
                      </a>
                      <button
                        onClick={() => setTrimVideo(video)}
                        className="action-button trim-button"
                      >
                        Trim
                      </button>
                      <button
                        onClick={() => deleteVideo(video.filename)}
                        className="action-button delete-button"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
      {trimVideo && (
        <TrimModal
          video={trimVideo}
          token={user.token}
          onClose={() => setTrimVideo(null)}
          onTrimSaved={() => { fetchVideos(); setTrimVideo(null); }}
        />
      )}
    </div>
  );
}

export default App;
