/**
 * Profile-based SNI configuration for VLESS/Trojan Reality.
 * Pairs target domains with authentic TLS fingerprints, realistic spiderX paths,
 * XHTTP paths and padding settings to evade DPI/TSPU heuristic analysis.
 */

export interface SniProfile {
  sni: string;
  profileId?: string;
  profileName?: string;
  category?: string;
  serverNames?: string[];
  dest?: string;
  fingerprint: 'safari' | 'ios' | 'chrome' | 'edge' | 'android' | 'firefox';
  spiderX: string;
  xhttpPath?: string;
  xPaddingBytes?: string;
}

export const DEFAULT_SNI_PROFILE: Readonly<Omit<SniProfile, 'sni'>> =
  Object.freeze({
    profileId: 'default',
    profileName: 'Стандартный fallback',
    category: 'Default',
    fingerprint: 'chrome',
    spiderX: '/',
    xhttpPath: '/',
    xPaddingBytes: '100-1000',
  });

export interface SniProfileRule {
  id: string;
  name: string;
  category: string;
  description: string;
  recommendedDomains: string[];
  exact?: string[];
  suffix?: string[];
  profile: Omit<SniProfile, 'sni' | 'profileId' | 'profileName' | 'category'>;
}

export const SNI_PROFILE_RULES: readonly SniProfileRule[] = [
  // Apple ecosystem: software updates, iCloud, assets
  {
    id: 'apple',
    name: 'Apple CDN & Services',
    category: 'Apple',
    description:
      'Маскировка под дистрибуцию обновлений macOS/iOS и сервисы iCloud. Использует Safari uTLS, естественные пути загрузки с Akamai CDN.',
    recommendedDomains: [
      'swdist.apple.com',
      'gateway.icloud.com',
      'weather-data.apple.com',
    ],
    exact: ['swdist.apple.com', 'gateway.icloud.com', 'weather-data.apple.com'],
    suffix: ['.apple.com', '.cdn-apple.com', '.icloud.com'],
    profile: {
      serverNames: ['swdist.apple.com'],
      fingerprint: 'safari',
      spiderX: '/content/downloads/',
      xhttpPath: '/download/updates/',
      xPaddingBytes: '500-1500',
    },
  },
  // Microsoft ecosystem: Windows Update, Azure edge, Office CDN
  {
    id: 'microsoft',
    name: 'Microsoft & Azure Edge',
    category: 'Microsoft',
    description:
      'Маскировка под CDN обновлений Windows и фронтенды Azure/Office. Chromium/Chrome uTLS (совместимо с Xray 26.9+ REALITY), реалистичные пути WSUS.',
    recommendedDomains: [
      'c.s-microsoft.com',
      'www.microsoft.com',
      'update.microsoft.com',
    ],
    exact: ['c.s-microsoft.com', 'www.microsoft.com'],
    suffix: ['.microsoft.com', '.live.com', '.azure.com', '.msedge.net'],
    profile: {
      serverNames: ['c.s-microsoft.com', 'www.microsoft.com'],
      fingerprint: 'chrome',
      spiderX: '/content/',
      xhttpPath: '/msdownload/update/',
      xPaddingBytes: '400-1200',
    },
  },
  // Google CDN / Android / Component downloads (Omaha updater)
  {
    id: 'google',
    name: 'Google CDN & Omaha Update',
    category: 'Google',
    description:
      'Маскировка под загрузку компонентов Chrome/Android и CDN Google. Стек Chrome, пути Omaha v2.',
    recommendedDomains: ['dl.google.com'],
    exact: ['dl.google.com'],
    suffix: ['.gvt1.com', '.google.com', '.android.com'],
    profile: {
      serverNames: ['dl.google.com'],
      fingerprint: 'chrome',
      spiderX: '/chrome/',
      xhttpPath: '/service/update2/',
      xPaddingBytes: '400-1200',
    },
  },
  // Samsung ecosystem: OTA updates, apps
  {
    id: 'samsung',
    name: 'Samsung OTA & Cloud Assets',
    category: 'Samsung',
    description:
      'Маскировка под мобильный трафик обновлений прошивок Samsung и статику Galaxy Store. Chrome uTLS (совместимо с Xray 26.9+ REALITY).',
    recommendedDomains: ['www.samsung.com', 'samsungotacdn.com'],
    exact: ['www.samsung.com', 'samsungotacdn.com'],
    suffix: ['.samsung.com', '.samsungotacdn.com'],
    profile: {
      serverNames: ['www.samsung.com'],
      fingerprint: 'chrome',
      spiderX: '/assets/',
      xhttpPath: '/sec/assets/',
      xPaddingBytes: '300-1000',
    },
  },
  // NVIDIA driver downloads & GeForce
  {
    id: 'nvidia',
    name: 'NVIDIA Driver Downloads',
    category: 'NVIDIA',
    description:
      'Маскировка под трафик загрузки видеодрайверов и GeForce Experience. Большие бинарные пакеты.',
    recommendedDomains: ['download.nvidia.com', 'www.nvidia.com'],
    exact: ['download.nvidia.com', 'www.nvidia.com', 'images.nvidia.com'],
    suffix: ['.nvidia.com'],
    profile: {
      serverNames: ['download.nvidia.com', 'www.nvidia.com'],
      fingerprint: 'chrome',
      spiderX: '/download/',
      xhttpPath: '/downloads/drivers/',
      xPaddingBytes: '500-1500',
    },
  },
  // Linux distributions (Debian / Ubuntu)
  {
    id: 'linux',
    name: 'Debian / Ubuntu Mirrors',
    category: 'Linux',
    description:
      'Маскировка под трафик обновления пакетов APT дистрибутивов Linux. Надежно пропускается большинством фильтров.',
    recommendedDomains: ['debian.org'],
    exact: ['debian.org', 'ftp.debian.org'],
    suffix: ['.debian.org', '.ubuntu.com'],
    profile: {
      serverNames: ['debian.org'],
      fingerprint: 'chrome',
      spiderX: '/debian/',
      xhttpPath: '/dists/stable/',
      xPaddingBytes: '400-1200',
    },
  },
];

export function resolveSniProfile(rawSni?: string | null): SniProfile {
  const sni = (rawSni || '').trim().toLowerCase().replace(/:\d+$/, '');
  if (!sni) {
    return {
      sni: '',
      ...DEFAULT_SNI_PROFILE,
    };
  }

  for (const rule of SNI_PROFILE_RULES) {
    if (rule.exact?.includes(sni)) {
      return {
        sni,
        profileId: rule.id,
        profileName: rule.name,
        category: rule.category,
        ...rule.profile,
        serverNames: rule.profile.serverNames?.includes(sni)
          ? rule.profile.serverNames
          : [sni, ...(rule.profile.serverNames || [])],
      };
    }
  }

  for (const rule of SNI_PROFILE_RULES) {
    if (rule.suffix?.some((s) => sni.endsWith(s))) {
      return {
        sni,
        profileId: rule.id,
        profileName: rule.name,
        category: rule.category,
        ...rule.profile,
        serverNames: [sni],
      };
    }
  }

  return {
    sni,
    ...DEFAULT_SNI_PROFILE,
    serverNames: [sni],
  };
}
