export interface DriveFile {
  id: string;
  name: string;
  isVideo: boolean;
  isAudio?: boolean;
  isWebsite?: boolean;
  isStream?: boolean;
  isYouTube?: boolean;
  websiteUrl?: string;
  mimeType: string;
  thumbnail: string;
  url: string;
}

export type DisplayMode = 'fill' | 'fit' | 'stretch';
export type Orientation = 'horizontal' | 'vertical';

export interface QueueCall {
  id: string;
  ticket: string; // "A1" or "38"
  name?: string;  // "João da Silva"
  counter: string; // "Guichê 2"
  timestamp: string;
}

export interface AppSettings {
  displayMode: DisplayMode;
  orientation: Orientation;
  slideDuration: number; // in milliseconds
  websiteDuration: number; // in milliseconds
  autoStart: boolean;
  driveFolderId: string;
  isMuted: boolean;
  syncInterval: number; // in milliseconds
  websiteRefreshInterval: number; // in milliseconds
  appRefreshInterval: number; // in milliseconds
  licenseCode?: string;
  clientName?: string;
  tickerMessage?: string;
  tickerEnabled?: boolean;
  tickerSpeed?: number;
  tickerColor?: string;
  tickerDirection?: 'horizontal' | 'vertical';
  tickerLogoUrl?: string;
  tickerAdImages?: string[]; // Multiple ad images for the footer
  footerEnabled?: boolean; // Toggle for the bottom propaganda area
  disabledMediaIds?: string[];
  
  // Queue System
  queueEnabled?: boolean;
  queueTitle?: string;
  queueVoiceEnabled?: boolean;
  queueShowHistory?: boolean;
  queueThemeColor?: string;
  queueCurrent?: QueueCall;
  queueHistory?: QueueCall[];
  queueMode?: 'number' | 'name' | 'both';
  queueClientLabel?: string;

  // GC (Lower Third)
  gcEnabled?: boolean;
  gcTitle?: string;
  gcSubtitle?: string;
  gcLogoUrl?: string;
  gcCategory?: string;
  gcCategoryColor?: string;

  // Remote Commands
  remoteCommand?: 'start' | 'stop' | 'restart' | null;
  remoteCommandId?: string;
}

export interface LicenseLog {
  id: string;
  code: string;
  clientName: string;
  activatedAt?: string;
  lastSeen?: string;
  deviceId?: string;
  isPlaying?: boolean;
}
