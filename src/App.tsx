import { useState, useEffect, useRef, useCallback, CSSProperties, Fragment, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Settings, X, Maximize, Minimize, Loader2, Volume2, VolumeX, Key, Shield, Lock, RefreshCw, Trash2, Edit2, Activity, Plus, Terminal, User, ArrowRightLeft, ArrowUpDown, Palette, Zap, Clock } from 'lucide-react';
import { DriveFile, AppSettings, DisplayMode, LicenseLog, QueueCall } from './types';
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

const ClockDisplay = () => {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>;
};

export default function App() {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [audioFiles, setAudioFiles] = useState<DriveFile[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentAudioIndex, setCurrentAudioIndex] = useState(0);
  const [autoStartCountdown, setAutoStartCountdown] = useState(120);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [activationInput, setActivationInput] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [editingLicense, setEditingLicense] = useState<LicenseLog | null>(null);
  const [licenses, setLicenses] = useState<LicenseLog[]>([]);
  const [isActivated, setIsActivated] = useState(() => localStorage.getItem('app_activated') === 'true');
  const [showStatusCheck, setShowStatusCheck] = useState(false);
  const [statusCheckCode, setStatusCheckCode] = useState('');
  const [statusCheckCodes, setStatusCheckCodes] = useState<string[]>(() => {
    const saved = localStorage.getItem('status_check_codes');
    return saved ? JSON.parse(saved) : [];
  });
  const [statusCheckResults, setStatusCheckResults] = useState<Record<string, any>>({});
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [showClientPanel, setShowClientPanel] = useState(false);
  const [clientPanelCode, setClientPanelCode] = useState('');
  const [clientPanelData, setClientPanelData] = useState<{ clientName: string; settings: AppSettings } | null>(null);
  const [isClientLoggedIn, setIsClientLoggedIn] = useState(false);
  const [clientPanelTab, setClientPanelTab] = useState<'settings' | 'media' | 'queue'>('settings');
  const [clientFiles, setClientFiles] = useState<DriveFile[]>([]);
  const [clientFilesError, setClientFilesError] = useState<string | null>(null);
  const [isFetchingClientFiles, setIsFetchingClientFiles] = useState(false);
  const [isSavingClientSettings, setIsSavingClientSettings] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [queueInput, setQueueInput] = useState({ ticket: '', name: '', counter: 'Guichê 1' });
  const [lastCalledId, setLastCalledId] = useState<string | null>(null);
  const callSoundRef = useRef<HTMLAudioElement | null>(null);

  const [deviceId] = useState(() => {
    let id = localStorage.getItem('app_device_id');
    if (!id) {
      id = Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
      localStorage.setItem('app_device_id', id);
    }
    return id;
  });
  
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('app_settings');
    const defaultSettings: AppSettings = {
      displayMode: 'fill',
      orientation: 'horizontal',
      slideDuration: 5000,
      websiteDuration: 30000,
      autoStart: true,
      driveFolderId: '',
      isMuted: false,
      syncInterval: 30000,
      websiteRefreshInterval: 0,
      appRefreshInterval: 0,
      tickerMessage: '',
      tickerEnabled: false,
      tickerSpeed: 30,
      tickerColor: '#ffffff',
      tickerDirection: 'horizontal',
      tickerLogoUrl: '',
      tickerAdImages: [],
      footerEnabled: false,
      disabledMediaIds: [],
      
      queueEnabled: false,
      queueTitle: 'CHAMADA',
      queueVoiceEnabled: true,
      queueShowHistory: true,
      queueThemeColor: '#004a8e',
      queueHistory: [],
      queueMode: 'both',
      queueClientLabel: 'CLIENTE',

      gcEnabled: false,
      gcTitle: 'URGENTE: INFORMAÇÕES DO SISTEMA',
      gcSubtitle: 'Acompanhe as principais notícias e atualizações aqui.',
      gcCategory: 'AO VIVO',
      gcCategoryColor: '#c62828',
      gcLogoUrl: '',
      remoteCommand: null,
      remoteCommandId: ''
    };
    
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...defaultSettings, ...parsed };
    }
    return defaultSettings;
  });

  useEffect(() => {
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    audio.load();
    callSoundRef.current = audio;
  }, []);

  useEffect(() => {
    if (!settings.queueEnabled || !settings.queueCurrent) return;
    
    if (settings.queueCurrent.id !== lastCalledId) {
      setLastCalledId(settings.queueCurrent.id);
      
      if (callSoundRef.current) {
        callSoundRef.current.play().catch(e => console.warn("Sound play error:", e));
      }
      
      if (settings.queueVoiceEnabled && 'speechSynthesis' in window) {
        const { ticket, name, counter } = settings.queueCurrent;
        let text = "";
        if (ticket) text += `Senha ${ticket.split('').join(' ')}. `;
        if (name) text += `Cliente ${name}. `;
        if (counter) text += `Compareça ao ${counter}.`;
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'pt-BR';
        utterance.rate = 0.9;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      }
    }
  }, [settings.queueCurrent, settings.queueEnabled, settings.queueVoiceEnabled, lastCalledId]);

  const filteredFiles = useMemo(() => 
    files.filter(f => !settings.disabledMediaIds?.includes(f.id)),
  [files, settings.disabledMediaIds]
);

  const filteredFilesRef = useRef(filteredFiles);
  useEffect(() => {
    filteredFilesRef.current = filteredFiles;
  }, [filteredFiles]);

  useEffect(() => {
    const verifyActivation = async () => {
      if (isActivated && settings.licenseCode) {
        try {
          const response = await fetch('/api/activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: settings.licenseCode, deviceId, isPlaying: false })
          });
          if (!response.ok) {
            localStorage.removeItem('app_activated');
            setIsActivated(false);
          }
        } catch (e) {
          // If offline, keep activated status
        }
      }
    };
    verifyActivation();
  }, [isActivated, settings.licenseCode, deviceId]);

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

  const fetchLicenses = useCallback(async () => {
    if (!isAdminAuthenticated) return;
    try {
      const response = await fetch('/api/admin/licenses');
      if (response.ok) {
        const data = await response.json();
        setLicenses(data);
      }
    } catch (e) {
      console.error('Failed to fetch licenses');
    }
  }, [isAdminAuthenticated]);

  useEffect(() => {
    if (showAdminPanel && isAdminAuthenticated) {
      fetchLicenses();
      const interval = setInterval(fetchLicenses, 5000);
      return () => clearInterval(interval);
    }
  }, [showAdminPanel, isAdminAuthenticated, fetchLicenses]);

  const handleActivate = async () => {
    if (!activationInput) return;
    try {
      const response = await fetch('/api/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: activationInput, deviceId, isPlaying: false })
      });
      if (response.ok) {
        const data = await response.json();
        const newSettings = { ...settings, licenseCode: activationInput, clientName: data.clientName };
        setSettings(newSettings);
        localStorage.setItem('app_settings', JSON.stringify(newSettings));
        localStorage.setItem('app_activated', 'true');
        setIsActivated(true);
        setActivationInput('');
        alert(`Sistema ativado com sucesso para ${data.clientName}!`);
      } else {
        const data = await response.json();
        alert(data.error || 'Código de ativação inválido ou não encontrado.');
      }
    } catch (e) {
      alert('Erro ao conectar com o serviço de ativação.');
    }
  };

  const deleteLicense = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir esta licença? O dispositivo vinculado perderá o acesso.')) return;
    try {
      const response = await fetch(`/api/admin/licenses/${id}`, { method: 'DELETE' });
      if (response.ok) fetchLicenses();
    } catch (e) {}
  };

  const updateLicense = async (id: string, name: string, reset: boolean, code?: string) => {
    try {
      const response = await fetch(`/api/admin/licenses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName: name, code, resetActivation: reset })
      });
      if (response.ok) {
        setEditingLicense(null);
        fetchLicenses();
      }
    } catch (e) {}
  };

  const handleStatusCheck = useCallback(async (silent = false) => {
    if (statusCheckCodes.length === 0) return;
    if (!silent) setIsCheckingStatus(true);
    
    await Promise.all(statusCheckCodes.map(async (code) => {
      try {
        const response = await fetch(`/api/status/${code.trim().toUpperCase()}`);
        if (response.ok) {
          const data = await response.json();
          setStatusCheckResults(prev => ({ ...prev, [code]: data }));
        } else {
          setStatusCheckResults(prev => ({ ...prev, [code]: { error: 'Código inválido' } }));
        }
      } catch (e) {
        setStatusCheckResults(prev => ({ ...prev, [code]: { error: 'Erro de conexão' } }));
      }
    }));
    
    if (!silent) setIsCheckingStatus(false);
  }, [statusCheckCodes]);

  const addStatusCheckCode = (codesString?: string) => {
    const input = codesString || statusCheckCode;
    if (!input) return;
    
    // Support multiple codes separated by commas or spaces
    const codes = input.split(/[\s,]+/).map(c => c.trim().toUpperCase()).filter(c => c.length > 0);
    
    const newCodes = [...statusCheckCodes];
    let added = false;
    
    codes.forEach(code => {
      if (!newCodes.includes(code)) {
        newCodes.push(code);
        added = true;
      }
    });

    if (added) {
      setStatusCheckCodes(newCodes);
      localStorage.setItem('status_check_codes', JSON.stringify(newCodes));
      setStatusCheckCode('');
    }
  };

  const removeStatusCheckCode = (code: string) => {
    const newCodes = statusCheckCodes.filter(c => c !== code);
    setStatusCheckCodes(newCodes);
    localStorage.setItem('status_check_codes', JSON.stringify(newCodes));
    setStatusCheckResults(prev => {
      const next = { ...prev };
      delete next[code];
      return next;
    });
  };

  const clearAllStatusCheckCodes = () => {
    if (confirm('Deseja remover todos os códigos da lista de monitoramento?')) {
      setStatusCheckCodes([]);
      localStorage.setItem('status_check_codes', JSON.stringify([]));
      setStatusCheckResults({});
    }
  };

  useEffect(() => {
    if (showStatusCheck && statusCheckCodes.length > 0) {
      handleStatusCheck(true);
      const interval = setInterval(() => {
        handleStatusCheck(true);
      }, 3000); 
      return () => clearInterval(interval);
    }
  }, [showStatusCheck, statusCheckCodes, handleStatusCheck]);

  const resetApp = () => {
    if (confirm('ATENÇÃO: Isso removerá a ativação e todas as configurações do aplicativo. Deseja continuar?')) {
      localStorage.removeItem('app_activated');
      localStorage.removeItem('app_settings');
      setIsActivated(false);
      window.location.reload();
    }
  };

  const generateNewLicense = async () => {
    if (!newClientName) {
      alert('Favor informar o nome do cliente');
      return;
    }
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    try {
      const response = await fetch('/api/admin/licenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, clientName: newClientName })
      });
      if (response.ok) {
        setNewClientName('');
        fetchLicenses();
        alert(`Código ${code} gerado para ${newClientName}`);
      }
    } catch (e) {
      alert('Erro ao gerar código');
    }
  };

  const handleAdminLogin = () => {
    if (adminPassword === '565313') {
      setIsAdminAuthenticated(true);
      setAdminPassword('');
    } else {
      alert('Senha administrativa incorreta!');
    }
  };

  const handleClientLogin = async () => {
    if (!clientPanelCode) return;
    try {
      const resp = await fetch('/api/client/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: clientPanelCode })
      });
      if (resp.ok) {
        const data = await resp.json();
        // Ensure settings are properly merged with defaults if needed
        const defaultSettings = {
          displayMode: 'fill',
          orientation: 'horizontal',
          slideDuration: 5000,
          websiteDuration: 30000,
          autoStart: false,
          driveFolderId: '',
          isMuted: false,
          syncInterval: 30000,
          websiteRefreshInterval: 0,
          appRefreshInterval: 0,
          queueEnabled: false,
          queueTitle: 'CHAMADA',
          queueVoiceEnabled: true,
          queueShowHistory: true,
          queueThemeColor: '#004a8e',
          queueHistory: [],
          queueMode: 'both'
        };
        data.settings = { ...defaultSettings, ...data.settings };
        setClientPanelData(data);
        setIsClientLoggedIn(true);
      } else {
        const data = await resp.json();
        alert(data.error || 'Código inválido ou não encontrado.');
      }
    } catch (e) {
      alert('Erro ao conectar com o servidor.');
    }
  };

  const handleSaveClientSettings = async (newSettings: AppSettings) => {
    setIsSavingClientSettings(true);
    try {
      const resp = await fetch('/api/client/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: clientPanelCode, settings: newSettings })
      });
      if (resp.ok) {
        setClientPanelData(prev => prev ? { ...prev, settings: newSettings } : null);
        alert('Configurações salvas com sucesso! O dispositivo será atualizado automaticamente.');
      } else {
        alert('Erro ao salvar configurações.');
      }
    } catch (e) {
      alert('Erro de conexão ao salvar.');
    } finally {
      setIsSavingClientSettings(false);
    }
  };

  const fetchClientFiles = useCallback(async () => {
    if (!clientPanelData?.settings?.driveFolderId) return;
    try {
      setIsFetchingClientFiles(true);
      setClientFilesError(null);
      const folderId = clientPanelData.settings.driveFolderId?.trim();
      if (!folderId) {
        setClientFiles([]);
        return;
      }
      const url = `/api/files?folderId=${encodeURIComponent(folderId)}`;
      const response = await fetch(url);
      const data = await response.json();
      if (response.ok && Array.isArray(data)) {
        setClientFiles(data.filter(f => f && !f.isAudio));
      } else {
        setClientFilesError(data.error || 'Erro ao carregar arquivos');
      }
    } catch (e) {
      setClientFilesError('Erro de conexão ao buscar arquivos');
      console.error('Failed to fetch client files:', e);
    } finally {
      setIsFetchingClientFiles(false);
    }
  }, [clientPanelData?.settings?.driveFolderId]);

  useEffect(() => {
    if (isClientLoggedIn && clientPanelTab === 'media') {
      fetchClientFiles();
    }
  }, [isClientLoggedIn, clientPanelTab, fetchClientFiles]);

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
    const len = filteredFilesRef.current.length;
    if (len === 0) return;
    setCurrentIndex(prev => (prev + 1) % len);
  }, []); // Constant reference

  const nextAudio = useCallback(() => {
    if (audioFiles.length === 0) return;
    setCurrentAudioIndex(prev => (prev + 1) % audioFiles.length);
  }, [audioFiles.length]);

  // Reset index if out of bounds after sync
  useEffect(() => {
    if (filteredFiles.length > 0 && currentIndex >= filteredFiles.length) {
      setCurrentIndex(0);
    }
  }, [filteredFiles.length, currentIndex]);

  useEffect(() => {
    if (audioFiles.length > 0 && currentAudioIndex >= audioFiles.length) {
      setCurrentAudioIndex(0);
    }
  }, [audioFiles.length, currentAudioIndex]);

  useEffect(() => {
    if (!isPlaying || filteredFiles.length === 0) return;

    const currentFile = filteredFiles[currentIndex];
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
  }, [
    isPlaying, 
    currentIndex, 
    filteredFiles[currentIndex]?.id, 
    filteredFiles[currentIndex]?.isVideo, 
    filteredFiles[currentIndex]?.isWebsite, 
    filteredFiles[currentIndex]?.isStream,
    settings.slideDuration, 
    settings.websiteDuration, 
    nextSlide
  ]);

  // Check if current stream file still exists in Drive
  useEffect(() => {
    if (!isPlaying || filteredFiles.length === 0) return;
    const currentFile = filteredFiles[currentIndex];
    if (!currentFile || !currentFile.isStream) return;

    // Check if current file ID is still in the files list
    const fileExists = filteredFiles.some(f => f.id === currentFile.id);
    if (!fileExists) {
      console.log('Stream file deleted from Drive, moving to next slide');
      nextSlide();
    }
  }, [currentIndex, isPlaying, nextSlide]); // Removed filteredFiles from deps to avoid resetting on every sync

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
    
    const currentFile = filteredFiles[currentIndex];
    // Pause background music if a video or YouTube is playing
    const shouldPause = currentFile && (currentFile.isVideo || currentFile.isYouTube);
    
    if (shouldPause || !isPlaying) {
      audioRef.current.pause();
    } else if (isPlaying && audioFiles.length > 0) {
      audioRef.current.play().catch(err => console.warn('Audio play blocked:', err));
    }
  }, [isPlaying, currentIndex, files, audioFiles.length]);

  const startPlayer = () => {
    if (!isActivated) {
      alert('Sistema não ativado. Por favor, insira o código de ativação.');
      return;
    }
    setIsPlaying(true);
    // Request full screen
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    }
  };

  const stopPlayer = async () => {
    setIsPlaying(false);
    // Send immediate heartbeat to update status to STANDBY immediately
    if (isActivated && settings.licenseCode) {
      try {
        await fetch('/api/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: settings.licenseCode, deviceId, isPlaying: false })
        });
      } catch (e) {}
    }
  };

  // Use a ref for settings to avoid effect loops from heartbeat updates
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Heartbeat to keep admin informed of online status
  useEffect(() => {
    if (!isActivated || !settings.licenseCode) return;

    const sendHeartbeat = async () => {
      const localS = settingsRef.current;
      setIsSyncing(true);
      try {
        const response = await fetch('/api/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: localS.licenseCode, deviceId, isPlaying })
        });
        
        if (response.ok) {
          const resData = await response.json();
          if (resData.settings) {
            const serverSettings = resData.settings;
            // Only update if there are differences to avoid unnecessary re-renders
            const varsToCompare = [
              'driveFolderId', 'slideDuration', 'websiteDuration', 'orientation', 
              'displayMode', 'isMuted', 'autoStart', 'websiteRefreshInterval', 
              'syncInterval', 'appRefreshInterval', 'tickerMessage', 'tickerEnabled',
              'tickerSpeed', 'tickerColor', 'tickerDirection', 'tickerLogoUrl', 'tickerAdImages', 'footerEnabled', 'disabledMediaIds',
              'queueEnabled', 'queueTitle', 'queueVoiceEnabled', 'queueShowHistory', 'queueThemeColor', 
              'queueHistory', 'queueCurrent', 'queueMode', 'queueClientLabel',
              'gcEnabled', 'gcTitle', 'gcSubtitle', 'gcCategory', 'gcCategoryColor', 'gcLogoUrl',
              'remoteCommandId'
            ];
            
            const hasChanges = varsToCompare.some(key => {
              const localVal = (localS as any)[key];
              const serverVal = (serverSettings as any)[key];
              
              // Normalize null/undefined/empty arrays for comparison
              if (!localVal && !serverVal) return false;
              if (Array.isArray(localVal) && Array.isArray(serverVal)) {
                if (localVal.length === 0 && serverVal.length === 0) return false;
              }
              
              return JSON.stringify(localVal) !== JSON.stringify(serverVal);
            });

            if (hasChanges) {
              const updated = { 
                ...localS, 
                ...serverSettings,
                // Ensure critical fields are NOT overwritten if server returns incomplete object
                licenseCode: localS.licenseCode,
                clientName: localS.clientName || serverSettings.clientName
              };
              setSettings(updated);
              localStorage.setItem('app_settings', JSON.stringify(updated));
              
              if (serverSettings.remoteCommandId && serverSettings.remoteCommandId !== localS.remoteCommandId) {
                if (serverSettings.remoteCommand === 'start') {
                  startPlayer();
                } else if (serverSettings.remoteCommand === 'stop') {
                  stopPlayer();
                } else if (serverSettings.remoteCommand === 'restart') {
                  window.location.reload();
                }
              }

              if (serverSettings.driveFolderId && serverSettings.driveFolderId !== localS.driveFolderId) {
                // Only trigger file fetch, avoid showing flickering white screen if possible
                fetchFiles();
              }
            }
          }
        }

        if (response.status === 401 || response.status === 404) {
          // Double check if code actually exists before deactivating to prevent race condition glitches
          // We use localS (stable snap from ref)
          if (localS.licenseCode) {
             console.warn('Heartbeat returned unauthorized/not found. Deactivating.');
             localStorage.removeItem('app_activated');
             setIsActivated(false);
          }
        }
      } catch (e) {
        console.error("Heartbeat error:", e);
      } finally {
        setTimeout(() => setIsSyncing(false), 2000);
      }
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 5000); // Every 5 seconds
    return () => clearInterval(interval);
  }, [isPlaying, isActivated, deviceId, fetchFiles]);
  // Note: Removed settings from dependencies to prevent infinite loops. 
  // Syncing to server is handled manually on Save or periodically via this heartbeat fetch.

  const currentFile = filteredFiles[currentIndex];

  useEffect(() => {
    if (isPlaying || files.length === 0 || !isActivated) {
      setAutoStartCountdown(120);
      return;
    }

    const interval = setInterval(() => {
      setAutoStartCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          startPlayer();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying, files.length, isActivated]);

  useEffect(() => {
    if (!isPlaying || settings.appRefreshInterval <= 0) return;

    // Use a ref to track the last known refresh timestamp to only reload if it gets UPDATED (increases)
    // Actually, settings is already updated via heartbeat.
    // If the value in localStorage is different from the newly received value, we reload.
    // But since settings state is updated, we can just check if it changed since mount.
  }, [isPlaying, settings.appRefreshInterval]);

  const lastAppRefreshRef = useRef(settings.appRefreshInterval);
  useEffect(() => {
    if (settings.appRefreshInterval > lastAppRefreshRef.current) {
      window.location.reload();
    }
    lastAppRefreshRef.current = settings.appRefreshInterval;
  }, [settings.appRefreshInterval]);

  const [websiteUrl, setWebsiteUrl] = useState<string | null>(null);
  const [websiteKey, setWebsiteKey] = useState(0);
  const [websiteError, setWebsiteError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const ytPlayerRef = useRef<any>(null);

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
      <div 
        onClick={() => {
          if (isActivated && files.length > 0) {
            startPlayer();
          }
        }}
        className="flex flex-col items-center justify-center min-h-screen w-full overflow-x-hidden bg-gradient-to-br from-neutral-900 via-neutral-950 to-black text-white p-6 cursor-pointer group"
      >
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-2xl w-full flex flex-col items-center relative"
        >
          {isActivated && files.length > 0 && (
            <div className="absolute top-0 left-0 w-full h-full z-0 opacity-0 bg-white/5 pointer-events-none group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-3xl border border-white/5">
              <span className="text-white/20 font-black text-6xl uppercase tracking-[0.5em] rotate-12">CLIQUE PARA INICIAR</span>
            </div>
          )}
          <div className="mb-10 relative">
            <div className="absolute -inset-6 bg-blue-500/20 blur-3xl rounded-full"></div>
            <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-blue-600 relative z-10">
              RP Midia Indoor
            </h1>
          </div>
          
          {!isActivated ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-neutral-800/50 backdrop-blur-xl p-8 rounded-3xl border border-white/10 shadow-2xl w-full max-w-md"
            >
              <div className="flex justify-center mb-6">
                <div className="w-16 h-16 bg-blue-600/20 rounded-full flex items-center justify-center border border-blue-500/30">
                  <Lock className="w-8 h-8 text-blue-500" />
                </div>
              </div>
              <h2 className="text-2xl font-bold mb-2">Ativação Necessária</h2>
              <p className="text-neutral-400 text-sm mb-6">Insira o código de ativação fornecido pelo administrador para liberar o sistema.</p>
              
            <div className="space-y-4">
              <input 
                type="text"
                placeholder="Seu código aqui..."
                value={activationInput}
                onChange={(e) => setActivationInput(e.target.value.toUpperCase())}
                className="w-full bg-neutral-900 border border-neutral-700 p-4 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 text-center font-mono text-xl tracking-widest placeholder:text-neutral-700 placeholder:tracking-normal placeholder:font-sans placeholder:text-base"
              />
              <button 
                onClick={handleActivate}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white py-4 rounded-2xl font-bold text-lg transition-all shadow-lg active:scale-95"
              >
                ATIVAR SISTEMA
              </button>
              
              <button 
                onClick={() => setShowStatusCheck(true)}
                className="w-full bg-neutral-800 hover:bg-neutral-700 text-white py-3 rounded-2xl font-bold text-sm transition-all border border-neutral-700 hover:border-blue-500/30 flex items-center justify-center gap-2"
              >
                <Shield className="w-4 h-4" /> CONSULTAR MEU STATUS
              </button>

              <button 
                onClick={() => setShowClientPanel(true)}
                className="w-full bg-blue-900/20 hover:bg-blue-900/40 text-blue-400 py-3 rounded-2xl font-bold text-sm transition-all border border-blue-500/20 flex items-center justify-center gap-2"
              >
                <User className="w-4 h-4" /> MEU PAINEL DE CONTROLE
              </button>
            </div>
              
              <button 
                onClick={() => setShowSettings(true)}
                className="mt-6 flex items-center gap-2 text-neutral-500 hover:text-white mx-auto text-sm transition-colors"
              >
                <Settings className="w-4 h-4" /> Configurações
              </button>
            </motion.div>
          ) : (
            <>
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

              {files.length > 0 && !isPlaying && (
                <motion.p 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="mt-4 text-xs text-neutral-500 font-medium"
                >
                  Iniciando automaticamente em <span className="text-blue-400 font-bold">{Math.floor(autoStartCountdown / 60)}:{(autoStartCountdown % 60).toString().padStart(2, '0')}</span>
                </motion.p>
              )}

              {files.length === 0 && settings.driveFolderId && (
                <button 
                  onClick={() => { setIsLoading(true); fetchFiles(); }}
                  className="mt-8 text-neutral-400 hover:text-blue-400 text-sm transition-colors"
                >
                  Nenhum arquivo encontrado. <span className="underline">Tentar novamente</span>
                </button>
              )}
            </>
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
                    onClick={resetApp}
                    className="bg-orange-900/20 hover:bg-orange-900/40 text-orange-400 py-2 rounded-xl text-xs font-bold border border-orange-500/20 transition-colors"
                  >
                    RESET APP
                  </button>
                  <button 
                    onClick={async () => {
                      if (confirm('Tem certeza que deseja limpar o cache local? Isso forçará o download de todos os arquivos novamente.')) {
                        await fetch('/api/cache/clear', { method: 'POST' });
                        alert('Cache limpo com sucesso!');
                        fetchFiles();
                      }
                    }}
                    className="bg-red-900/20 hover:bg-red-900/40 text-red-400 py-2 rounded-xl text-xs font-medium transition-colors col-span-2"
                  >
                    LIMPAR CACHE
                  </button>
                </div>

                <div className="pt-3 border-t border-neutral-800">
                  <button 
                    onClick={() => setShowClientPanel(true)}
                    className="w-full bg-blue-900/30 hover:bg-blue-900/50 text-blue-400 py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 mb-3 border border-blue-500/20"
                  >
                    <User className="w-4 h-4" /> ACESSAR MEU PAINEL REMOTO (CELULAR)
                  </button>
                  <button 
                    onClick={() => setShowAdminPanel(true)}
                    className="w-full bg-neutral-800 hover:bg-neutral-700 text-neutral-400 py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all border border-transparent hover:border-blue-500/30"
                  >
                    <Shield className="w-4 h-4" /> PAINEL ADMINISTRATIVO
                  </button>
                </div>
              </div>

              <button 
                onClick={async () => {
                  const extractedId = extractFolderId(folderInput);
                  const newSettings = { ...settings, driveFolderId: extractedId };
                  setSettings(newSettings);
                  localStorage.setItem('app_settings', JSON.stringify(newSettings));
                  
                  // Sync to server if activated so remote control is aware
                  if (isActivated && settings.licenseCode) {
                    try {
                      await fetch('/api/client/settings', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code: settings.licenseCode, settings: newSettings })
                      });
                    } catch (e) {
                      console.error('Failed to sync settings to server');
                    }
                  }

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

        <AnimatePresence>
          {showAdminPanel && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[100] p-4"
            >
              <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-8 w-full max-w-md relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-purple-600"></div>
                
                <div className="flex justify-between items-center mb-8">
                  <div className="flex items-center gap-3">
                    <Shield className="w-6 h-6 text-blue-500" />
                    <h2 className="text-xl font-bold uppercase tracking-wider">Painel Admin</h2>
                  </div>
                  <button onClick={() => { setShowAdminPanel(false); setIsAdminAuthenticated(false); }} className="p-2 hover:bg-neutral-800 rounded-full"><X className="w-5 h-5" /></button>
                </div>

                {!isAdminAuthenticated ? (
                  <div className="space-y-6">
                    <div className="text-center">
                      <Lock className="w-12 h-12 text-neutral-700 mx-auto mb-4" />
                      <p className="text-neutral-400 text-sm">Acesso restrito ao administrador do sistema.</p>
                    </div>
                    <div className="space-y-4">
                      <input 
                        type="password"
                        placeholder="Senha de Acesso"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        className="w-full bg-neutral-800 border border-neutral-700 p-4 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-center text-lg"
                        onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
                      />
                      <button 
                        onClick={handleAdminLogin}
                        className="w-full bg-blue-600 hover:bg-blue-500 p-4 rounded-xl font-bold transition-all"
                      >
                        ACESSAR PAINEL
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="space-y-4">
                      <div className="bg-neutral-800 p-4 rounded-2xl border border-neutral-700">
                        <label className="block text-xs font-bold text-neutral-500 mb-2 uppercase tracking-widest">Novo Cliente</label>
                        <div className="flex gap-2">
                          <input 
                            type="text"
                            placeholder="Nome do Cliente"
                            value={newClientName}
                            onChange={(e) => setNewClientName(e.target.value)}
                            className="flex-1 bg-neutral-900 border border-neutral-700 px-4 py-2 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                          />
                          <button 
                            onClick={generateNewLicense}
                            className="bg-blue-600 hover:bg-blue-500 p-2 rounded-xl"
                            title="Gerar Código"
                          >
                            <Key className="w-5 h-5 text-white" />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Clientes Ativos</h3>
                        <span className="text-[10px] bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded-full font-bold">
                          {licenses.length} TOTAL
                        </span>
                      </div>
                      
                      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                        {licenses.map((lic) => {
                          const dotColor = !lic.isOnline ? 'bg-neutral-600' : (lic.isPlaying ? 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.8)]' : 'bg-yellow-500 shadow-[0_0_5px_rgba(234,179,8,0.8)]');
                          
                          return (
                            <div key={lic.id} className="bg-neutral-800/50 border border-neutral-700/50 p-3 rounded-xl flex items-center justify-between group">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <div className={`w-1.5 h-1.5 rounded-full ${dotColor} ${lic.isOnline ? 'animate-pulse' : ''}`}></div>
                                  {editingLicense?.id === lic.id ? (
                                    <div className="flex flex-col gap-1">
                                      <input 
                                        autoFocus
                                        className="bg-neutral-900 border border-blue-500/50 text-xs px-2 py-1 rounded outline-none"
                                        value={editingLicense.clientName}
                                        onChange={(e) => setEditingLicense({...editingLicense, clientName: e.target.value})}
                                        placeholder="Nome"
                                      />
                                      <input 
                                        className="bg-neutral-900 border border-blue-500/50 text-[10px] font-mono px-2 py-1 rounded outline-none text-blue-400"
                                        value={editingLicense.code}
                                        onChange={(e) => setEditingLicense({...editingLicense, code: e.target.value.toUpperCase()})}
                                        placeholder="Código"
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') updateLicense(lic.id, editingLicense.clientName, false, editingLicense.code);
                                          if (e.key === 'Escape') setEditingLicense(null);
                                        }}
                                      />
                                    </div>
                                  ) : (
                                    <div className="flex flex-col">
                                      <p className="font-bold text-sm truncate text-neutral-200">{lic.clientName}</p>
                                      <span className="text-[10px] font-mono bg-neutral-900 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/10 w-fit mt-1">
                                        {lic.code}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[9px] text-neutral-500">
                                    {lic.isOnline ? 'ONLINE' : lic.lastSeen ? `Visto ${new Date(lic.lastSeen).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` : 'Inativo'}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {editingLicense?.id === lic.id ? (
                                  <button 
                                    onClick={() => updateLicense(lic.id, editingLicense.clientName, false, editingLicense.code)}
                                    className="p-1.5 hover:bg-green-500/20 text-green-500 rounded-lg"
                                  >
                                    <Play className="w-3.5 h-3.5 fill-current" />
                                  </button>
                                ) : (
                                  <>
                                    <button 
                                      onClick={() => setEditingLicense(lic)}
                                      className="p-1.5 hover:bg-neutral-700 text-neutral-400 hover:text-white rounded-lg"
                                      title="Editar"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button 
                                      onClick={() => {
                                        if (confirm('Deseja resetar a ativação deste código? Isso permitirá usá-lo em outro dispositivo.')) {
                                          updateLicense(lic.id, lic.clientName, true);
                                        }
                                      }}
                                      className="p-1.5 hover:bg-yellow-500/20 text-yellow-500 rounded-lg"
                                      title="Resetar dispositivo"
                                    >
                                      <RefreshCw className="w-3.5 h-3.5" />
                                    </button>
                                    <button 
                                      onClick={() => deleteLicense(lic.id)}
                                      className="p-1.5 hover:bg-red-500/20 text-red-500 rounded-lg"
                                      title="Excluir licença"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                              <button 
                                onClick={() => {
                                  navigator.clipboard.writeText(lic.code);
                                  alert('Código copiado!');
                                }}
                                className="p-2 hover:bg-neutral-800 rounded-lg text-neutral-500 hover:text-white ml-1"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                        {licenses.length === 0 && (
                          <div className="py-8 text-center text-neutral-600 italic text-xs">
                            Nenhum código gerado ainda.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="pt-4 border-t border-neutral-800">
                      <div className="flex items-center gap-2 text-[10px] text-neutral-500">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 opacity-50"></div>
                        Painel de Controle Real-time Online
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {showClientPanel && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/95 backdrop-blur-2xl flex items-center justify-center z-[110] p-4 font-sans"
            >
              <div className="bg-[#111111] border border-[#222222] rounded-3xl w-full max-w-2xl relative overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)]">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-indigo-600"></div>
                <button onClick={() => { setShowClientPanel(false); setIsClientLoggedIn(false); setClientPanelCode(''); }} className="absolute top-6 right-6 p-2 hover:bg-neutral-800 rounded-full transition-colors z-10"><X className="w-5 h-5 text-neutral-500" /></button>
                
                {!isClientLoggedIn ? (
                  <div className="p-8 space-y-8">
                    <div className="text-center space-y-2">
                       <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center mx-auto border border-blue-500/20 mb-2">
                          <User className="w-8 h-8 text-blue-500" />
                       </div>
                       <h2 className="text-2xl font-bold text-white uppercase italic font-serif">Acesso do Cliente</h2>
                       <p className="text-neutral-500 text-[10px] uppercase tracking-widest font-mono">Gerencie sua TV de qualquer lugar</p>
                    </div>

                    <div className="space-y-4">
                       <label className="block text-[10px] uppercase font-bold text-neutral-500 tracking-widest font-mono text-center">Informe seu Código de Ativação</label>
                       <input 
                         type="text"
                         placeholder="DIGITE SEU CÓDIGO"
                         value={clientPanelCode}
                         onChange={(e) => setClientPanelCode(e.target.value.toUpperCase())}
                         className="w-full bg-[#1A1A1A] border border-[#333333] p-5 rounded-2xl outline-none focus:ring-1 focus:ring-blue-500 text-center font-mono text-2xl tracking-[0.3em] text-white transition-all placeholder:text-neutral-800"
                         onKeyDown={(e) => e.key === 'Enter' && handleClientLogin()}
                       />
                       <button 
                         onClick={handleClientLogin}
                         className="w-full bg-blue-600 hover:bg-blue-500 text-white p-5 rounded-2xl font-bold text-sm uppercase tracking-widest transition-all active:scale-95 shadow-xl shadow-blue-900/20"
                       >
                         Acessar Configurações
                       </button>
                    </div>
                  </div>
                ) : (
                  clientPanelData && (
                    <div className="flex flex-col h-full max-h-[90vh]">
                      <div className="p-8 border-b border-[#222222] bg-[#0A0A0A]">
                         <div className="flex items-center justify-between">
                            <div className="space-y-1">
                               <h2 className="text-xl font-bold text-white italic font-serif">{clientPanelData.clientName}</h2>
                               <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-mono bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20">{clientPanelCode}</span>
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                                  <span className="text-[9px] text-green-500 font-mono uppercase">Conectado ao Painel</span>
                               </div>
                            </div>
                            <button 
                               onClick={() => { setIsClientLoggedIn(false); setClientPanelCode(''); }}
                               className="text-xs text-neutral-500 hover:text-white font-mono uppercase bg-neutral-800 px-3 py-2 rounded-lg transition-colors"
                            >
                               Sair
                            </button>
                         </div>
                      </div>

                      <div className="px-8 border-b border-[#222222] bg-[#0A0A0A] flex gap-4">
                        <button 
                          onClick={() => setClientPanelTab('settings')}
                          className={`pb-4 px-2 text-[10px] font-bold tracking-widest transition-all relative ${clientPanelTab === 'settings' ? 'text-blue-500' : 'text-neutral-500 hover:text-neutral-300'}`}
                        >
                          CONFIGURAÇÕES
                          {clientPanelTab === 'settings' && <motion.div layoutId="clientTab" className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-500" />}
                        </button>
                        <button 
                          onClick={() => setClientPanelTab('media')}
                          className={`pb-4 px-2 text-[10px] font-bold tracking-widest transition-all relative ${clientPanelTab === 'media' ? 'text-blue-500' : 'text-neutral-500 hover:text-neutral-300'}`}
                        >
                          GERENCIAR MÍDIAS
                          {clientPanelTab === 'media' && <motion.div layoutId="clientTab" className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-500" />}
                        </button>
                        <button 
                          onClick={() => setClientPanelTab('queue')}
                          className={`pb-4 px-2 text-[10px] font-bold tracking-widest transition-all relative ${clientPanelTab === 'queue' ? 'text-blue-500' : 'text-neutral-500 hover:text-neutral-300'}`}
                        >
                          SISTEMA DE SENHA
                          {clientPanelTab === 'queue' && <motion.div layoutId="clientTab" className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-500" />}
                        </button>
                      </div>

                      <div className="p-8 space-y-6 overflow-y-auto custom-scrollbar bg-[#0D0D0D]">
                        {clientPanelTab === 'settings' ? (
                          <div className="space-y-4">
                            <div>
                               <label className="block text-[10px] uppercase font-bold text-neutral-500 tracking-widest font-mono mb-2">Mensagem do Ticker (Rodapé)</label>
                               <div className="flex gap-2">
                                 <input 
                                   type="text"
                                   value={clientPanelData.settings.tickerMessage || ''}
                                   onChange={(e) => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, tickerMessage: e.target.value } })}
                                   placeholder="Digite uma mensagem para aparecer na TV"
                                   className="flex-1 bg-neutral-900 border border-[#222222] p-4 rounded-xl outline-none focus:ring-1 focus:ring-blue-500 text-sm text-white font-mono"
                                 />
                                 <button 
                                   onClick={() => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, tickerEnabled: !clientPanelData.settings.tickerEnabled } })}
                                   className={`px-4 rounded-xl font-bold text-[10px] transition-all border ${clientPanelData.settings.tickerEnabled ? 'bg-green-600 border-green-500 text-white' : 'bg-neutral-800 border-[#222222] text-neutral-500'}`}
                                 >
                                   {clientPanelData.settings.tickerEnabled ? 'ON' : 'OFF'}
                                 </button>
                               </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                               <div className="space-y-2">
                                  <label className="block text-[10px] uppercase font-bold text-neutral-500 font-mono italic flex items-center justify-between">
                                    <span className="flex items-center gap-2 tracking-widest"><Zap className="w-3 h-3" /> Velocidade</span>
                                    <input 
                                      type="number"
                                      min="1"
                                      max="200"
                                      value={clientPanelData.settings.tickerSpeed || 30}
                                      onChange={(e) => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, tickerSpeed: parseInt(e.target.value) || 1 } })}
                                      className="w-12 bg-neutral-800 border border-[#333333] rounded px-1 py-0.5 text-[10px] text-white text-center font-mono outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                  </label>
                                  <input 
                                    type="range"
                                    min="1"
                                    max="200"
                                    value={clientPanelData.settings.tickerSpeed || 30}
                                    onChange={(e) => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, tickerSpeed: parseInt(e.target.value) } })}
                                    className="w-full accent-blue-500 h-1.5"
                                  />
                               </div>
                               <div className="space-y-2">
                                  <label className="block text-[10px] uppercase font-bold text-neutral-500 font-mono italic flex items-center gap-2">
                                    <Palette className="w-3 h-3" /> Cor do Texto
                                  </label>
                                  <div className="flex gap-2">
                                    <input 
                                      type="color"
                                      value={clientPanelData.settings.tickerColor || '#ffffff'}
                                      onChange={(e) => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, tickerColor: e.target.value } })}
                                      className="w-10 h-10 rounded-lg border-2 border-[#222222] bg-transparent cursor-pointer overflow-hidden p-0"
                                    />
                                    <input 
                                      type="text"
                                      value={clientPanelData.settings.tickerColor || '#ffffff'}
                                      onChange={(e) => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, tickerColor: e.target.value.toUpperCase() } })}
                                      className="flex-1 bg-neutral-900 border border-[#222222] px-3 py-2 rounded-lg text-xs text-white font-mono"
                                    />
                                  </div>
                               </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                               <div className="space-y-2">
                                  <label className="block text-[10px] uppercase font-bold text-neutral-500 font-mono italic">Direção do Fluxo</label>
                                  <div className="flex gap-2">
                                    <button 
                                      onClick={() => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, tickerDirection: 'horizontal' } })}
                                      className={`flex-1 py-3 rounded-xl text-[10px] font-bold border transition-all flex items-center justify-center gap-2 ${clientPanelData.settings.tickerDirection === 'horizontal' ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20' : 'bg-neutral-800 border-[#222222] text-neutral-500'}`}
                                    >
                                      <ArrowRightLeft className="w-3.5 h-3.5" /> HORIZONTAL
                                    </button>
                                    <button 
                                      onClick={() => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, tickerDirection: 'vertical' } })}
                                      className={`flex-1 py-3 rounded-xl text-[10px] font-bold border transition-all flex items-center justify-center gap-2 ${clientPanelData.settings.tickerDirection === 'vertical' ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20' : 'bg-neutral-800 border-[#222222] text-neutral-500'}`}
                                    >
                                      <ArrowUpDown className="w-3.5 h-3.5" /> VERTICAL
                                    </button>
                                  </div>
                               </div>
                               <div className="space-y-2">
                                  <label className="block text-[10px] uppercase font-bold text-neutral-500 font-mono italic">Logo (WhatsApp, etc)</label>
                                  <div className="flex flex-wrap gap-2 mb-2">
                                    <button 
                                      onClick={() => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, tickerLogoUrl: 'https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg' } })}
                                      className="px-2 py-1 bg-green-900/30 border border-green-500/30 rounded text-[9px] text-green-400 font-bold flex items-center gap-1"
                                    >
                                      <Plus className="w-2.5 h-2.5" /> WHATSAPP
                                    </button>
                                    <button 
                                      onClick={() => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, tickerLogoUrl: 'https://cdn-icons-png.flaticon.com/512/2111/2111463.png' } })}
                                      className="px-2 py-1 bg-pink-900/30 border border-pink-500/30 rounded text-[9px] text-pink-400 font-bold flex items-center gap-1"
                                    >
                                      <Plus className="w-2.5 h-2.5" /> INSTAGRAM
                                    </button>
                                  </div>
                                  <div className="flex gap-2">
                                    <input 
                                      type="text"
                                      value={clientPanelData.settings.tickerLogoUrl || ''}
                                      onChange={(e) => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, tickerLogoUrl: e.target.value } })}
                                      placeholder="URL da imagem"
                                      className="flex-1 bg-neutral-900 border border-[#222222] px-3 py-2 rounded-lg text-xs text-white font-mono"
                                    />
                                    <div className="relative">
                                      <input 
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => {
                                          const file = e.target.files?.[0];
                                          if (file) {
                                            const reader = new FileReader();
                                            reader.onloadend = () => {
                                              setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, tickerLogoUrl: reader.result as string } });
                                            };
                                            reader.readAsDataURL(file);
                                          }
                                        }}
                                        className="absolute inset-0 opacity-0 cursor-pointer"
                                      />
                                      <button className="bg-neutral-800 p-2 rounded-lg border border-[#222222] hover:bg-neutral-700 transition-colors">
                                        <Plus className="w-4 h-4 text-blue-400" />
                                      </button>
                                    </div>
                                  </div>
                                  {clientPanelData.settings.tickerLogoUrl && (
                                    <div className="flex items-center gap-2 mt-2">
                                      <img src={clientPanelData.settings.tickerLogoUrl} alt="preview" className="w-8 h-8 object-contain rounded" />
                                      <button onClick={() => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, tickerLogoUrl: '' } })} className="text-[9px] text-red-500 underline">Remover</button>
                                    </div>
                                  )}
                               </div>
                            </div>

                            <div>
                               <label className="block text-[10px] uppercase font-bold text-neutral-500 tracking-widest font-mono mb-2">Situação da Playlist / Pasta Google Drive</label>
                               <textarea 
                                 value={clientPanelData.settings.driveFolderId}
                                 onChange={(e) => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, driveFolderId: e.target.value } })}
                                 placeholder="Cole aqui o link do Google Drive ou Bit.ly"
                                 className="w-full bg-neutral-900 border border-[#222222] p-4 rounded-xl outline-none focus:ring-1 focus:ring-blue-500 text-sm text-white font-mono min-h-[100px] resize-none"
                               />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                               <div className="bg-[#1A1A1A] p-4 rounded-xl border border-[#222222]">
                                  <label className="block text-[9px] uppercase font-bold text-neutral-500 mb-2">Tempo Imagens (seg)</label>
                                  <input 
                                     type="number"
                                     value={clientPanelData.settings.slideDuration / 1000}
                                     onChange={(e) => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, slideDuration: parseInt(e.target.value) * 1000 } })}
                                     className="w-full bg-transparent text-xl font-mono text-white outline-none"
                                  />
                               </div>
                               <div className="bg-[#1A1A1A] p-4 rounded-xl border border-[#222222]">
                                  <label className="block text-[9px] uppercase font-bold text-neutral-500 mb-2">Tempo Sites (seg)</label>
                                  <input 
                                     type="number"
                                     value={clientPanelData.settings.websiteDuration / 1000}
                                     onChange={(e) => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, websiteDuration: parseInt(e.target.value) * 1000 } })}
                                     className="w-full bg-transparent text-xl font-mono text-white outline-none"
                                  />
                               </div>
                            </div>

                            <div className="space-y-2">
                               <label className="block text-[10px] uppercase font-bold text-neutral-500 tracking-widest font-mono">Orientação da Tela</label>
                               <div className="grid grid-cols-2 gap-3">
                                  <button 
                                    onClick={() => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, orientation: 'horizontal' } })}
                                    className={`p-3 rounded-xl border flex items-center justify-center gap-2 transition-all ${clientPanelData.settings.orientation === 'horizontal' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-neutral-800 border-[#222222] text-neutral-500 hover:bg-neutral-700'}`}
                                  >
                                     <Maximize className="w-4 h-4 rotate-90" />
                                     <span className="text-xs font-bold font-mono">HORIZONTAL</span>
                                  </button>
                                  <button 
                                    onClick={() => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, orientation: 'vertical' } })}
                                    className={`p-3 rounded-xl border flex items-center justify-center gap-2 transition-all ${clientPanelData.settings.orientation === 'vertical' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-neutral-800 border-[#222222] text-neutral-500 hover:bg-neutral-700'}`}
                                  >
                                     <Maximize className="w-4 h-4" />
                                     <span className="text-xs font-bold font-mono">VERTICAL</span>
                                  </button>
                               </div>
                            </div>

                            <div className="space-y-2">
                               <label className="block text-[10px] uppercase font-bold text-neutral-500 tracking-widest font-mono">Modo de Exibição das Imagens (PROPORÇÃO)</label>
                               <div className="grid grid-cols-3 gap-2">
                                  {['fill', 'fit', 'stretch'].map((mode) => (
                                    <button 
                                      key={mode}
                                      onClick={() => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, displayMode: mode as any } })}
                                      className={`p-2 rounded-lg border text-[9px] font-bold transition-all ${clientPanelData.settings.displayMode === mode ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-neutral-800 border-[#222222] text-neutral-500'}`}
                                    >
                                       {mode.toUpperCase()}
                                    </button>
                                  ))}
                               </div>
                            </div>

                            <div className="space-y-2">
                               <label className="block text-[10px] uppercase font-bold text-neutral-500 tracking-widest font-mono">Controle de Som e Sistema</label>
                               <div className="grid grid-cols-2 gap-3">
                                  <button 
                                    onClick={() => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, isMuted: !clientPanelData.settings.isMuted } })}
                                    className={`p-3 rounded-xl border flex items-center justify-center gap-2 transition-all ${!clientPanelData.settings.isMuted ? 'bg-green-600 border-green-500 text-white' : 'bg-neutral-800 border-[#222222] text-neutral-500'}`}
                                  >
                                     {!clientPanelData.settings.isMuted ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                                     <span className="text-xs font-bold font-mono">{!clientPanelData.settings.isMuted ? 'SOM ATIVADO' : 'SOM MUDO'}</span>
                                  </button>
                                  <button 
                                    onClick={() => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, autoStart: !clientPanelData.settings.autoStart } })}
                                    className={`p-3 rounded-xl border flex items-center justify-center gap-2 transition-all ${clientPanelData.settings.autoStart ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-neutral-800 border-[#222222] text-neutral-500'}`}
                                  >
                                     <Play className="w-4 h-4" />
                                     <span className="text-xs font-bold font-mono">{clientPanelData.settings.autoStart ? 'AUTO-PLAY ON' : 'AUTO-PLAY OFF'}</span>
                                  </button>
                               </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                               <div className="bg-[#1A1A1A] p-4 rounded-xl border border-[#222222]">
                                  <label className="block text-[9px] uppercase font-bold text-neutral-500 mb-2">Recarregar Site (seg)</label>
                                  <input 
                                     type="number"
                                     value={clientPanelData.settings.websiteRefreshInterval / 1000}
                                     onChange={(e) => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, websiteRefreshInterval: parseInt(e.target.value) * 1000 } })}
                                     className="w-full bg-transparent text-xl font-mono text-white outline-none"
                                     placeholder="0 = nunca"
                                  />
                               </div>
                               <div className="bg-[#1A1A1A] p-4 rounded-xl border border-[#222222]">
                                  <label className="block text-[9px] uppercase font-bold text-neutral-500 mb-2">Sincronização (seg)</label>
                                  <input 
                                     type="number"
                                     value={clientPanelData.settings.syncInterval / 1000}
                                     onChange={(e) => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, syncInterval: parseInt(e.target.value) * 1000 } })}
                                     className="w-full bg-transparent text-xl font-mono text-white outline-none"
                                  />
                               </div>
                            </div>

                            <div className="pt-2 border-t border-[#222222] space-y-2">
                              <button 
                                onClick={async () => {
                                  if (confirm('Deseja limpar o cache de arquivos remotamente? Isso forçará o download de todos os conteúdos novamente na TV.')) {
                                    try {
                                      await fetch('/api/cache/clear', { method: 'POST' });
                                      alert('Comando de limpeza enviado! A TV baixará os arquivos no próximo ciclo.');
                                    } catch (e) {
                                      alert('Erro ao enviar comando.');
                                    }
                                  }
                                }}
                                className="w-full bg-orange-900/10 hover:bg-neutral-800 text-orange-500 py-3 rounded-xl text-[10px] font-bold border border-orange-500/10 flex items-center justify-center gap-2 transition-all"
                              >
                                <RefreshCw className="w-3.5 h-3.5" /> LIMPAR CACHE DE ARQUIVOS (REMOTO)
                              </button>

                              <button 
                                onClick={() => {
                                  if (confirm('Deseja forçar a atualização remota do aplicativo? Isso recarregará o sistema no dispositivo físico.')) {
                                    handleSaveClientSettings({ ...clientPanelData.settings, appRefreshInterval: Date.now() });
                                  }
                                }}
                                className="w-full bg-red-900/20 hover:bg-neutral-800 text-red-500 py-3 rounded-xl text-[10px] font-bold border border-red-500/20 flex items-center justify-center gap-2 transition-all"
                              >
                                <RefreshCw className="w-3.5 h-3.5" /> FORÇAR REINICIALIZAÇÃO DO APP
                              </button>

                              <button 
                                onClick={() => {
                                  handleSaveClientSettings({ 
                                    ...clientPanelData.settings, 
                                    remoteCommand: 'start',
                                    remoteCommandId: Math.random().toString(36).substr(2, 9) 
                                  });
                                }}
                                className="w-full bg-blue-600 hover:bg-blue-500 text-white py-4 rounded-xl text-xs font-bold border border-blue-400 flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95"
                              >
                                <Play className="w-4 h-4 fill-current" /> INICIAR TRANSMISSÃO (AGORA)
                              </button>
                            </div>

                            <div className="space-y-4 p-4 bg-orange-500/5 rounded-2xl border border-orange-500/10">
                                <div className="flex items-center justify-between">
                                  <label className="block text-[10px] uppercase font-bold text-neutral-500 tracking-widest font-mono italic">Propagandas e Avisos</label>
                                  <button 
                                    onClick={() => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, footerEnabled: !clientPanelData.settings.footerEnabled } })}
                                    className={`px-4 py-2 rounded-xl font-bold text-[10px] transition-all border shadow-lg ${clientPanelData.settings.footerEnabled ? 'bg-orange-600 border-orange-400 text-white shadow-orange-900/40' : 'bg-neutral-800 border-[#333333] text-neutral-500'}`}
                                  >
                                    {clientPanelData.settings.footerEnabled ? 'RODAPÉ ATIVADO' : 'RODAPÉ DESATIVADO'}
                                  </button>
                                </div>
                                
                                {clientPanelData.settings.footerEnabled && (
                                  <div className="space-y-4 pt-2 border-t border-white/5">
                                     <div className="space-y-2">
                                        <label className="block text-[10px] uppercase font-bold text-neutral-500 font-mono italic">Texto do Letreiro (Notícias)</label>
                                        <div className="flex items-center gap-2">
                                          <input 
                                            type="text"
                                            value={clientPanelData.settings.tickerMessage || ''}
                                            onChange={(e) => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, tickerMessage: e.target.value, tickerEnabled: true } })}
                                            className="flex-1 bg-black/50 border border-[#333333] rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-blue-500/50"
                                            placeholder="Escreva as notícias ou avisos aqui..."
                                          />
                                        </div>
                                     </div>

                                     <div className="space-y-3">
                                        <label className="block text-[10px] uppercase font-bold text-neutral-500 font-mono italic">Banners de Propaganda (URLs)</label>
                                        
                                        {(clientPanelData.settings.tickerAdImages || []).map((url, idx) => (
                                          <div key={idx} className="flex gap-2">
                                             <input 
                                               type="text"
                                               value={url}
                                               onChange={(e) => {
                                                 const newImages = [...(clientPanelData.settings.tickerAdImages || [])];
                                                 newImages[idx] = e.target.value;
                                                 setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, tickerAdImages: newImages } });
                                               }}
                                               className="flex-1 bg-black/50 border border-[#333333] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-orange-500/50"
                                               placeholder="URL da Imagem..."
                                             />
                                             <button 
                                               onClick={() => {
                                                 const newImages = (clientPanelData.settings.tickerAdImages || []).filter((_, i) => i !== idx);
                                                 setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, tickerAdImages: newImages } });
                                               }}
                                               className="p-2 bg-red-900/20 text-red-500 rounded-lg hover:bg-red-900/40"
                                             >
                                               <X className="w-4 h-4" />
                                             </button>
                                          </div>
                                        ))}
                                        
                                        <button 
                                          onClick={() => {
                                            const newImages = [...(clientPanelData.settings.tickerAdImages || []), ''];
                                            setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, tickerAdImages: newImages } });
                                          }}
                                          className="w-full py-2 border border-dashed border-[#444444] rounded-xl text-[10px] font-bold text-neutral-500 hover:border-orange-500/50 hover:text-orange-500 transition-all font-mono"
                                        >
                                          + ADICIONAR BANNER
                                        </button>
                                     </div>
                                  </div>
                                )}
                            </div>

                            <div className="bg-blue-500/5 p-4 rounded-xl border border-blue-500/10">
                               <div className="flex items-start gap-3">
                                  <RefreshCw className="w-4 h-4 text-blue-400 mt-0.5 animate-spin-slow" />
                                  <p className="text-[10px] text-blue-400 font-mono leading-relaxed">
                                     A TV sincroniza as alterações automaticamente a cada 5 segundos. Não é necessário reiniciar o dispositivo físico.
                                  </p>
                               </div>
                            </div>
                             <div className="space-y-4 p-4 bg-purple-500/5 rounded-2xl border border-purple-500/10">
                                <div className="flex items-center justify-between">
                                  <label className="block text-[10px] uppercase font-bold text-neutral-500 tracking-widest font-mono italic text-purple-400 font-bold tracking-widest">GC / Legendas (Lower Third)</label>
                                  <button 
                                    onClick={() => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, gcEnabled: !clientPanelData.settings.gcEnabled } })}
                                    className={`px-4 py-2 rounded-xl font-bold text-[10px] transition-all border shadow-lg ${clientPanelData.settings.gcEnabled ? 'bg-purple-600 border-purple-400 text-white shadow-purple-900/40' : 'bg-neutral-800 border-[#333333] text-neutral-500'}`}
                                  >
                                    {clientPanelData.settings.gcEnabled ? 'DESATIVAR GC' : 'ATIVAR GC'}
                                  </button>
                                </div>
                                
                                {clientPanelData.settings.gcEnabled && (
                                  <div className="space-y-4 pt-2 border-t border-white/5">
                                     <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-2">
                                           <label className="block text-[9px] uppercase font-bold text-neutral-500 font-mono">Título (Legenda)</label>
                                           <input 
                                             type="text"
                                             value={clientPanelData.settings.gcTitle || ''}
                                             onChange={(e) => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, gcTitle: e.target.value } })}
                                             className="w-full bg-black/50 border border-[#333333] rounded-xl px-3 py-2 text-xs text-white outline-none"
                                           />
                                        </div>
                                        <div className="space-y-2">
                                           <label className="block text-[9px] uppercase font-bold text-neutral-500 font-mono">Categoria (Caixa Vermelha)</label>
                                           <input 
                                             type="text"
                                             value={clientPanelData.settings.gcCategory || ''}
                                             onChange={(e) => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, gcCategory: e.target.value } })}
                                             className="w-full bg-black/50 border border-[#333333] rounded-xl px-3 py-2 text-xs text-white outline-none"
                                           />
                                        </div>
                                     </div>
                                     <div className="space-y-2">
                                        <label className="block text-[9px] uppercase font-bold text-neutral-500 font-mono">Subtítulo (Apoio)</label>
                                        <input 
                                          type="text"
                                          value={clientPanelData.settings.gcSubtitle || ''}
                                          onChange={(e) => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, gcSubtitle: e.target.value } })}
                                          className="w-full bg-black/50 border border-[#333333] rounded-xl px-4 py-3 text-xs text-white outline-none"
                                        />
                                     </div>
                                     <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-2">
                                           <label className="block text-[9px] uppercase font-bold text-neutral-500 font-mono">URL Logo (Opcional)</label>
                                           <input 
                                             type="text"
                                             value={clientPanelData.settings.gcLogoUrl || ''}
                                             onChange={(e) => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, gcLogoUrl: e.target.value } })}
                                             className="w-full bg-black/50 border border-[#333333] rounded-xl px-3 py-2 text-xs text-white outline-none"
                                             placeholder="https://..."
                                           />
                                        </div>
                                        <div className="space-y-2">
                                           <label className="block text-[9px] uppercase font-bold text-neutral-500 font-mono">Cor da Categoria</label>
                                           <input 
                                             type="color"
                                             value={clientPanelData.settings.gcCategoryColor || '#c62828'}
                                             onChange={(e) => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, gcCategoryColor: e.target.value } })}
                                             className="w-full h-8 bg-transparent rounded-lg cursor-pointer"
                                           />
                                        </div>
                                     </div>
                                  </div>
                                )}
                             </div>
                          </div>
                        ) : clientPanelTab === 'media' ? (
                          <div className="space-y-4">
                            <div className="flex items-center justify-between mb-4">
                               <label className="block text-[10px] uppercase font-bold text-neutral-500 tracking-widest font-mono">Gerenciador de Mídias</label>
                               <div className="flex items-center gap-3">
                                  <button 
                                    onClick={fetchClientFiles}
                                    className="p-2 hover:bg-neutral-800 rounded-lg text-blue-400 transition-colors"
                                    title="Atualizar Lista"
                                  >
                                    <RefreshCw className={`w-3.5 h-3.5 ${isFetchingClientFiles ? 'animate-spin' : ''}`} />
                                  </button>
                                  <span className="text-[9px] text-neutral-600 font-mono italic">{clientFiles.length} Arquivos totais</span>
                               </div>
                            </div>
                            
                            <div className="space-y-2">
                               {isFetchingClientFiles ? (
                                 <div className="p-12 border border-dashed border-[#222222] rounded-3xl bg-neutral-900/20 text-center">
                                    <Loader2 className="w-10 h-10 text-blue-500 mx-auto mb-4 animate-spin" />
                                    <p className="text-[10px] text-neutral-500 font-mono uppercase tracking-[0.2em]">Carregando arquivos...</p>
                                 </div>
                               ) : clientFilesError ? (
                                 <div className="p-12 border border-orange-500/20 rounded-3xl bg-orange-500/5 text-center">
                                    <Shield className="w-10 h-10 text-orange-500 mx-auto mb-4" />
                                    <p className="text-[10px] text-orange-500 font-mono uppercase tracking-[0.2em]">{clientFilesError}</p>
                                 </div>
                               ) : clientFiles.length === 0 ? (
                                 <div className="p-12 border border-dashed border-[#222222] rounded-3xl bg-neutral-900/20 text-center">
                                    <Activity className="w-10 h-10 text-neutral-800 mx-auto mb-4" />
                                    <p className="text-[10px] text-neutral-500 font-mono uppercase tracking-[0.2em] leading-relaxed">
                                       Nenhum arquivo encontrado.<br/>
                                       <span className="text-neutral-700">Verifique se o link do Drive acima é válido.</span>
                                    </p>
                                 </div>
                               ) : (
                                 clientFiles.map(file => {
                                   const isDisabled = clientPanelData.settings.disabledMediaIds?.includes(file.id);
                                   return (
                                     <div key={file.id} className="group flex items-center justify-between p-4 bg-neutral-900/40 border border-[#222222] rounded-2xl hover:border-blue-500/30 transition-all">
                                        <div className="flex items-center gap-4 overflow-hidden">
                                           <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border ${file.isVideo ? 'bg-blue-500/10 border-blue-500/20 text-blue-500' : file.isWebsite ? 'bg-purple-500/10 border-purple-500/20 text-purple-500' : 'bg-green-500/10 border-green-500/20 text-green-500'}`}>
                                              {file.isVideo ? <Play className="w-6 h-6" /> : file.isWebsite ? <RefreshCw className="w-6 h-6" /> : <Palette className="w-6 h-6" />}
                                           </div>
                                           <div className="flex flex-col min-w-0">
                                              <span className="text-xs font-bold text-white truncate group-hover:text-blue-400 transition-colors uppercase">{file.name}</span>
                                              <div className="flex items-center gap-2">
                                                <span className="text-[9px] text-neutral-600 font-mono uppercase truncate px-2 py-0.5 bg-black/50 rounded">{file.mimeType?.split('/').pop() || (file.isVideo ? 'VIDEO' : file.isWebsite ? 'SITE' : 'IMAGE')}</span>
                                                <span className={`w-1.5 h-1.5 rounded-full ${isDisabled ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]' : 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]'}`}></span>
                                              </div>
                                           </div>
                                        </div>
                                        <button 
                                           onClick={() => {
                                             const current = clientPanelData.settings.disabledMediaIds || [];
                                             const next = isDisabled ? current.filter(id => id !== file.id) : [...current, file.id];
                                             setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, disabledMediaIds: next } });
                                           }}
                                           className={`px-5 py-2.5 rounded-xl text-[10px] font-bold border transition-all ${isDisabled ? 'bg-red-900/20 border-red-500/30 text-red-500' : 'bg-green-600 border-green-500 text-white shadow-lg shadow-green-500/10'}`}
                                        >
                                           {isDisabled ? 'DESATIVADO' : 'ATIVO'}
                                        </button>
                                     </div>
                                   );
                                 })
                               )}
                            </div>
                          </div>
                        ) : (
                           <div className="space-y-6">
                              <div className="flex items-center justify-between">
                                <label className="block text-[10px] uppercase font-bold text-neutral-500 tracking-widest font-mono">Controle de Chamada</label>
                                <button 
                                  onClick={async () => {
                                    if (!clientPanelData) return;
                                    const currentStatus = !!clientPanelData.settings.queueEnabled;
                                    const nextSettings = { ...clientPanelData.settings, queueEnabled: !currentStatus };
                                    setClientPanelData({ ...clientPanelData, settings: nextSettings });
                                    try {
                                      await handleSaveClientSettings(nextSettings);
                                    } catch (err) {
                                      setClientPanelData(prev => prev ? { ...prev, settings: { ...prev.settings, queueEnabled: currentStatus } } : null);
                                      alert('Falha ao sincronizar.');
                                    }
                                  }}
                                  className={`px-4 py-2 rounded-xl font-bold text-[10px] transition-all border shadow-lg ${clientPanelData.settings.queueEnabled ? 'bg-green-600 border-green-400 text-white shadow-green-900/40' : 'bg-neutral-800 border-[#333333] text-neutral-500'}`}
                                >
                                  {clientPanelData.settings.queueEnabled ? 'SISTEMA ATIVADO' : 'SISTEMA DESATIVADO'}
                                </button>
                              </div>

                              <div className="bg-[#1A1A1A] p-6 rounded-3xl border border-[#222222] space-y-4">
                                 <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                       <label className="block text-[10px] uppercase font-bold text-neutral-500 font-mono">Senha / Número</label>
                                       <input 
                                         type="text"
                                         value={queueInput.ticket}
                                         onChange={(e) => setQueueInput({ ...queueInput, ticket: e.target.value.toUpperCase() })}
                                         placeholder="EX: A38"
                                         className="w-full bg-neutral-900 border border-[#222222] p-4 rounded-xl outline-none focus:ring-1 focus:ring-blue-500 text-xl font-mono text-white text-center"
                                       />
                                    </div>
                                    <div className="space-y-2">
                                       <label className="block text-[10px] uppercase font-bold text-neutral-500 font-mono">Guichê / Local</label>
                                       <input 
                                         type="text"
                                         value={queueInput.counter}
                                         onChange={(e) => setQueueInput({ ...queueInput, counter: e.target.value })}
                                         placeholder="EX: Guichê 2"
                                         className="w-full bg-neutral-900 border border-[#222222] p-4 rounded-xl outline-none focus:ring-1 focus:ring-blue-500 text-sm font-mono text-white text-center"
                                       />
                                    </div>
                                 </div>
                                 
                                 <div className="space-y-2">
                                    <label className="block text-[10px] uppercase font-bold text-neutral-500 font-mono">Nome da Pessoa (Opcional)</label>
                                    <input 
                                      type="text"
                                      value={queueInput.name}
                                      onChange={(e) => setQueueInput({ ...queueInput, name: e.target.value })}
                                      placeholder="EX: João da Silva"
                                      className="w-full bg-neutral-900 border border-[#222222] p-4 rounded-xl outline-none focus:ring-1 focus:ring-blue-500 text-sm font-mono text-white"
                                    />
                                 </div>

                                 <button 
                                   onClick={() => {
                                      if (!queueInput.ticket && !queueInput.name) return;
                                      const newCall: QueueCall = {
                                        id: Math.random().toString(36).substr(2, 9),
                                        ticket: queueInput.ticket,
                                        name: queueInput.name,
                                        counter: queueInput.counter,
                                        timestamp: new Date().toISOString()
                                      };
                                      
                                      const history = [newCall, ...(clientPanelData.settings.queueHistory || [])].slice(0, 10);
                                      handleSaveClientSettings({
                                        ...clientPanelData.settings,
                                        queueCurrent: newCall,
                                        queueHistory: history
                                      });
                                   }}
                                   className="w-full bg-blue-600 hover:bg-blue-500 text-white p-5 rounded-2xl font-bold text-lg uppercase tracking-widest transition-all active:scale-95 shadow-xl shadow-blue-900/20 flex items-center justify-center gap-3"
                                 >
                                   <Volume2 className="w-6 h-6" /> CHAMAR SENHA
                                 </button>
                                 
                                 {clientPanelData.settings.queueCurrent && (
                                   <button 
                                     onClick={() => {
                                        handleSaveClientSettings({
                                          ...clientPanelData.settings,
                                          queueCurrent: { ...clientPanelData.settings.queueCurrent!, id: Math.random().toString(36).substr(2, 9) } 
                                        });
                                     }}
                                     className="w-full bg-neutral-800 hover:bg-neutral-700 text-neutral-400 p-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-all"
                                   >
                                      Chamar Atual Novamente
                                   </button>
                                 )}
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <label className="block text-[10px] uppercase font-bold text-neutral-500 tracking-widest font-mono">Voz da Chamada</label>
                                  <button 
                                    onClick={() => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, queueVoiceEnabled: !clientPanelData.settings.queueVoiceEnabled } })}
                                    className={`w-full py-3 rounded-xl text-[10px] font-bold border transition-all flex items-center justify-center gap-2 ${clientPanelData.settings.queueVoiceEnabled ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-neutral-800 border-[#222222] text-neutral-500'}`}
                                  >
                                    {clientPanelData.settings.queueVoiceEnabled ? 'VOZ LIGADA' : 'VOZ DESLIGADA'}
                                  </button>
                                </div>
                                <div className="space-y-2">
                                  <label className="block text-[10px] uppercase font-bold text-neutral-500 tracking-widest font-mono">Exibir Histórico</label>
                                  <button 
                                    onClick={() => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, queueShowHistory: !clientPanelData.settings.queueShowHistory } })}
                                    className={`w-full py-3 rounded-xl text-[10px] font-bold border transition-all flex items-center justify-center gap-2 ${clientPanelData.settings.queueShowHistory ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-neutral-800 border-[#222222] text-neutral-500'}`}
                                  >
                                    {clientPanelData.settings.queueShowHistory ? 'HISTÓRICO ON' : 'HISTÓRICO OFF'}
                                  </button>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                   <label className="block text-[10px] uppercase font-bold text-neutral-500 tracking-widest font-mono">Título do Painel</label>
                                   <input 
                                     type="text"
                                     value={clientPanelData.settings.queueTitle || ''}
                                     onChange={(e) => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, queueTitle: e.target.value } })}
                                     className="w-full bg-neutral-900 border border-[#222222] p-3 rounded-xl text-xs text-white font-mono"
                                   />
                                </div>
                                <div className="space-y-2">
                                   <label className="block text-[10px] uppercase font-bold text-neutral-500 tracking-widest font-mono">Rótulo do Cliente</label>
                                   <input 
                                     type="text"
                                     value={clientPanelData.settings.queueClientLabel || 'CLIENTE'}
                                     onChange={(e) => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, queueClientLabel: e.target.value } })}
                                     className="w-full bg-neutral-900 border border-[#222222] p-3 rounded-xl text-xs text-white font-mono"
                                     placeholder="CLIENTE / PACIENTE"
                                   />
                                </div>
                              </div>

                              <div className="space-y-2">
                                 <label className="block text-[10px] uppercase font-bold text-neutral-500 tracking-widest font-mono">Cores do Tema</label>
                                 <div className="flex gap-2">
                                    <input 
                                      type="color"
                                      value={clientPanelData.settings.queueThemeColor || '#004a8e'}
                                      onChange={(e) => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, queueThemeColor: e.target.value } })}
                                      className="w-10 h-10 rounded-lg border-2 border-[#222222] bg-transparent cursor-pointer overflow-hidden p-0"
                                    />
                                    <div className="grid grid-cols-4 gap-1 flex-1">
                                       {['#004a8e', '#c62828', '#2e7d32', '#f9a825', '#4527a0', '#37474f'].map(color => (
                                          <button 
                                            key={color}
                                            onClick={() => setClientPanelData({ ...clientPanelData, settings: { ...clientPanelData.settings, queueThemeColor: color } })}
                                            className="h-full rounded border border-white/10"
                                            style={{ backgroundColor: color }}
                                          />
                                       ))}
                                    </div>
                                 </div>
                              </div>
                           </div>
                        )}
                      </div>

                      <div className="p-8 pt-4 pb-8 bg-[#0D0D0D]">
                         <button 
                           onClick={() => handleSaveClientSettings(clientPanelData.settings)}
                           disabled={isSavingClientSettings}
                           className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white p-4 rounded-2xl font-bold text-sm uppercase tracking-widest transition-all flex items-center justify-center gap-3 active:scale-95 shadow-xl shadow-green-900/10"
                         >
                           {isSavingClientSettings ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                           Salvar Configurações Remotamente
                         </button>
                      </div>
                    </div>
                  )
                )}
              </div>
            </motion.div>
          )}

          {showStatusCheck && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-[#0A0A0A]/95 backdrop-blur-2xl flex items-center justify-center z-[110] p-4 font-sans"
            >
              <div className="bg-[#111111] border border-[#222222] rounded-3xl w-full max-w-4xl relative overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col h-[85vh]">
                {/* Header Section */}
                <div className="p-8 border-b border-[#222222] relative">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-purple-600 to-green-600"></div>
                  <button onClick={() => setShowStatusCheck(false)} className="absolute top-6 right-6 p-2 hover:bg-[#222222] rounded-full text-neutral-500 transition-colors z-10"><X className="w-5 h-5" /></button>
                  
                  <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center border border-blue-500/20">
                          <Activity className="w-5 h-5 text-blue-500" />
                        </div>
                        <h2 className="text-2xl font-bold tracking-tight text-white uppercase italic font-serif">Mission Control</h2>
                      </div>
                      <p className="text-neutral-500 text-xs uppercase tracking-[0.2em] font-mono">Monitoramento de Dispositivos em Tempo Real</p>
                    </div>

                    <div className="flex flex-col gap-2">
                       <label className="text-[10px] uppercase font-bold text-neutral-500 tracking-widest font-mono">Adicionar Novos Dispositivos (Codigos separados por espaço ou virgula)</label>
                       <div className="flex gap-2">
                        <input 
                          type="text"
                          placeholder="EX: ABC123, XYZ789..."
                          value={statusCheckCode}
                          onChange={(e) => setStatusCheckCode(e.target.value.toUpperCase())}
                          className="w-full md:w-64 bg-[#1A1A1A] border border-[#333333] p-3 rounded-xl outline-none focus:ring-1 focus:ring-blue-500 text-center font-mono text-sm tracking-widest text-white transition-all placeholder:text-neutral-700"
                          onKeyDown={(e) => e.key === 'Enter' && addStatusCheckCode()}
                        />
                        <button 
                          onClick={() => addStatusCheckCode()}
                          className="bg-white hover:bg-neutral-200 text-black px-6 rounded-xl font-bold text-xs uppercase transition-all active:scale-95 flex items-center gap-2"
                        >
                          <Plus className="w-3 h-3" /> Inserir
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Dashboard Stats Bar */}
                <div className="grid grid-cols-2 md:grid-cols-4 border-b border-[#222222] bg-[#0D0D0D]">
                   <div className="p-4 border-r border-[#222222] flex flex-col items-center justify-center">
                      <span className="text-[10px] text-neutral-500 font-mono uppercase mb-1">Total Monit.</span>
                      <span className="text-xl font-mono text-white leading-none">{statusCheckCodes.length.toString().padStart(2, '0')}</span>
                   </div>
                   <div className="p-4 border-r border-[#222222] flex flex-col items-center justify-center">
                      <span className="text-[10px] text-neutral-500 font-mono uppercase mb-1">Online</span>
                      <span className="text-xl font-mono text-green-500 leading-none">
                        {statusCheckCodes.filter(c => statusCheckResults[c]?.isOnline).length.toString().padStart(2, '0')}
                      </span>
                   </div>
                   <div className="p-4 border-r border-[#222222] flex flex-col items-center justify-center">
                      <span className="text-[10px] text-neutral-500 font-mono uppercase mb-1">Playing</span>
                      <span className="text-xl font-mono text-blue-500 leading-none">
                        {statusCheckCodes.filter(c => statusCheckResults[c]?.isPlaying).length.toString().padStart(2, '0')}
                      </span>
                   </div>
                   <div className="p-4 flex flex-col items-center justify-center">
                      <button onClick={clearAllStatusCheckCodes} className="text-[9px] text-red-500/70 hover:text-red-500 font-mono uppercase tracking-widest transition-colors flex items-center gap-1">
                        <Trash2 className="w-3 h-3" /> Limpar Tudo
                      </button>
                   </div>
                </div>

                {/* Main Grid View */}
                <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar bg-[#080808]">
                  {statusCheckCodes.length === 0 ? (
                    <div className="h-full flex flex-row items-center justify-center gap-4 text-neutral-700 border border-[#1A1A1A] rounded-2xl border-dashed">
                      <Terminal className="w-12 h-12 opacity-20" />
                      <div className="text-left">
                        <p className="text-sm font-mono uppercase tracking-tighter">Terminal em espera...</p>
                        <p className="text-[10px] uppercase opacity-50">Insira códigos de licença para iniciar o monitoramento.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {statusCheckCodes.map(code => {
                        const result = statusCheckResults[code];
                        if (!result) return (
                          <div key={code} className="bg-[#111111] p-5 rounded-2xl border border-[#222222] flex flex-col gap-3 animate-pulse">
                            <div className="flex justify-between items-center">
                              <div className="w-24 h-4 bg-[#222222] rounded"></div>
                              <div className="w-4 h-4 bg-[#222222] rounded-full"></div>
                            </div>
                            <div className="w-full h-1 bg-[#222222] rounded mt-2"></div>
                            <div className="w-16 h-2 bg-[#222222] rounded"></div>
                          </div>
                        );

                        if (result.error) return (
                           <div key={code} className="bg-red-500/5 p-5 rounded-2xl border border-red-500/20 flex flex-col gap-2 relative group">
                              <button onClick={() => removeStatusCheckCode(code)} className="absolute top-2 right-2 p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded text-red-400 transition-all">
                                <X className="w-3 h-3" />
                              </button>
                              <div className="flex flex-col">
                                <span className="font-mono text-red-500 text-lg font-bold tracking-widest">{code}</span>
                                <span className="text-[10px] text-red-800 uppercase font-mono mt-1 font-bold">{result.error}</span>
                              </div>
                           </div>
                        );

                        const isOnline = result.isOnline;
                        const statusColor = isOnline ? (result.isPlaying ? 'text-green-500' : 'text-yellow-500') : 'text-neutral-600';
                        const dotColor = isOnline ? (result.isPlaying ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.4)]' : 'bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.4)]') : 'bg-neutral-800';

                        return (
                          <div key={code} className="bg-[#151619] p-5 rounded-2xl border border-[#222222] group hover:border-[#333333] transition-all relative flex flex-col justify-between h-full">
                            <button 
                              onClick={() => removeStatusCheckCode(code)} 
                              className="absolute top-3 right-3 p-1 opacity-0 group-hover:opacity-100 hover:bg-[#222222] rounded-lg text-neutral-600 hover:text-white transition-all z-10"
                            >
                              <X className="w-4 h-4" />
                            </button>

                            <div>
                              <div className="flex items-start justify-between mb-4">
                                <div className="space-y-1 pr-6 truncate">
                                  <h3 className="font-bold text-white text-base truncate font-serif italic">{result.clientName}</h3>
                                  <div className="flex items-center gap-1.5 font-mono">
                                    <span className="text-[10px] text-blue-400/80 bg-blue-500/5 px-1.5 py-0.5 rounded border border-blue-500/10 tracking-widest">
                                      {code}
                                    </span>
                                  </div>
                                </div>
                                <div className={`w-3 h-3 rounded-full mt-2 transition-all duration-1000 ${dotColor} ${isOnline ? 'animate-pulse' : ''}`}></div>
                              </div>

                              <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-neutral-600 uppercase tracking-widest font-mono">Status</span>
                                  <span className={`text-[10px] font-mono font-bold uppercase transition-colors duration-1000 ${statusColor}`}>
                                    {isOnline ? (result.isPlaying ? 'Reproduzindo' : 'Standby / Aberto') : 'Desconectado'}
                                  </span>
                                </div>
                                
                                {isOnline && (
                                  <div className="w-full h-1 bg-neutral-900 rounded-full overflow-hidden">
                                     <div 
                                        className={`h-full transition-all duration-1000 ${result.isPlaying ? 'bg-green-500 w-full' : 'bg-yellow-500 w-1/4'}`}
                                     ></div>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="mt-5 pt-4 border-t border-[#222222] flex items-center justify-between">
                               <span className="text-[9px] text-neutral-600 font-mono uppercase">Last Heartbeat</span>
                               <span className="text-[9px] text-neutral-400 font-mono">
                                  {result.lastSeen ? new Date(result.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'N/A'}
                               </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Footer Section */}
                <div className="px-8 py-4 border-t border-[#222222] bg-[#0A0A0A] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                       <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]"></span>
                       <span className="text-[9px] text-neutral-500 uppercase font-mono tracking-wider">Sync Ativo</span>
                    </div>
                    <div className="w-[1px] h-3 bg-neutral-800"></div>
                    <span className="text-[9px] text-neutral-600 uppercase font-mono">Auto-Refresh 3s</span>
                  </div>
                  {isCheckingStatus && (
                    <div className="flex items-center gap-2">
                       <span className="text-[9px] text-blue-500 font-mono uppercase">Lendo Dados...</span>
                       <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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
        display: 'flex',
        flexDirection: 'row',
        overflow: 'hidden'
      };
    }
    return {
      width: '100%',
      height: '100%',
      position: 'relative',
      display: 'flex',
      flexDirection: 'row',
      overflow: 'hidden'
    };
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden cursor-none">
      <div style={getOrientationStyles()}>
        <div 
          className="relative h-full flex flex-col transition-all duration-700 overflow-hidden"
          style={{ width: settings.queueEnabled ? '70%' : '100%' }}
        >
          <div className={`relative transition-all duration-700 overflow-hidden ${settings.footerEnabled ? 'h-[75%]' : 'h-full'}`}>
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
                    onEnded={() => {
                      if (filteredFiles.length === 1) {
                        if (videoRef.current) {
                          videoRef.current.currentTime = 0;
                          videoRef.current.play().catch(e => console.warn("Video loop error:", e));
                        }
                      } else {
                        nextSlide();
                      }
                    }}
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

              {/* Lower Third (GC) */}
              {settings.gcEnabled && (
                <motion.div 
                  initial={{ y: 50, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="absolute bottom-0 left-0 w-full z-50 pointer-events-none"
                >
                  <div className="flex flex-col w-full">
                    {/* Top Main Bar */}
                    <div className="flex items-stretch bg-white shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
                      {/* Red Category Box */}
                      <div 
                        className="px-6 py-4 flex flex-col items-center justify-center text-white shrink-0 shadow-xl"
                        style={{ backgroundColor: settings.gcCategoryColor || '#c62828' }}
                      >
                        {settings.gcLogoUrl ? (
                          <img src={settings.gcLogoUrl} alt="Logo" className="h-8 object-contain mb-1" referrerPolicy="no-referrer" />
                        ) : (
                          <Zap className="w-8 h-8 mb-1" />
                        )}
                        <span className="text-[10px] font-black uppercase tracking-tighter leading-none italic">{settings.gcCategory || 'NEWS'}</span>
                      </div>
                      {/* Title Area */}
                      <div className="flex-1 flex flex-col justify-center px-8 py-2 overflow-hidden border-l border-neutral-200">
                        <h2 className="text-neutral-900 text-2xl lg:text-3xl font-black uppercase tracking-tighter truncate italic leading-tight">
                          {settings.gcTitle}
                        </h2>
                        <p className="text-neutral-500 text-xs lg:text-sm font-bold uppercase tracking-widest truncate">
                          {settings.gcSubtitle}
                        </p>
                      </div>
                    </div>
                    {/* Dark Bottom Strip */}
                    <div className="h-8 bg-[#1a1a1a] flex items-center px-6 justify-between border-t border-white/5">
                        <div className="flex items-center gap-4">
                           <div className="w-2 h-2 rounded-full bg-red-600 animate-pulse"></div>
                           <span className="text-white text-[10px] font-mono font-bold tracking-widest flex items-center gap-2">
                             AO VIVO 
                             <span className="text-neutral-600">|</span>
                             {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                           </span>
                        </div>
                        <div className="hidden md:block">
                           <span className="text-neutral-500 text-[9px] font-mono uppercase tracking-[0.3em]">
                             PRODUÇÃO: DIGITAL NETWORKS INTERATIVA
                           </span>
                        </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
          </div>

          {settings.footerEnabled && (
            <div className="h-[25%] bg-black border-t border-white/10 flex flex-col overflow-hidden relative">
               <div className="flex-1 flex items-center justify-around p-4 gap-4 overflow-hidden">
                  {(settings.tickerAdImages && settings.tickerAdImages.length > 0) ? (
                    settings.tickerAdImages.map((url, i) => (
                      <div key={i} className="h-full flex-1 min-w-0 max-w-[50%]">
                        <img 
                          src={url} 
                          alt={`Ad ${i}`} 
                          className="w-full h-full object-contain rounded-xl"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center w-full h-full opacity-10 font-mono italic">
                      <span className="text-[12px] uppercase tracking-widest ">Espaço de Propaganda</span>
                      <span className="text-[8px] opacity-50">Adicione banners no painel de controle</span>
                    </div>
                  )}
               </div>

               {/* Footer Ticker Integration */}
               {settings.tickerEnabled && settings.tickerMessage && (
                  <div className="h-12 md:h-16 lg:h-20 bg-indigo-700 flex items-center overflow-hidden border-t border-white/20 shadow-[0_-10px_30px_rgba(0,0,0,0.5)] relative">
                     <div className="h-full bg-red-600 px-4 md:px-8 flex items-center justify-center font-black italic tracking-widest text-white shadow-[10px_0_30px_rgba(0,0,0,0.3)] z-20 shrink-0 text-xs md:text-xl lg:text-2xl">
                        NOTÍCIAS
                     </div>
                     <div className="relative flex-1 h-full flex items-center overflow-hidden">
                        <motion.div
                          animate={{ x: [0, '-50%'] }}
                          transition={{
                            duration: Math.max(10, (600 / (settings.tickerSpeed || 30)) * (settings.tickerMessage.length / 5 + 4)),
                            repeat: Infinity,
                            ease: "linear"
                          }}
                          className="flex shrink-0 font-black uppercase italic items-center whitespace-nowrap text-white"
                        >
                          {[1, 2].map((group) => (
                            <div key={group} className="flex items-center shrink-0">
                              {[1, 2, 3].map((i) => (
                                <div key={i} className="flex items-center gap-6 px-16 py-1 shrink-0 border-r border-white/10">
                                  {settings.tickerLogoUrl && (
                                    <img src={settings.tickerLogoUrl} alt="logo" className="w-8 h-8 md:w-12 md:h-12 object-contain" referrerPolicy="no-referrer" />
                                  )}
                                  <span className="text-lg md:text-3xl lg:text-4xl tracking-tighter drop-shadow-lg">{settings.tickerMessage}</span>
                                  <span className="text-white/40 text-3xl">★</span>
                                </div>
                              ))}
                            </div>
                          ))}
                        </motion.div>
                     </div>
                  </div>
               )}
            </div>
          )}
        </div>

      {/* Queue Panel */}
      {settings.queueEnabled && (
        <div className="h-full border-l border-white/5 transition-all duration-700 bg-black" style={{ width: '30%' }}>
           <div className="flex flex-col h-full text-white overflow-hidden shadow-2xl">
              <div className="p-6 text-center" style={{ backgroundColor: settings.queueThemeColor || '#004a8e' }}>
                <h2 className="text-xl md:text-2xl font-black uppercase tracking-widest italic leading-tight">{settings.queueTitle || 'CHAMADA'}</h2>
              </div>

              <div className="flex-1 flex flex-col items-center justify-center p-4 text-center space-y-2">
                <AnimatePresence mode="wait">
                  {settings.queueCurrent ? (
                    <motion.div
                      key={settings.queueCurrent.id}
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 1.1, opacity: 0 }}
                      transition={{ type: "spring", stiffness: 200, damping: 20 }}
                      className="w-full space-y-4"
                    >
                      <div className="space-y-2">
                        <span className="text-neutral-500 text-lg md:text-xl uppercase tracking-[0.3em] font-mono font-bold">Senha</span>
                        <div className="text-6xl md:text-8xl font-black leading-none tracking-tighter" style={{ color: settings.queueThemeColor || '#004a8e' }}>
                          {settings.queueCurrent.ticket || '---'}
                        </div>
                        {settings.queueCurrent.counter && (
                          <div className="text-2xl md:text-4xl font-bold uppercase text-white/50 mt-1 tracking-widest italic">
                            {settings.queueCurrent.counter}
                          </div>
                        )}
                      </div>

                      {settings.queueCurrent.name && (
                        <div className="space-y-1">
                          <span className="text-neutral-500 text-sm md:text-lg uppercase tracking-[0.2em] font-mono font-bold">{settings.queueClientLabel || 'CLIENTE'}</span>
                          <div className="text-xl md:text-3xl font-bold uppercase truncate px-4">{settings.queueCurrent.name}</div>
                        </div>
                      )}
                    </motion.div>
                  ) : (
                    <div className="text-white/40 text-2xl uppercase tracking-widest font-mono italic flex flex-col items-center gap-4">
                      <Activity className="w-12 h-12 text-white/5 animate-pulse" />
                      Aguardando chamada...
                    </div>
                  )}
                </AnimatePresence>
              </div>

              {settings.queueShowHistory && (
                <div className="bg-[#0A0A0A] p-6 border-t border-white/5 overflow-hidden">
                  <div className="flex items-center gap-3 mb-4">
                    <Clock className="w-4 h-4 text-neutral-600" />
                    <h3 className="text-neutral-500 text-xs uppercase tracking-widest font-bold">Últimos Números Chamados</h3>
                  </div>
                  <div className="space-y-4">
                     {(!settings.queueHistory || settings.queueHistory.length <= 1) ? (
                        <div className="text-[10px] text-neutral-800 font-mono italic uppercase tracking-widest py-4">
                           Aguardando histórico...
                        </div>
                     ) : (
                       settings.queueHistory.slice(1, 3).map((call, idx) => (
                         <motion.div 
                           key={call.id}
                           initial={{ x: 20, opacity: 0 }}
                           animate={{ x: 0, opacity: 1 }}
                             transition={{ delay: idx * 0.1 }}
                             className="flex items-center justify-between border-b border-white/5 pb-3 last:border-0"
                           >
                             <div className="flex flex-col min-w-0 flex-1">
                               <span className="text-3xl font-black italic" style={{ color: settings.queueThemeColor || '#004a8e' }}>{call.ticket}</span>
                               {call.name && <span className="text-xs text-neutral-300 font-bold uppercase truncate pr-4">{call.name}</span>}
                             </div>
                             <div className="text-right shrink-0">
                               <span className="text-neutral-400 text-lg font-mono font-bold uppercase block">{new Date(call.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                             </div>
                           </motion.div>
                         ))
                     )}
                    </div>
                  </div>
                )}

                <div className="p-4 pb-6 flex flex-col items-center justify-center gap-1 border-t border-white/5 bg-black">
                  <div className="text-3xl font-serif italic font-bold">
                     <ClockDisplay />
                  </div>
                  <div className="text-base text-neutral-500 font-mono font-bold">
                     {new Date().toLocaleDateString('pt-BR')}
                  </div>
                </div>
             </div>
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

      {/* Pre-load next item */}
      {filteredFiles.length > 1 && (
        <div className="hidden">
          {filteredFiles[(currentIndex + 1) % filteredFiles.length].isVideo ? (
            <video src={filteredFiles[(currentIndex + 1) % filteredFiles.length].url} preload="auto" />
          ) : (
            <img src={filteredFiles[(currentIndex + 1) % filteredFiles.length].url} referrerPolicy="no-referrer" />
          )}
        </div>
      )}

      {/* Hidden controls for exit */}
      <div className="absolute top-0 right-0 w-20 h-20 group z-50">
        <button 
          onClick={stopPlayer}
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

      {/* Ticker for Client Messaging (Shown only if footer is NOT active or ticker is vertical) */}
      {settings.tickerEnabled && settings.tickerMessage && (!settings.footerEnabled || settings.tickerDirection === 'vertical') && (
        <div className={`fixed z-[60] overflow-hidden bg-black/70 backdrop-blur-xl shadow-2xl transition-all duration-500 ${
          settings.tickerDirection === 'vertical' 
            ? 'left-0 top-0 h-full w-28 md:w-36 lg:w-44 border-r border-white/5' 
            : 'bottom-0 left-0 w-full border-t border-white/10'
        }`}>
          <div className={`${
            settings.tickerDirection === 'vertical' 
              ? 'h-full flex flex-col items-center' 
              : 'h-24 md:h-32 lg:h-40 flex items-center justify-center'
          } relative overflow-hidden`}>
            <motion.div
              animate={settings.tickerDirection === 'vertical' ? { y: [0, '-50%'] } : { x: [0, '-50%'] }}
              transition={{
                duration: Math.max(3, (300 / (settings.tickerSpeed || 30)) * (settings.tickerMessage.length / 5 + 4)),
                repeat: Infinity,
                ease: "linear"
              }}
              style={{ color: settings.tickerColor || '#ffffff' }}
              className={`flex shrink-0 font-black uppercase italic items-center ${settings.tickerDirection === 'vertical' ? 'flex-col w-full' : 'flex-row whitespace-nowrap'}`}
            >
              {[1, 2].map((group) => (
                <div key={group} className={`flex items-center shrink-0 ${settings.tickerDirection === 'vertical' ? 'flex-col gap-60 py-32 w-full' : 'flex-row items-center justify-center h-full'}`}>
                  {[1, 2, 3].map((i) => (
                    <div key={i} className={`flex items-center gap-8 justify-center shrink-0 ${settings.tickerDirection === 'vertical' ? 'flex-col py-10 w-full' : 'px-16 md:px-24 py-6 md:py-10'}`}>
                      {settings.tickerLogoUrl && (
                        <img 
                          src={settings.tickerLogoUrl} 
                          alt="logo" 
                          className={`object-contain ${settings.tickerDirection === 'vertical' ? 'w-20 h-20 md:w-28' : 'w-16 h-16 md:w-24 lg:w-28'}`}
                          referrerPolicy="no-referrer"
                        />
                      )}
                      <span 
                        className={`tracking-tighter leading-none shrink-0 text-center ${
                          settings.tickerDirection === 'vertical' 
                            ? 'text-3xl md:text-5xl py-4 mx-auto' 
                            : 'text-3xl md:text-5xl lg:text-6xl mt-1'
                        }`}
                        style={settings.tickerDirection === 'vertical' ? { 
                          writingMode: 'vertical-rl',
                          transform: 'rotate(0deg)' 
                        } : {}}
                      >
                        {settings.tickerMessage}
                      </span>
                      <span className={`text-blue-500 opacity-50 shrink-0 ${settings.tickerDirection === 'vertical' ? 'text-5xl md:text-8xl' : 'text-6xl md:text-9xl'}`}>★</span>
                    </div>
                  ))}
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      )}
      <div className={`fixed bottom-4 left-4 z-[9999] transition-opacity duration-1000 pointer-events-none opacity-0`}>
         <div className="bg-black/90 backdrop-blur-xl px-4 py-2 rounded-2xl border border-white/20 flex items-center gap-3 shadow-2xl">
            <div className="relative">
               <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
               <div className="absolute inset-0 w-2 h-2 rounded-full bg-blue-500 animate-ping"></div>
            </div>
            <span className="text-[10px] font-bold font-mono text-blue-400 uppercase tracking-widest hidden">Sincronizando Sistema...</span>
         </div>
      </div>
    </div>
  );
}
