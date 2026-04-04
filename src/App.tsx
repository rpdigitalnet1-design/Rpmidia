import { useState, useEffect, useRef, useCallback, CSSProperties } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Settings, X, Maximize, Minimize, Loader2 } from 'lucide-react';
import { DriveFile, AppSettings, DisplayMode } from './types';

export default function App() {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
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
      isMuted: true,
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

  const [isBuffering, setIsBuffering] = useState(false);

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
        setFiles(data);
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
    setCurrentIndex(prev => (prev + 1) % files.length);
  }, [files.length]);

  // Reset index if out of bounds after sync
  useEffect(() => {
    if (files.length > 0 && currentIndex >= files.length) {
      setCurrentIndex(0);
    }
  }, [files.length, currentIndex]);

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
      timerRef.current = setTimeout(nextSlide, settings.websiteDuration);
    } else {
      // Image handling
      timerRef.current = setTimeout(nextSlide, settings.slideDuration);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPlaying, currentIndex, files, settings.slideDuration, nextSlide]);

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

  useEffect(() => {
    if (!isPlaying || !currentFile || !currentFile.isWebsite || settings.websiteRefreshInterval <= 0) return;

    const interval = setInterval(() => {
      setWebsiteKey(prev => prev + 1);
    }, settings.websiteRefreshInterval);

    return () => clearInterval(interval);
  }, [isPlaying, currentFile, settings.websiteRefreshInterval]);

  useEffect(() => {
    if (!isPlaying || !currentFile || !currentFile.isWebsite) {
      setWebsiteUrl(null);
      return;
    }

    const fetchWebsiteUrl = async () => {
      try {
        const response = await fetch(currentFile.url);
        const data = await response.json();
        if (data.url) {
          setWebsiteUrl(data.url);
        }
      } catch (err) {
        console.error('Error fetching website URL:', err);
      }
    };

    fetchWebsiteUrl();
  }, [isPlaying, currentFile]);

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
              <Play className="fill-current" /> INICIAR PLAYER
            </button>
            <button 
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-white px-8 py-4 rounded-full text-xl font-bold transition-all"
            >
              <Settings /> CONFIGS
            </button>
            {isFetching && <Loader2 className="w-6 h-6 animate-spin text-blue-500" />}
          </div>

          {files.length === 0 && settings.driveFolderId && (
            <button 
              onClick={() => { setIsLoading(true); fetchFiles(); }}
              className="mt-6 text-blue-400 hover:text-blue-300 text-sm underline"
            >
              Tentar novamente agora
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
                    <label className="block text-xs text-neutral-400 mb-1">Som do Vídeo</label>
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
    <div className="relative w-screen h-screen bg-black overflow-hidden cursor-none">
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
                    onWaiting={() => setIsBuffering(true)}
                    onPlaying={() => setIsBuffering(false)}
                    onLoadedData={() => {
                      setIsBuffering(false);
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
                  {isBuffering && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <Loader2 className="w-12 h-12 animate-spin text-white" />
                    </div>
                  )}
                </div>
              ) : currentFile.isWebsite ? (
                <div className="w-full h-full bg-white">
                  {websiteUrl ? (
                    <iframe 
                      key={websiteKey}
                      src={websiteUrl} 
                      className="w-full h-full border-none"
                      title={currentFile.name}
                      allow="autoplay; fullscreen"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-black">
                      <Loader2 className="w-8 h-8 animate-spin" />
                    </div>
                  )}
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
