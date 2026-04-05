import { useState, useEffect, useRef, useCallback, CSSProperties } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Settings, X, Maximize, Minimize, Loader2, Volume2, VolumeX } from 'lucide-react';
import { DriveFile, AppSettings, DisplayMode } from './types';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';

const StreamPlayer = ({ url, isMuted, onEnded }: { url: string; isMuted: boolean; onEnded?: () => void }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsInteraction, setNeedsInteraction] = useState(false);

  useEffect(() => {
    if (!videoRef.current) return;

    setLoading(true);
    setError(null);
    setNeedsInteraction(false);
    
    const video = videoRef.current;
    let hls: Hls | null = null;
    let tsPlayer: mpegts.Player | null = null;
    let playTimeout: NodeJS.Timeout | null = null;

    const handlePlay = () => {
      setLoading(false);
      setNeedsInteraction(false);
    };

    video.addEventListener('playing', handlePlay);
    if (onEnded) {
      video.addEventListener('ended', onEnded);
    }

    const startPlayback = () => {
      setLoading(false);
      video.play().catch(err => {
        console.warn('Autoplay blocked:', err);
        setNeedsInteraction(true);
      });
    };

    const isHLS = url.toLowerCase().includes('.m3u8');
    const isTS = url.toLowerCase().includes('/ts') || url.toLowerCase().includes('.ts');

    if (isHLS && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        maxBufferLength: 60, // Increase buffer for smoother playback and offline resilience
        maxMaxBufferLength: 120,
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, startPlayback);
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls?.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls?.recoverMediaError();
              break;
            default:
              setError('Erro na transmissão');
              hls?.destroy();
              break;
          }
        }
      });
    } else if (isTS && mpegts.getFeatureList().mseLivePlayback) {
      tsPlayer = mpegts.createPlayer({
        type: 'mpegts',
        isLive: true,
        url: url,
        cors: true,
        withCredentials: false
      }, {
        enableStashBuffer: true, // Enable stash buffer
        stashInitialSize: 1024, // Increase initial stash size (1MB)
        isLive: true,
        lazyLoad: false
      });
      tsPlayer.attachMediaElement(video);
      tsPlayer.load();
      
      const playTs = () => {
        if (!loading) return;
        console.log('TS Metadata/MediaInfo arrived, playing...');
        setLoading(false);
        (tsPlayer?.play() as any)?.catch((err: any) => {
          console.warn('TS Autoplay blocked:', err);
          setNeedsInteraction(true);
        });
      };

      // Wait for some data before playing
      tsPlayer.on(mpegts.Events.METADATA_ARRIVED, playTs);
      tsPlayer.on(mpegts.Events.MEDIA_INFO, playTs);
      
      // Fallback play after 3 seconds if no metadata arrives
      playTimeout = setTimeout(() => {
        if (loading) {
          console.log('TS Play timeout reached, forcing play...');
          playTs();
        }
      }, 3000);
      
      tsPlayer.on(mpegts.Events.ERROR, (type, detail, info) => {
        console.error('MPEGTS Error:', type, detail, info);
        if (playTimeout) clearTimeout(playTimeout);
        // Fallback to regular video if MSE fails
        if (type === mpegts.ErrorTypes.NETWORK_ERROR) {
          setError('Erro de rede na transmissão');
        } else {
          console.log('Trying fallback to regular video tag...');
          video.src = url;
          video.play().catch(() => setNeedsInteraction(true));
        }
      });
    } else if ((isHLS || isTS) && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.addEventListener('loadedmetadata', startPlayback);
    } else {
      // Regular video (MP4, etc)
      video.src = url;
      video.addEventListener('loadedmetadata', startPlayback);
      video.addEventListener('error', () => {
        setError('Erro ao carregar vídeo');
      });
    }

    return () => {
      if (playTimeout) clearTimeout(playTimeout);
      video.removeEventListener('playing', handlePlay);
      if (onEnded) {
        video.removeEventListener('ended', onEnded);
      }
      if (hls) hls.destroy();
      if (tsPlayer) {
        tsPlayer.pause();
        tsPlayer.unload();
        tsPlayer.detachMediaElement();
        tsPlayer.destroy();
      }
    };
  }, [url]);

  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain"
        muted={isMuted}
        playsInline
        autoPlay
      />
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-white gap-4 z-10">
          <Loader2 className="w-12 h-12 animate-spin text-blue-500" />
          <p className="text-sm font-medium animate-pulse">Carregando transmissão...</p>
        </div>
      )}
      {needsInteraction && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 text-white gap-4">
          <button 
            onClick={() => videoRef.current?.play().then(() => setNeedsInteraction(false))}
            className="group flex flex-col items-center gap-2"
          >
            <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform shadow-xl">
              <Play className="w-10 h-10 fill-white ml-1" />
            </div>
            <span className="text-sm font-bold uppercase tracking-widest">Clique para Iniciar Live</span>
          </button>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white p-6 text-center gap-4">
          <p className="text-red-400 font-bold">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-blue-600 rounded-xl text-sm font-bold hover:bg-blue-700 transition-all"
          >
            Tentar Novamente
          </button>
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [audioFiles, setAudioFiles] = useState<DriveFile[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [nextIndex, setNextIndex] = useState<number | null>(null);
  const [isNextReady, setIsNextReady] = useState(false);
  const [currentAudioIndex, setCurrentAudioIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('app_settings');
    const defaultFolderId = import.meta.env.VITE_DRIVE_FOLDER_ID || 'https://drive.google.com/drive/folders/1RqCmlyP_sl9Jdr49SNVOkub80He1AYIR?usp=sharing';
    const defaultSettings: AppSettings = {
      displayMode: 'fill',
      orientation: 'horizontal',
      slideDuration: 5000,
      websiteDuration: 30000,
      autoStart: false,
      driveFolderId: defaultFolderId,
      isMuted: false,
      syncInterval: 30000,
      websiteRefreshInterval: 0,
      appRefreshInterval: 0
    };
    
    if (saved) {
      const parsed = JSON.parse(saved);
      // If the saved folderId is empty, use the default one
      if (!parsed.driveFolderId) {
        parsed.driveFolderId = defaultFolderId;
      }
      return { ...defaultSettings, ...parsed };
    }
    return defaultSettings;
  });

  useEffect(() => {
    if (showSettings) {
      setFolderInput(settings.driveFolderId);
    }
  }, [showSettings, settings.driveFolderId]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const [folderInput, setFolderInput] = useState(settings.driveFolderId);

  useEffect(() => {
    if (showSettings) {
      // If the current ID matches the default one, let's show the full URL as an example
      if (settings.driveFolderId === '1RqCmlyP_sl9Jdr49SNVOkub80He1AYIR') {
        setFolderInput('https://drive.google.com/drive/folders/1RqCmlyP_sl9Jdr49SNVOkub80He1AYIR');
      } else {
        setFolderInput(settings.driveFolderId);
      }
    }
  }, [showSettings, settings.driveFolderId]);

  const extractFolderId = (input: string) => {
    if (!input) return '';
    const trimmed = input.trim();
    
    // Try to extract ID from standard Google Drive URLs
    const driveMatch = trimmed.match(/folders\/([a-zA-Z0-9_-]{25,})/) || 
                       trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]{25,})/) ||
                       trimmed.match(/[?&]id=([a-zA-Z0-9_-]{25,})/);
    
    if (driveMatch) {
      return driveMatch[1];
    }

    // If it's a URL but not a standard Drive one, let's keep it for the server to resolve (bit.ly, etc)
    if (trimmed.startsWith('http')) {
      return trimmed;
    }
    
    // If it's just an ID, return it
    return trimmed.split('?')[0];
  };

  const [isFetching, setIsFetching] = useState(false);

  const [lastSync, setLastSync] = useState<Date | null>(null);

  const fetchFiles = useCallback(async () => {
    try {
      setIsFetching(true);
      setError(null);
      const folderId = settings.driveFolderId;
      if (!folderId) {
        setFiles([]);
        setIsLoading(false);
        setIsFetching(false);
        return;
      }
      const url = `/api/files?folderId=${encodeURIComponent(folderId)}`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (response.ok && Array.isArray(data)) {
        const visual = data.filter(f => !f.isAudio);
        const audio = data.filter(f => f.isAudio);

        setFiles(prevFiles => {
          const isSame = visual.length === prevFiles.length && 
                         visual.every((f, i) => f.id === prevFiles[i].id && f.name === prevFiles[i].name);
          
          if (isSame) {
            return prevFiles;
          }

          return visual.map(newFile => {
            const existingFile = prevFiles.find(f => f.id === newFile.id);
            if (existingFile) {
              return { ...newFile, isStream: existingFile.isStream };
            }
            return newFile;
          });
        });

        setAudioFiles(audio);
        setLastSync(new Date());
      } else {
        if (response.status === 404) {
          setFiles([]);
        }
        setError(data.error || 'Erro ao carregar arquivos');
      }
    } catch (error) {
      console.error('Failed to fetch files:', error);
      setError('Erro de conexão com o servidor');
    } finally {
      setIsLoading(false);
      setIsFetching(false);
    }
  }, [settings.driveFolderId]);

  useEffect(() => {
    fetchFiles();
    const interval = setInterval(fetchFiles, settings.syncInterval);
    return () => clearInterval(interval);
  }, [fetchFiles, settings.syncInterval]);

  // Auto-retry once on error if folder is set
  useEffect(() => {
    if (error && settings.driveFolderId && !isLoading) {
      const timer = setTimeout(() => {
        fetchFiles();
      }, 10000); // Retry after 10s
      return () => clearTimeout(timer);
    }
  }, [error, settings.driveFolderId, isLoading, fetchFiles]);

  const nextSlide = useCallback(() => {
    if (files.length === 0) return;
    const nextIdx = (currentIndex + 1) % files.length;
    setNextIndex(nextIdx);
    setIsNextReady(false);
  }, [files.length, currentIndex]);

  // Handle media ready state for next slide
  useEffect(() => {
    if (nextIndex === null) return;
    
    const nextFile = files[nextIndex];
    if (!nextFile) {
      setNextIndex(null);
      return;
    }

    // If it's a website or YouTube, we consider it "ready" immediately to avoid hanging,
    // but for images and videos we wait for actual load
    if (nextFile.isWebsite || nextFile.isYouTube) {
      setIsNextReady(true);
      return;
    }

    if (nextFile.isVideo) {
      const video = document.createElement('video');
      video.src = nextFile.url;
      video.preload = 'auto';
      video.oncanplaythrough = () => setIsNextReady(true);
      video.onerror = () => setIsNextReady(true); // Continue on error
    } else {
      const img = new Image();
      img.src = nextFile.url;
      img.onload = () => setIsNextReady(true);
      img.onerror = () => setIsNextReady(true); // Continue on error
    }
  }, [nextIndex, files]);

  // Perform the actual switch when next is ready
  useEffect(() => {
    if (nextIndex !== null && isNextReady) {
      setCurrentIndex(nextIndex);
      setNextIndex(null);
      setIsNextReady(false);
    }
  }, [nextIndex, isNextReady]);

  const nextAudio = useCallback(() => {
    if (audioFiles.length === 0) return;
    setCurrentAudioIndex(prev => (prev + 1) % audioFiles.length);
  }, [audioFiles.length]);

  // Reset index if out of bounds after sync
  useEffect(() => {
    if (files.length > 0 && currentIndex >= files.length) {
      setCurrentIndex(0);
    }
  }, [files.length, currentIndex]);

  useEffect(() => {
    if (audioFiles.length > 0 && currentAudioIndex >= audioFiles.length) {
      setCurrentAudioIndex(0);
    }
  }, [audioFiles.length, currentAudioIndex]);

  useEffect(() => {
    if (!isPlaying || files.length === 0 || nextIndex !== null) return;

    const currentFile = files[currentIndex];
    if (!currentFile) {
      setCurrentIndex(0);
      return;
    }
    
    if (currentFile.isVideo) {
      // Video handling is done via onEnded
      if (timerRef.current) clearTimeout(timerRef.current);
    } else if (currentFile.isWebsite) {
      // Website handling
      // If it's a stream, we don't advance automatically
      if (currentFile.isStream) {
        if (timerRef.current) clearTimeout(timerRef.current);
      } else {
        timerRef.current = setTimeout(nextSlide, settings.websiteDuration);
      }
    } else {
      // Image handling
      timerRef.current = setTimeout(nextSlide, settings.slideDuration);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPlaying, currentIndex, nextIndex, files, settings.slideDuration, settings.websiteDuration, nextSlide]);

  // Check if current stream file still exists in Drive
  useEffect(() => {
    if (!isPlaying || files.length === 0) return;
    const currentFile = files[currentIndex];
    if (!currentFile || !currentFile.isStream) return;

    // Check if current file ID is still in the files list
    const fileExists = files.some(f => f.id === currentFile.id);
    if (!fileExists) {
      console.log('Stream file deleted from Drive, moving to next slide');
      nextSlide();
    }
  }, [files, currentIndex, isPlaying, nextSlide]);

  const wakeLockRef = useRef<any>(null);

  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        console.log('Wake Lock is active');
      }
    } catch (err: any) {
      console.error(`${err.name}, ${err.message}`);
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
      console.log('Wake Lock released');
    }
  };

  useEffect(() => {
    if (isPlaying) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isPlaying) {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      releaseWakeLock();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isPlaying]);

  useEffect(() => {
    if (!audioRef.current) return;
    
    const currentFile = files[currentIndex];
    // Pause background music if a video or YouTube is playing
    const shouldPause = currentFile && (currentFile.isVideo || currentFile.isYouTube);
    
    if (shouldPause || !isPlaying) {
      audioRef.current.pause();
    } else if (isPlaying && audioFiles.length > 0) {
      audioRef.current.play().catch(err => console.warn('Audio play blocked:', err));
    }
  }, [isPlaying, currentIndex, files, audioFiles.length]);

  const startPlayer = () => {
    setIsPlaying(true);
    
    // Master Audio Unlock for Browsers
    try {
      // 1. Unlock Web Audio API
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        const ctx = new AudioContextClass();
        if (ctx.state === 'suspended') {
          ctx.resume();
        }
      }
      
      // 2. Unlock HTML5 Audio
      if (audioRef.current) {
        audioRef.current.play().then(() => {
          audioRef.current?.pause();
        }).catch(() => {});
      }

      // 3. Unlock Silent Audio
      if (silentAudioRef.current) {
        silentAudioRef.current.play().catch(() => {});
      }
    } catch (e) {
      console.warn('Audio unlock failed:', e);
    }

    // Request full screen
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    }
  };

  const currentFile = files[currentIndex];

  useEffect(() => {
    if (!isPlaying || settings.appRefreshInterval <= 0) return;
    
    // Minimum 30 seconds to prevent infinite reload loops
    const intervalTime = Math.max(settings.appRefreshInterval, 30000);

    const interval = setInterval(() => {
      window.location.reload();
    }, intervalTime);

    return () => clearInterval(interval);
  }, [isPlaying, settings.appRefreshInterval]);

  const [websiteUrl, setWebsiteUrl] = useState<string | null>(null);
  const [websiteKey, setWebsiteKey] = useState(0);
  const [websiteError, setWebsiteError] = useState<string | null>(null);
  
  // Media Caching Logic for Offline Resilience
  useEffect(() => {
    if (!files.length || !isPlaying) return;
    
    const cacheNextItems = async () => {
      if (!('caches' in window)) return;
      
      try {
        const cache = await caches.open('media-cache');
        // Cache the next 5 items
        for (let i = 1; i <= 5; i++) {
          const nextIdx = (currentIndex + i) % files.length;
          const file = files[nextIdx];
          if (file && file.url && !file.isYouTube && !file.isWebsite) {
            const cachedResponse = await cache.match(file.url);
            if (!cachedResponse) {
              console.log(`Caching media in background: ${file.name}`);
              cache.add(file.url).catch(() => {});
            }
          }
        }
      } catch (e) {
        console.warn('Cache error:', e);
      }
    };

    cacheNextItems();
  }, [currentIndex, files, isPlaying]);

  const audioRef = useRef<HTMLAudioElement>(null);
  const silentAudioRef = useRef<HTMLAudioElement>(null);
  const ytPlayerRef = useRef<any>(null);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    // Load YouTube API
    if (!(window as any).YT) {
      const tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }
  }, []);

  const getYouTubeId = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  const fetchWebsiteUrl = useCallback(async (silent = false) => {
    if (!currentFile || !currentFile.isWebsite) return;
    
    // If it's already a stream and we have a URL, don't re-fetch (it would reset the player)
    if (currentFile.isStream && websiteUrl) return;

    try {
      if (!silent) {
        setWebsiteError(null);
      }
      // Add timestamp to avoid caching the API response
      const response = await fetch(`${currentFile.url}?t=${Date.now()}`);
      if (!response.ok) {
        throw new Error(`Erro ao carregar URL: ${response.status}`);
      }
      const data = await response.json();
      if (data.url) {
        console.log('Fetched website URL:', data.url);
        // Check if it's an m3u8 stream, /ts stream, or direct video link BEFORE setting the URL
        const isVideoLink = data.url.toLowerCase().split('?')[0].match(/\.(m3u8|mp4|webm|mov|avi|mkv)$/i) || 
                            data.url.toLowerCase().split('?')[0].endsWith('/ts') ||
                            data.url.toLowerCase().includes('.m3u8') ||
                            data.url.toLowerCase().includes('/ts');
        
        const ytId = getYouTubeId(data.url);
        const isYouTube = !!ytId;
        
        console.log('Is Video/Stream link:', isVideoLink, 'Is YouTube:', isYouTube);
        
        if ((isVideoLink || isYouTube) && !currentFile.isStream) {
          console.log('Marking file as stream and updating files list');
          setFiles(prev => prev.map(f => f.id === currentFile.id ? { ...f, isStream: true, isYouTube: isYouTube } : f));
        }
        
        let finalUrl = data.url;
        if (isYouTube) {
          // Use mute=1 to guarantee autoplay, then unmute via API
          // Removing origin as it can sometimes cause issues in sandboxed environments
          finalUrl = `https://www.youtube.com/embed/${ytId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${ytId}&rel=0&modestbranding=1&playsinline=1&enablejsapi=1`;
        } else if (isVideoLink) {
          finalUrl = `/api/stream-proxy?url=${encodeURIComponent(data.url)}`;
        }
          
        setWebsiteUrl(finalUrl);
      } else {
        console.error('No URL found in response:', data);
        setWebsiteError('Nenhuma URL válida encontrada no arquivo.');
      }
    } catch (err: any) {
      console.error('Error fetching website URL:', err);
      setWebsiteError(err.message || 'Erro ao conectar com o servidor.');
    }
  }, [currentFile]);

  useEffect(() => {
    if (!isPlaying || !currentFile || !currentFile.isWebsite || settings.websiteRefreshInterval <= 0 || currentFile.isStream) return;
    
    // Minimum 10 seconds for website refresh
    const intervalTime = Math.max(settings.websiteRefreshInterval, 10000);

    const interval = setInterval(() => {
      // Re-fetch the URL from the server silently
      fetchWebsiteUrl(true);
      // Also increment key to force iframe reload
      setWebsiteKey(prev => prev + 1);
    }, intervalTime);

    return () => clearInterval(interval);
  }, [isPlaying, currentFile, settings.websiteRefreshInterval, fetchWebsiteUrl]);

  useEffect(() => {
    if (!isPlaying || !currentFile || !currentFile.isWebsite) {
      setWebsiteUrl(null);
      return;
    }

    // Only fetch if we don't have a URL yet or if it's not a stream
    if (!websiteUrl || !currentFile.isStream) {
      fetchWebsiteUrl();
    }
  }, [isPlaying, currentFile?.id, fetchWebsiteUrl, websiteUrl]);

  useEffect(() => {
    if (websiteUrl && currentFile && !currentFile.isStream) {
      const isVideoLink = websiteUrl.toLowerCase().includes('.m3u8') || 
                          websiteUrl.toLowerCase().includes('/ts') ||
                          websiteUrl.toLowerCase().match(/\.(mp4|webm|mov|avi|mkv)/i);
      if (isVideoLink) {
        console.log('Auto-detected video/stream URL:', websiteUrl);
        setFiles(prev => prev.map(f => f.id === currentFile.id ? { ...f, isStream: true } : f));
      } else {
        const ytId = getYouTubeId(websiteUrl);
        if (ytId) {
          console.log('Auto-detected YouTube URL:', websiteUrl);
          setFiles(prev => prev.map(f => f.id === currentFile.id ? { ...f, isStream: true, isYouTube: true } : f));
          // Use mute=1 to guarantee autoplay
          setWebsiteUrl(`https://www.youtube.com/embed/${ytId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${ytId}&rel=0&modestbranding=1&playsinline=1&enablejsapi=1`);
        }
      }
    }
  }, [websiteUrl, currentFile]);

  useEffect(() => {
    if (currentFile?.isYouTube && websiteUrl && isPlaying) {
      const initPlayer = () => {
        if (ytPlayerRef.current) {
          try {
            ytPlayerRef.current.destroy();
          } catch (e) {}
        }

        ytPlayerRef.current = new (window as any).YT.Player('youtube-player', {
          events: {
            'onReady': (event: any) => {
              console.log('YouTube Player Ready');
              
              const forceUnmute = () => {
                if (!settingsRef.current.isMuted) {
                  try {
                    console.log('Attempting to unmute YouTube player...');
                    event.target.unMute();
                    event.target.setVolume(100);
                    event.target.playVideo();
                    
                    // Verify and retry
                    setTimeout(() => {
                      if (event.target.isMuted() && !settingsRef.current.isMuted) {
                        event.target.unMute();
                        event.target.setVolume(100);
                      }
                      if (event.target.getPlayerState() !== 1) {
                        event.target.playVideo();
                      }
                    }, 500);
                  } catch (e) {
                    console.warn('Failed to unmute:', e);
                  }
                } else {
                  event.target.playVideo();
                }
              };

              // Try multiple times with increasing delays
              forceUnmute();
              [100, 500, 1000, 2000, 3000, 5000].forEach(delay => setTimeout(forceUnmute, delay));
            },
            'onStateChange': (event: any) => {
              console.log('YouTube Player State Change:', event.data);
              if (event.data === (window as any).YT.PlayerState.PLAYING) {
                if (!settingsRef.current.isMuted) {
                  event.target.unMute();
                  event.target.setVolume(100);
                }
              }
              if (event.data === (window as any).YT.PlayerState.ENDED) {
                event.target.playVideo();
              }
              // If paused or unstarted, try to play
              if (event.data === (window as any).YT.PlayerState.PAUSED || event.data === (window as any).YT.PlayerState.UNSTARTED) {
                event.target.playVideo();
              }
            }
          }
        });
      };

      if ((window as any).YT && (window as any).YT.Player) {
        initPlayer();
      } else {
        (window as any).onYouTubeIframeAPIReady = initPlayer;
      }
    }

    return () => {
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch (e) {}
        ytPlayerRef.current = null;
      }
    };
  }, [currentFile?.id, websiteUrl, isPlaying]); // Removed settings.isMuted to prevent re-init

  useEffect(() => {
    if (ytPlayerRef.current && ytPlayerRef.current.unMute) {
      if (settings.isMuted) {
        try { ytPlayerRef.current.mute(); } catch (e) {}
      } else {
        try {
          ytPlayerRef.current.unMute();
          ytPlayerRef.current.setVolume(100);
        } catch (e) {}
      }
    }
  }, [settings.isMuted]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (ytPlayerRef.current && !settingsRef.current.isMuted) {
        try {
          // 1. Try API
          if (typeof ytPlayerRef.current.unMute === 'function') {
            ytPlayerRef.current.unMute();
            ytPlayerRef.current.setVolume(100);
            if (ytPlayerRef.current.getPlayerState && ytPlayerRef.current.getPlayerState() !== 1) {
              ytPlayerRef.current.playVideo();
            }
          }
          
          // 2. Try PostMessage fallback (very aggressive)
          const iframe = document.getElementById('youtube-player') as HTMLIFrameElement;
          if (iframe && iframe.contentWindow) {
            const commands = [
              { event: 'command', func: 'unMute', args: [] },
              { event: 'command', func: 'setVolume', args: [100] },
              { event: 'command', func: 'playVideo', args: [] }
            ];
            commands.forEach(cmd => {
              iframe.contentWindow?.postMessage(JSON.stringify(cmd), '*');
            });
          }
        } catch (e) {}
      }
    }, 500); // Check every 500ms for the first few seconds
    
    // User requested "7-second kickstart" - a forced "touch" to ensure sound/play
    const kickstartTimeout = setTimeout(() => {
      console.log('7-second kickstart triggered');
      if (ytPlayerRef.current && !settingsRef.current.isMuted) {
        try {
          ytPlayerRef.current.unMute();
          ytPlayerRef.current.setVolume(100);
          ytPlayerRef.current.playVideo();
          
          const iframe = document.getElementById('youtube-player') as HTMLIFrameElement;
          iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'unMute', args: [] }), '*');
          iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [100] }), '*');
          iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
        } catch (e) {}
      }
    }, 7000);

    // Stop aggressive check after 10 seconds to save resources, but keep a slower one
    const timeout = setTimeout(() => {
      clearInterval(interval);
      const slowerInterval = setInterval(() => {
        if (ytPlayerRef.current && !settingsRef.current.isMuted) {
          const iframe = document.getElementById('youtube-player') as HTMLIFrameElement;
          iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'unMute', args: [] }), '*');
        }
      }, 3000);
      (window as any)._ytSlowerInterval = slowerInterval;
    }, 10000);

    return () => {
      clearInterval(interval);
      clearTimeout(kickstartTimeout);
      clearTimeout(timeout);
      if ((window as any)._ytSlowerInterval) clearInterval((window as any)._ytSlowerInterval);
    };
  }, [currentIndex]); // Re-run on every video change

  useEffect(() => {
    const handleGlobalInteraction = () => {
      if (!settingsRef.current.isMuted) {
        // Try API
        if (ytPlayerRef.current && ytPlayerRef.current.unMute) {
          try {
            ytPlayerRef.current.unMute();
            ytPlayerRef.current.setVolume(100);
            ytPlayerRef.current.playVideo();
          } catch (e) {}
        }
        
        // Try PostMessage fallback
        const iframe = document.getElementById('youtube-player') as HTMLIFrameElement;
        if (iframe && iframe.contentWindow) {
          try {
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'unMute', args: [] }), '*');
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [100] }), '*');
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
          } catch (e) {}
        }

        // Also unlock silent audio if not playing
        if (silentAudioRef.current) {
          silentAudioRef.current.play().catch(() => {});
        }
      }
    };
    window.addEventListener('click', handleGlobalInteraction);
    window.addEventListener('touchstart', handleGlobalInteraction);
    window.addEventListener('mousedown', handleGlobalInteraction);
    window.addEventListener('keydown', handleGlobalInteraction);
    return () => {
      window.removeEventListener('click', handleGlobalInteraction);
      window.removeEventListener('touchstart', handleGlobalInteraction);
      window.removeEventListener('mousedown', handleGlobalInteraction);
      window.removeEventListener('keydown', handleGlobalInteraction);
    };
  }, []);

  const toggleDisplayMode = () => {
    const modes: DisplayMode[] = ['fill', 'fit', 'stretch'];
    const nextMode = modes[(modes.indexOf(settings.displayMode) + 1) % modes.length];
    const newSettings = { ...settings, displayMode: nextMode };
    setSettings(newSettings);
    localStorage.setItem('app_settings', JSON.stringify(newSettings));
  };

  const getObjectFit = () => {
    switch (settings.displayMode) {
      case 'fill': return 'cover';
      case 'fit': return 'contain';
      case 'stretch': return 'fill';
      default: return 'cover';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-black text-white">
        <Loader2 className="w-12 h-12 animate-spin text-blue-500" />
        <span className="ml-4 text-xl font-medium">Sincronizando com Google Drive...</span>
      </div>
    );
  }

  if (!isPlaying) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-neutral-900 text-white p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-2xl"
        >
          <h1 className="text-5xl font-bold mb-4 tracking-tight text-blue-500">RP Midia Indoor</h1>
          
          <div className="flex flex-col gap-4 justify-center items-center">
            {files.length === 0 && (
              <div className="w-full max-w-md mb-4">
                <label className="block text-xs text-neutral-400 mb-1 text-left">URL da Pasta do Google Drive</label>
                <div className="flex gap-2">
                  <input 
                    type="text"
                    placeholder="Cole o link da pasta pública aqui..."
                    value={folderInput}
                    onChange={(e) => setFolderInput(e.target.value)}
                    className="flex-1 bg-neutral-800 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                  <button 
                    onClick={() => {
                      const extractedId = extractFolderId(folderInput);
                      const newSettings = { ...settings, driveFolderId: extractedId };
                      setSettings(newSettings);
                      localStorage.setItem('app_settings', JSON.stringify(newSettings));
                      fetchFiles();
                    }}
                    className="bg-blue-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-700 transition-all"
                  >
                    ATUALIZAR
                  </button>
                </div>
              </div>
            )}
            
            <div className="flex gap-4 justify-center items-center">
              <button 
                onClick={startPlayer}
                disabled={files.length === 0}
                className={`flex items-center gap-2 px-8 py-4 rounded-full text-xl font-bold transition-all transform shadow-lg ${
                  files.length > 0 
                  ? "bg-blue-600 hover:bg-blue-700 text-white hover:scale-105 active:scale-95 shadow-blue-900/20" 
                  : "bg-neutral-700 text-neutral-500 cursor-not-allowed"
                }`}
              >
                {isFetching && files.length === 0 ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    CARREGANDO...
                  </>
                ) : (
                  <>
                    <Play className="fill-current" /> INICIAR
                  </>
                )}
              </button>
              <button 
                onClick={() => setShowSettings(true)}
                className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-white px-8 py-4 rounded-full text-xl font-bold transition-all"
              >
                <Settings /> CONFIGS
              </button>
              {isFetching && <Loader2 className="w-6 h-6 animate-spin text-blue-500" />}
            </div>
          </div>

          {files.length === 0 && settings.driveFolderId && !isFetching && (
            <div className="mt-8 p-4 bg-red-900/20 border border-red-900/30 rounded-2xl text-red-400 text-sm">
              <p className="font-bold mb-1">Nenhum arquivo encontrado!</p>
              <p className="opacity-80">Verifique se a pasta do Google Drive é <strong>PÚBLICA</strong> (Qualquer pessoa com o link pode ver) e se contém imagens ou vídeos.</p>
              <button 
                onClick={() => { setIsLoading(true); fetchFiles(); }}
                className="mt-4 px-4 py-2 bg-red-900/40 hover:bg-red-900/60 rounded-lg text-xs font-bold transition-all underline"
              >
                Tentar novamente agora
              </button>
            </div>
          )}
        </motion.div>

        {showSettings && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Configurações</h2>
                <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-neutral-800 rounded-full transition-colors"><X className="w-5 h-5" /></button>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-neutral-400 mb-1">URL ou ID da Pasta do Google Drive</label>
                  <textarea 
                    placeholder="Cole o link da pasta pública aqui..."
                    value={folderInput}
                    onChange={(e) => setFolderInput(e.target.value)}
                    rows={2}
                    className="w-full bg-neutral-800 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none break-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-neutral-400 mb-1">Modo de Exibição</label>
                    <button 
                      onClick={toggleDisplayMode}
                      className="w-full bg-neutral-800 p-3 rounded-xl text-left flex justify-between items-center"
                    >
                      <span className="capitalize text-sm font-medium">
                        {settings.displayMode === 'fill' ? 'Preencher' : 
                         settings.displayMode === 'fit' ? 'Ajustar' : 'Esticar'}
                      </span>
                      <span className="text-[10px] text-blue-400">ALTERAR</span>
                    </button>
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-400 mb-1">Som Geral</label>
                    <button 
                      onClick={() => {
                        const newSettings = { ...settings, isMuted: !settings.isMuted };
                        setSettings(newSettings);
                        localStorage.setItem('app_settings', JSON.stringify(newSettings));
                      }}
                      className={`w-full p-3 rounded-xl flex justify-between items-center transition-colors ${
                        settings.isMuted ? 'bg-neutral-800 text-neutral-400' : 'bg-blue-600/20 text-blue-400 border border-blue-600/30'
                      }`}
                    >
                      <span className="font-medium text-sm">{settings.isMuted ? 'MUDO' : 'COM SOM'}</span>
                      <span className="text-[10px]">{settings.isMuted ? 'ATIVAR' : 'MUTAR'}</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-neutral-400 mb-1">Orientação da Tela</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => {
                        const newSettings = { ...settings, orientation: 'horizontal' as const };
                        setSettings(newSettings);
                        localStorage.setItem('app_settings', JSON.stringify(newSettings));
                      }}
                      className={`p-2 rounded-xl flex items-center justify-center gap-2 transition-all ${
                        settings.orientation === 'horizontal' 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                      }`}
                    >
                      <Maximize className="w-4 h-4 rotate-90" />
                      <span className="text-xs font-bold">HORIZONTAL</span>
                    </button>
                    <button 
                      onClick={() => {
                        const newSettings = { ...settings, orientation: 'vertical' as const };
                        setSettings(newSettings);
                        localStorage.setItem('app_settings', JSON.stringify(newSettings));
                      }}
                      className={`p-2 rounded-xl flex items-center justify-center gap-2 transition-all ${
                        settings.orientation === 'vertical' 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                      }`}
                    >
                      <Maximize className="w-4 h-4" />
                      <span className="text-xs font-bold">VERTICAL</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-neutral-400 mb-1">Tempo Imagem (s)</label>
                    <input 
                      type="number"
                      min="1"
                      value={settings.slideDuration / 1000}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) * 1000;
                        if (isNaN(val)) return;
                        const newSettings = { ...settings, slideDuration: val };
                        setSettings(newSettings);
                        localStorage.setItem('app_settings', JSON.stringify(newSettings));
                      }}
                      className="w-full bg-neutral-800 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-400 mb-1">Tempo Site (s)</label>
                    <input 
                      type="number"
                      min="1"
                      value={settings.websiteDuration / 1000}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) * 1000;
                        if (isNaN(val)) return;
                        const newSettings = { ...settings, websiteDuration: val };
                        setSettings(newSettings);
                        localStorage.setItem('app_settings', JSON.stringify(newSettings));
                      }}
                      className="w-full bg-neutral-800 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-400 mb-1">Sincronização (s)</label>
                    <input 
                      type="number"
                      min="10"
                      value={settings.syncInterval / 1000}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) * 1000;
                        if (isNaN(val)) return;
                        const newSettings = { ...settings, syncInterval: val };
                        setSettings(newSettings);
                        localStorage.setItem('app_settings', JSON.stringify(newSettings));
                      }}
                      className="w-full bg-neutral-800 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-400 mb-1">Recarregar Site (s)</label>
                    <input 
                      type="number"
                      min="0"
                      value={settings.websiteRefreshInterval / 1000}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) * 1000;
                        if (isNaN(val)) return;
                        const newSettings = { ...settings, websiteRefreshInterval: val };
                        setSettings(newSettings);
                        localStorage.setItem('app_settings', JSON.stringify(newSettings));
                      }}
                      className="w-full bg-neutral-800 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-400 mb-1">Recarregar App (s)</label>
                    <input 
                      type="number"
                      min="0"
                      value={settings.appRefreshInterval / 1000}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) * 1000;
                        if (isNaN(val)) return;
                        const newSettings = { ...settings, appRefreshInterval: val };
                        setSettings(newSettings);
                        localStorage.setItem('app_settings', JSON.stringify(newSettings));
                      }}
                      className="w-full bg-neutral-800 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </div>
                </div>

                <div className="pt-3 border-t border-neutral-800 grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => {
                      fetchFiles();
                      alert('Sincronização iniciada!');
                    }}
                    className="bg-blue-900/20 hover:bg-blue-900/40 text-blue-400 py-2 rounded-xl text-xs font-medium transition-colors"
                  >
                    SINCRONIZAR AGORA
                  </button>
                  <button 
                    onClick={async () => {
                      if (confirm('Tem certeza que deseja limpar o cache local? Isso forçará o download de todos os arquivos novamente.')) {
                        await fetch('/api/cache/clear', { method: 'POST' });
                        alert('Cache limpo com sucesso!');
                        fetchFiles();
                      }
                    }}
                    className="bg-red-900/20 hover:bg-red-900/40 text-red-400 py-2 rounded-xl text-xs font-medium transition-colors"
                  >
                    LIMPAR CACHE
                  </button>
                </div>
              </div>

              <button 
                onClick={() => {
                  const extractedId = extractFolderId(folderInput);
                  const newSettings = { ...settings, driveFolderId: extractedId };
                  setSettings(newSettings);
                  localStorage.setItem('app_settings', JSON.stringify(newSettings));
                  setShowSettings(false);
                  setIsLoading(true); // Trigger reload
                  
                  // If the user pasted a URL, let's keep it in the input for next time they open settings
                  // but the settings.driveFolderId will have the extracted ID
                  setFolderInput(folderInput);
                  
                  fetchFiles();
                }}
                className="w-full bg-blue-600 mt-4 py-3 rounded-xl font-bold text-sm"
              >
                SALVAR E FECHAR
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const renderFile = (file: DriveFile, isPreload: boolean) => {
    if (file.isVideo) {
      return (
        <div className="relative w-full h-full">
          <video
            ref={isPreload ? undefined : videoRef}
            src={file.url}
            autoPlay={!isPreload}
            muted={settings.isMuted}
            playsInline
            onEnded={isPreload ? undefined : nextSlide}
            onLoadedData={() => {
              if (!isPreload && videoRef.current) {
                videoRef.current.play().catch(err => {
                  console.log("Autoplay blocked, user interaction needed", err);
                });
              }
            }}
            onError={(e) => {
              if (!isPreload) {
                console.error('Video error:', e);
                setTimeout(nextSlide, 2000);
              }
            }}
            className="w-full h-full"
            style={{ objectFit: getObjectFit() as any }}
          />
        </div>
      );
    } else if (file.isWebsite) {
      return (
        <div className="w-full h-full bg-white relative">
          {websiteUrl ? (
            file.isStream ? (
              file.isYouTube ? (
                <div className="w-full h-full relative group">
                  <iframe 
                    id={isPreload ? undefined : "youtube-player"}
                    key={websiteKey}
                    src={websiteUrl} 
                    className="w-full h-full border-none"
                    title={file.name}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                  />
                  {!isPreload && (
                    <div 
                      className="absolute inset-0 z-10 cursor-none bg-transparent"
                      onClick={() => {
                        console.log('Overlay clicked, forcing YouTube play/unmute');
                        if (ytPlayerRef.current) {
                          ytPlayerRef.current.unMute();
                          ytPlayerRef.current.setVolume(100);
                          ytPlayerRef.current.playVideo();
                        }
                        const iframe = document.getElementById('youtube-player') as HTMLIFrameElement;
                        if (iframe && iframe.contentWindow) {
                          iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'unMute' }), '*');
                          iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo' }), '*');
                        }
                      }}
                    />
                  )}
                </div>
              ) : (
                <StreamPlayer 
                  url={websiteUrl} 
                  isMuted={settings.isMuted} 
                  onEnded={isPreload ? undefined : nextSlide}
                />
              )
            ) : (
              <iframe 
                key={websiteKey}
                src={websiteUrl} 
                className="w-full h-full border-none"
                title={file.name}
                onError={() => !isPreload && setWebsiteError('Erro ao carregar site')}
              />
            )
          ) : (
            <div className="flex items-center justify-center h-full text-neutral-500">
              {websiteError || 'Carregando site...'}
            </div>
          )}
        </div>
      );
    } else {
      return (
        <img
          src={file.url}
          alt={file.name}
          className="w-full h-full"
          style={{ objectFit: getObjectFit() as any }}
          referrerPolicy="no-referrer"
        />
      );
    }
  };

  const getOrientationStyles = (): CSSProperties => {
    if (settings.orientation === 'vertical') {
      return {
        width: '100vh',
        height: '100vw',
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%) rotate(90deg)',
        transformOrigin: 'center center',
      };
    }
    return {
      width: '100%',
      height: '100%',
      position: 'relative',
    };
  };

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden cursor-none">
      {/* Silent Audio Unlocker */}
      <audio 
        ref={silentAudioRef}
        src="data:audio/wav;base64,UklGRigAAABXQVZFRm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=" 
        loop 
        style={{ display: 'none' }}
      />
      
      <div style={getOrientationStyles()}>
        {/* Render Next File behind current one to pre-warm it */}
        {nextIndex !== null && files[nextIndex] && (
          <div
            key={`next-${files[nextIndex].id}`}
            className="absolute inset-0 flex items-center justify-center bg-black z-0 opacity-0"
          >
            {renderFile(files[nextIndex], true)}
          </div>
        )}

        {currentFile && (
          <div
            key={currentFile.id}
            className="absolute inset-0 flex items-center justify-center bg-black z-10"
          >
            {renderFile(currentFile, false)}
          </div>
        )}
      </div>

      {/* Background Audio */}
      {audioFiles.length > 0 && isPlaying && (
        <audio
          ref={audioRef}
          src={audioFiles[currentAudioIndex]?.url}
          muted={settings.isMuted}
          onEnded={nextAudio}
          onError={(e) => {
            console.error('Audio error:', e);
            nextAudio();
          }}
        />
      )}

      {/* Pre-load and Cache next items */}
      {files.length > 1 && (
        <div className="hidden">
          {/* Pre-load next 3 items for better transition and offline support */}
          {[1, 2, 3].map(offset => {
            const nextIdx = (currentIndex + offset) % files.length;
            const file = files[nextIdx];
            if (!file) return null;
            
            // Background caching logic
            if ('caches' in window && file.url) {
              caches.open('media-cache').then(cache => {
                cache.add(file.url).catch(() => {});
              });
            }

            if (file.isVideo) {
              return <video key={`preload-${file.id}`} src={file.url} preload="auto" muted />;
            } else if (file.isWebsite && file.isStream) {
              // For streams, we can't easily pre-load without starting the player, 
              // but we can at least resolve the URL
              return null;
            } else {
              return <img key={`preload-${file.id}`} src={file.url} referrerPolicy="no-referrer" />;
            }
          })}
        </div>
      )}

      {/* Hidden controls for exit */}
      <div className="absolute top-0 right-0 w-20 h-20 group z-50">
        <button 
          onClick={() => setIsPlaying(false)}
          className="absolute top-4 right-4 p-2 bg-black/20 hover:bg-black/80 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X className="w-6 h-6" />
        </button>
      </div>
      
      <div className="absolute bottom-0 right-0 w-20 h-20 group z-50">
        <button 
          onClick={() => {
            if (document.fullscreenElement) {
              document.exitFullscreen();
            } else {
              document.documentElement.requestFullscreen();
            }
          }}
          className="absolute bottom-4 right-4 p-2 bg-black/20 hover:bg-black/80 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
        >
          {document.fullscreenElement ? <Minimize /> : <Maximize />}
        </button>
      </div>
    </div>
  );
}
