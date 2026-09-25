/**
 * Profile-based SNI configuration for VLESS/Trojan Reality.
 * Pairs target domains with authentic TLS fingerprints, realistic spiderX paths,
 * XHTTP paths and padding settings to evade DPI/TSPU heuristic analysis.
 */

export interface SniProfile {
  sni: string;
  serverNames?: string[];
  dest?: string;
  fingerprint: 'safari' | 'ios' | 'chrome' | 'edge' | 'android' | 'firefox';
  spiderX: string;
  xhttpPath?: string;
  xPaddingBytes?: string;
}

export const DEFAULT_SNI_PROFILE: Readonly<Omit<SniProfile, 'sni'>> =
  Object.freeze({
    fingerprint: 'chrome',
    spiderX: '/',
    xhttpPath: '/',
    xPaddingBytes: '100-1000',
  });

interface SniProfileRule {
  exact?: string[];
  suffix?: string[];
  profile: Omit<SniProfile, 'sni'>;
}

export const SNI_PROFILE_RULES: readonly SniProfileRule[] = [
  // Apple ecosystem: software updates, iCloud, assets
  {
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
  // Microsoft ecosystem: Windows Update, Azure edge, Office CDN
  {
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
  // Google CDN / Android / Component downloads (Omaha updater)
  {
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
  // Speedtest / Ookla network endpoints
  {
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
  // NVIDIA driver downloads & GeForce
  {
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
