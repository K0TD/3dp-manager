/**
 * Client-side SNI profile resolver and metadata catalog for Reality camouflage.
 * Mirrors server-side sni-profiles logic to provide instant UI responsiveness.
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

export interface SniCatalogProfile {
  id: string;
  name: string;
  category: string;
  description: string;
  recommendedDomains: string[];
  exact?: string[];
  suffix?: string[];
  profile: {
    fingerprint: 'safari' | 'ios' | 'chrome' | 'edge' | 'android' | 'firefox';
    spiderX: string;
    xhttpPath?: string;
    xPaddingBytes?: string;
    serverNames?: string[];
  };
}

export const DEFAULT_CLIENT_SNI_PROFILE: Readonly<Omit<SniProfile, 'sni'>> = Object.freeze({
  profileId: 'default',
  profileName: 'Стандартный fallback',
  category: 'Default',
  fingerprint: 'chrome',
  spiderX: '/',
  xhttpPath: '/',
  xPaddingBytes: '100-1000',
});

export const CLIENT_SNI_PROFILES_CATALOG: readonly SniCatalogProfile[] = [
  {
    id: 'apple',
    name: 'Apple CDN & Services',
    category: 'Apple',
    description: 'Маскировка под дистрибуцию обновлений macOS/iOS и сервисы iCloud. Браузерный стек Safari, пути Akamai CDN.',
    recommendedDomains: [
      'swdist.apple.com',
      'swcdn.apple.com',
      'gateway.icloud.com',
      'weather-data.apple.com',
    ],
    exact: [
      'swdist.apple.com',
      'swcdn.apple.com',
      'gateway.icloud.com',
      'weather-data.apple.com',
    ],
    suffix: ['.apple.com', '.cdn-apple.com', '.icloud.com'],
    profile: {
      serverNames: ['swdist.apple.com', 'swcdn.apple.com'],
      fingerprint: 'safari',
      spiderX: '/content/downloads/',
      xhttpPath: '/download/updates/',
      xPaddingBytes: '500-1500',
    },
  },
  {
    id: 'microsoft',
    name: 'Microsoft & Azure Edge',
    category: 'Microsoft',
    description: 'Маскировка под CDN обновлений Windows и фронтенды Azure/Office. Браузерный стек Edge, пути WSUS.',
    recommendedDomains: [
      'c.s-microsoft.com',
      'www.microsoft.com',
      'update.microsoft.com',
    ],
    exact: ['c.s-microsoft.com', 'www.microsoft.com'],
    suffix: ['.microsoft.com', '.live.com', '.azure.com', '.msedge.net'],
    profile: {
      serverNames: ['c.s-microsoft.com', 'www.microsoft.com'],
      fingerprint: 'edge',
      spiderX: '/content/',
      xhttpPath: '/msdownload/update/',
      xPaddingBytes: '400-1200',
    },
  },
  {
    id: 'google',
    name: 'Google CDN & Omaha Update',
    category: 'Google',
    description: 'Маскировка под загрузку компонентов Chrome/Android и CDN Google. Стек Chrome, пути Omaha v2.',
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
  {
    id: 'samsung',
    name: 'Samsung OTA & Cloud Assets',
    category: 'Samsung',
    description: 'Маскировка под мобильный трафик обновлений Samsung и статику Galaxy Store. Стек Android.',
    recommendedDomains: ['www.samsung.com', 'samsungotacdn.com'],
    exact: ['www.samsung.com', 'samsungotacdn.com'],
    suffix: ['.samsung.com', '.samsungotacdn.com'],
    profile: {
      serverNames: ['www.samsung.com'],
      fingerprint: 'android',
      spiderX: '/assets/',
      xhttpPath: '/sec/assets/',
      xPaddingBytes: '300-1000',
    },
  },
  {
    id: 'speedtest',
    name: 'Ookla Speedtest CDN',
    category: 'Speedtest',
    description: 'Маскировка под замеры скорости и телеметрию Speedtest. Обычный веб-трафик к измерительным серверам.',
    recommendedDomains: ['speedtest.net', 'www.speedtest.net'],
    exact: ['speedtest.net', 'www.speedtest.net'],
    suffix: ['.speedtest.net', '.ookla.com'],
    profile: {
      serverNames: ['speedtest.net', 'www.speedtest.net'],
      fingerprint: 'chrome',
      spiderX: '/api/',
      xhttpPath: '/api/v1/ping',
      xPaddingBytes: '200-800',
    },
  },
  {
    id: 'nvidia',
    name: 'NVIDIA Driver Downloads',
    category: 'NVIDIA',
    description: 'Маскировка под трафик загрузки видеодрайверов и GeForce Experience. Большие бинарные пакеты.',
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
  {
    id: 'linux',
    name: 'Debian / Ubuntu Mirrors',
    category: 'Linux',
    description: 'Маскировка под трафик обновления пакетов APT дистрибутивов Linux. Надежно пропускается фильтрами.',
    recommendedDomains: ['debian.org', 'archive.ubuntu.com'],
    exact: ['debian.org', 'ftp.debian.org', 'archive.ubuntu.com'],
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

export function resolveClientSniProfile(rawSni?: string | null): SniProfile {
  const sni = (rawSni || '').trim().toLowerCase().replace(/:\d+$/, '');
  if (!sni) {
    return {
      sni: '',
      ...DEFAULT_CLIENT_SNI_PROFILE,
    };
  }

  for (const rule of CLIENT_SNI_PROFILES_CATALOG) {
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

  for (const rule of CLIENT_SNI_PROFILES_CATALOG) {
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
    ...DEFAULT_CLIENT_SNI_PROFILE,
    serverNames: [sni],
  };
}

export function getProfileThemeColor(category?: string): {
  color: string;
  bgDark: string;
  border: string;
} {
  switch ((category || '').toLowerCase()) {
    case 'apple':
      return {
        color: '#53d8ff',
        bgDark: 'rgba(83, 216, 255, 0.12)',
        border: 'rgba(83, 216, 255, 0.35)',
      };
    case 'microsoft':
      return {
        color: '#60a5fa',
        bgDark: 'rgba(96, 165, 250, 0.12)',
        border: 'rgba(96, 165, 250, 0.35)',
      };
    case 'google':
      return {
        color: '#56d69a',
        bgDark: 'rgba(86, 214, 154, 0.12)',
        border: 'rgba(86, 214, 154, 0.35)',
      };
    case 'samsung':
      return {
        color: '#c084fc',
        bgDark: 'rgba(192, 132, 252, 0.12)',
        border: 'rgba(192, 132, 252, 0.35)',
      };
    case 'speedtest':
      return {
        color: '#ffc45e',
        bgDark: 'rgba(255, 196, 94, 0.12)',
        border: 'rgba(255, 196, 94, 0.35)',
      };
    case 'nvidia':
      return {
        color: '#76b900',
        bgDark: 'rgba(118, 185, 0, 0.12)',
        border: 'rgba(118, 185, 0, 0.35)',
      };
    case 'linux':
      return {
        color: '#fb923c',
        bgDark: 'rgba(251, 146, 60, 0.12)',
        border: 'rgba(251, 146, 60, 0.35)',
      };
    default:
      return {
        color: '#94a3b8',
        bgDark: 'rgba(148, 163, 184, 0.12)',
        border: 'rgba(148, 163, 184, 0.35)',
      };
  }
}
