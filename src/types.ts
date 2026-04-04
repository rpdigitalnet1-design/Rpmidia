export interface DriveFile {
  id: string;
  name: string;
  isVideo: boolean;
  isWebsite?: boolean;
  websiteUrl?: string;
  mimeType: string;
  thumbnail: string;
  url: string;
}

export type DisplayMode = 'fill' | 'fit' | 'stretch';
export type Orientation = 'horizontal' | 'vertical';

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
}
