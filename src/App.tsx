import { useState, useEffect, useRef, useCallback, CSSProperties } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Settings, X, Maximize, Minimize, Loader2, Volume2, VolumeX } from 'lucide-react';
import { DriveFile, AppSettings, DisplayMode } from './types';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';

const StreamPlayer = ({ url, isMuted }: { url: string; isMuted: boolean }) => {
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
        enableStashBuffer: false,
        stashInitialSize: 128,
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
  const [currentAudioIndex, setCurrentAudioIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('app_settings');
    const defaultSettings: AppSettings = {
      displayMode: 'fill',
      orientation: 'horizontal',
      slideDuration: 5000,
      websiteDuration: 30000,
      autoStart: false,
      driveFolderId: '',
      isMuted: false,
      syncInterval: 30000,
      websiteRefreshInterval: 0,
      appRefreshInterval: 0
    };
    
    if (saved) {
      const parsed = JSON.parse(saved);
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

  const extractFolderId = (input: string) => {
    if (!input) return '';
    const trimmed = input.trim();
    
    // If it's a URL, let's keep it as is so the server can resolve it (bit.ly, etc)
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
    setCurrentIndex(prev => (prev + 1) % files.length);
  }, [files.length]);

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
    if (!isPlaying || files.length === 0) return;

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
  }, [isPlaying, currentIndex, files, settings.slideDuration, settings.websiteDuration, nextSlide]);

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

    const interval = setInterval(() => {
      window.location.reload();
    }, settings.appRefreshInterval);

    return () => clearInterval(interval);
  }, [isPlaying, settings.appRefreshInterval]);

  const [websiteUrl, setWebsiteUrl] = useState<string | null>(null);
  const [websiteKey, setWebsiteKey] = useState(0);
  const [websiteError, setWebsiteError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
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
          // Use settings.isMuted directly in URL, but also handle via API
          // Removing origin to see if it improves autoplay reliability in preview
          finalUrl = `https://www.youtube.com/embed/${ytId}?autoplay=1&mute=${settings.isMuted ? 1 : 0}&controls=0&loop=1&playlist=${ytId}&rel=0&modestbranding=1&playsinline=1&enablejsapi=1`;
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
    if (!isPlaying || !currentFile || !currentFile.isWebsite || settings.websiteRefreshInterval < 5000 || currentFile.isStream) return;

    const interval = setInterval(() => {
      // Re-fetch the URL from the server silently
      fetchWebsiteUrl(true);
      // Also increment key to force iframe reload
      setWebsiteKey(prev => prev + 1);
    }, settings.websiteRefreshInterval);

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
          setWebsiteUrl(`https://www.youtube.com/embed/${ytId}?autoplay=1&mute=${settings.isMuted ? 1 : 0}&controls=0&loop=1&playlist=${ytId}&rel=0&modestbranding=1&playsinline=1&enablejsapi=1`);
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

              // Try multiple times
              forceUnmute();
              [500, 1000, 2000, 4000].forEach(delay => setTimeout(forceUnmute, delay));
            },
            'onStateChange': (event: any) => {
              if (event.data === (window as any).YT.PlayerState.PLAYING) {
                if (!settingsRef.current.isMuted) {
                  event.target.unMute();
                  event.target.setVolume(100);
                }
              }
              if (event.data === (window as any).YT.PlayerState.ENDED) {
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
    const handleGlobalClick = () => {
      if (ytPlayerRef.current && ytPlayerRef.current.unMute && !settingsRef.current.isMuted) {
        try {
          console.log('Global click detected, attempting to unmute YouTube...');
          ytPlayerRef.current.unMute();
          ytPlayerRef.current.setVolume(100);
          ytPlayerRef.current.playVideo();
        } catch (e) {}
      }
    };
    window.addEventListener('click', handleGlobalClick);
    window.addEventListener('touchstart', handleGlobalClick);
    return () => {
      window.removeEventListener('click', handleGlobalClick);
      window.removeEventListener('touchstart', handleGlobalClick);
    };
  }, []);

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
      <div className="flex items-center justify-center min-h-screen w-full overflow-x-hidden bg-black text-white">
        <Loader2 className="w-12 h-12 animate-spin text-blue-500" />
        <span className="ml-4 text-xl font-medium">Sincronizando com Google Drive...</span>
      </div>
    );
  }

  if (!isPlaying) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen w-full overflow-x-hidden bg-gradient-to-br from-neutral-900 via-neutral-950 to-black text-white p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-2xl w-full flex flex-col items-center relative"
        >
          <div className="mb-10 relative">
            <div className="absolute -inset-6 bg-blue-500/20 blur-3xl rounded-full"></div>
            <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-blue-600 relative z-10">
              RP Midia Indoor
            </h1>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center w-full max-w-md relative">
            <button 
              onClick={startPlayer}
              disabled={files.length === 0}
              className={`flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-lg font-semibold transition-all transform shadow-lg w-full sm:w-auto ${
                files.length > 0 
                ? "bg-blue-600 hover:bg-blue-500 text-white hover:-translate-y-1 active:translate-y-0 shadow-blue-900/30" 
                : "bg-neutral-800 text-neutral-500 cursor-not-allowed border border-neutral-700"
              }`}
            >
              <Play className="w-5 h-5 fill-current" /> 
              INICIAR
            </button>
            <button 
              onClick={() => setShowSettings(true)}
              className="flex items-center justify-center gap-2 bg-neutral-800/80 backdrop-blur-md hover:bg-neutral-700 border border-neutral-700/50 text-white px-6 py-3 rounded-2xl text-lg font-semibold transition-all w-full sm:w-auto hover:-translate-y-1 active:translate-y-0"
            >
              <Settings className="w-5 h-5" /> CONFIGS
            </button>
            {isFetching && (
              <div className="absolute -right-12 sm:-right-16 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              </div>
            )}
          </div>

          {files.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mt-8 flex items-center gap-3 text-sm text-neutral-300 bg-neutral-800/40 backdrop-blur-sm px-5 py-2.5 rounded-full border border-neutral-700/50 shadow-lg"
            >
              <div className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
              </div>
              <span>
                <strong className="text-white">{files.length}</strong> {files.length === 1 ? 'arquivo sincronizado' : 'arquivos sincronizados'} e pronto para exibição
              </span>
            </motion.div>
          )}

          {files.length === 0 && settings.driveFolderId && (
            <button 
              onClick={() => { setIsLoading(true); fetchFiles(); }}
              className="mt-8 text-neutral-400 hover:text-blue-400 text-sm transition-colors"
            >
              Nenhum arquivo encontrado. <span className="underline">Tentar novamente</span>
            </button>
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
    <div className="relative w-full h-screen bg-black overflow-hidden cursor-none">
      {/* Sound Indicator/Toggle */}
      <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
        <button 
          onClick={() => {
            const newSettings = { ...settings, isMuted: !settings.isMuted };
            setSettings(newSettings);
            localStorage.setItem('app_settings', JSON.stringify(newSettings));
          }}
          className={`p-3 rounded-full backdrop-blur-md transition-all ${
            settings.isMuted ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-black/40 text-white/60 hover:text-white border border-white/10'
          }`}
          title={settings.isMuted ? "Ativar Som" : "Mutar"}
        >
          {settings.isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
        </button>
      </div>

      <div style={getOrientationStyles()}>
        <AnimatePresence mode="wait">
          {currentFile && (
            <motion.div
              key={currentFile.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              {currentFile.isVideo ? (
                <div className="relative w-full h-full">
                  <video
                    ref={videoRef}
                    src={currentFile.url}
                    autoPlay
                    muted={settings.isMuted}
                    playsInline
                    onEnded={nextSlide}
                    onLoadedData={() => {
                      if (videoRef.current) {
                        videoRef.current.play().catch(err => {
                          console.log("Autoplay blocked, user interaction needed", err);
                        });
                      }
                    }}
                    onError={(e) => {
                      console.error('Video error:', e);
                      setTimeout(nextSlide, 2000);
                    }}
                    className="w-full h-full"
                    style={{ objectFit: getObjectFit() as any }}
                  />
                </div>
              ) : currentFile.isWebsite ? (
                <div className="w-full h-full bg-white relative">
                  {websiteUrl ? (
                    currentFile.isStream ? (
                      currentFile.isYouTube ? (
                        <div className="w-full h-full relative">
                          <iframe 
                            id="youtube-player"
                            key={websiteKey}
                            src={websiteUrl} 
                            className="w-full h-full border-none"
                            title={currentFile.name}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                          />
                          {/* Fallback Unmute Overlay - only shows if muted but settings say otherwise */}
                          {!settings.isMuted && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (ytPlayerRef.current) {
                                    ytPlayerRef.current.unMute();
                                    ytPlayerRef.current.setVolume(100);
                                    ytPlayerRef.current.playVideo();
                                  }
                                }}
                                className="pointer-events-auto bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-full text-lg font-bold shadow-2xl shadow-blue-500/50 animate-bounce flex items-center gap-3"
                              >
                                <Volume2 className="w-8 h-8" />
                                CLIQUE AQUI PARA ATIVAR O SOM
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <StreamPlayer url={websiteUrl} isMuted={settings.isMuted} />
                      )
                    ) : (
                      <iframe 
                        key={websiteKey}
                        src={websiteUrl} 
                        className="w-full h-full border-none"
                        title={currentFile.name}
                        allow="autoplay; fullscreen"
                        referrerPolicy="no-referrer"
                      />
                    )
                  ) : websiteError ? (
                    <div className="flex flex-col items-center justify-center h-full text-neutral-500 p-8 text-center gap-4">
                      <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center">
                        <X className="w-8 h-8 text-red-500" />
                      </div>
                      <div>
                        <p className="text-lg font-bold text-neutral-800">Erro ao carregar</p>
                        <p className="text-sm text-neutral-500 mt-1">{websiteError}</p>
                      </div>
                      <button 
                        onClick={() => fetchWebsiteUrl()}
                        className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 rounded-lg text-sm font-medium transition-colors"
                      >
                        Tentar novamente
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <img
                  src={currentFile.url}
                  alt={currentFile.name}
                  className="w-full h-full pointer-events-none select-none"
                  style={{ objectFit: getObjectFit() as any }}
                  referrerPolicy="no-referrer"
                />
              )}

              {/* Overlay for file name (optional, can be hidden) */}
              <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-md px-4 py-2 rounded-lg text-white text-sm font-medium opacity-0 hover:opacity-100 transition-opacity">
                {currentFile.name}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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

      {/* Pre-load next item */}
      {files.length > 1 && (
        <div className="hidden">
          {files[(currentIndex + 1) % files.length].isVideo ? (
            <video src={files[(currentIndex + 1) % files.length].url} preload="auto" />
          ) : (
            <img src={files[(currentIndex + 1) % files.length].url} referrerPolicy="no-referrer" />
          )}
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
