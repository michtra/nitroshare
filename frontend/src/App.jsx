import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

// axios base URL
const API_BASE_URL = '/nitroshare/api';

function App() {
  const [user, setUser] = useState(null);
  const [videos, setVideos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = initializeGoogleSignIn;
    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  const initializeGoogleSignIn = () => {
    // we'll initialize the OAuth2 client directly for popup sign-in
    console.log('Google Identity Services loaded');
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
          
          setUser({
            name: userInfo.name,
            email: userInfo.email,
            imageUrl: userInfo.picture,
            token: tokenResponse.access_token
          });
          
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
      // revoke the token
      window.google.accounts.oauth2.revoke(user.token, () => {
        console.log('Token revoked successfully');
      });
    }
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
    </div>
  );
}

export default App;
