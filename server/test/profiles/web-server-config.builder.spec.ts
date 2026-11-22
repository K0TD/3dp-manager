import {
  buildHttpsFallbackProxyBundle,
  buildSelfSniWebServerBundle,
} from 'src/profiles/web-server-config.builder';

describe('web-server-config.builder', () => {
  it('generates hardened Nginx config bound strictly to 127.0.0.1 for Self-SNI with backup/validate/rollback commands', () => {
    const bundle = buildSelfSniWebServerBundle({
      engine: 'nginx',
      domain: 'portal.example.com',
      localHttpsPort: 8443,
      xver: 1,
      certificateFile: '/etc/ssl/custom/fullchain.pem',
      keyFile: '/etc/ssl/custom/privkey.pem',
    });

    expect(bundle.engine).toBe('nginx');
    expect(bundle.filename).toBe(
      '/etc/nginx/sites-available/self-sni-portal.example.com.conf',
    );
    expect(bundle.config).toContain(
      'listen 127.0.0.1:8443 ssl http2 proxy_protocol;',
    );
    expect(bundle.config).toContain('server_name portal.example.com;');
    expect(bundle.config).toContain(
      'ssl_certificate /etc/ssl/custom/fullchain.pem;',
    );
    expect(bundle.config).toContain(
      'ssl_certificate_key /etc/ssl/custom/privkey.pem;',
    );
    expect(bundle.config).toContain('ssl_protocols TLSv1.3 TLSv1.2;');
    expect(bundle.config).toContain('set_real_ip_from 127.0.0.1;');
    expect(bundle.validateCommand).toContain('nginx -t');
    expect(bundle.backupCommand).toContain('/etc/nginx/backups');
    expect(bundle.rollbackCommand).toContain('nginx -t');
    expect(bundle.staticSiteHtml).toContain(
      '<title>portal.example.com</title>',
    );
    expect(bundle.staticSiteHtml?.toLowerCase()).not.toContain('xray');
    expect(bundle.staticSiteHtml?.toLowerCase()).not.toContain('vpn');
  });

  it('generates Caddy config bound to 127.0.0.1 and warns if xver > 0', () => {
    const bundle = buildSelfSniWebServerBundle({
      engine: 'caddy',
      domain: 'static.example.org',
      localHttpsPort: 9443,
      xver: 2,
    });

    expect(bundle.engine).toBe('caddy');
    expect(bundle.config).toContain('https://static.example.org:9443');
    expect(bundle.config).toContain('bind 127.0.0.1');
    expect(bundle.config).toContain('protocols tls1.2 tls1.3');
    expect(bundle.validateCommand).toContain('caddy validate');
    expect(bundle.notes.join(' ')).toContain('proxy_protocol');
  });

  it('rejects invalid domain names and falls back on unsafe certificate paths', () => {
    expect(() =>
      buildSelfSniWebServerBundle({
        engine: 'nginx',
        domain: 'bad domain; rm -rf /',
      }),
    ).toThrow();

    const bundle = buildSelfSniWebServerBundle({
      engine: 'nginx',
      domain: 'clean.example.com',
      certificateFile: '/etc/ssl/../../etc/shadow',
      keyFile: '/etc/ssl/key.pem; malicious',
    });

    expect(bundle.config).toContain(
      '/etc/letsencrypt/live/clean.example.com/fullchain.pem',
    );
    expect(bundle.config).toContain(
      '/etc/letsencrypt/live/clean.example.com/privkey.pem',
    );
    expect(bundle.config).not.toContain('malicious');
    expect(bundle.config).not.toContain('shadow');
  });

  it('generates unbuffered Nginx and Caddy reverse proxy configs for HTTPS Fallback', () => {
    const nginx = buildHttpsFallbackProxyBundle({
      engine: 'nginx',
      domain: 'api.example.com',
      path: '/api/v2/stream',
      publicPort: 443,
      upstreamPort: 20443,
    });
    expect(nginx.config).toContain('location ^~ /api/v2/stream');
    expect(nginx.config).toContain('grpc_pass grpc://127.0.0.1:20443;');
    expect(nginx.config).toContain('client_max_body_size 0;');

    const caddy = buildHttpsFallbackProxyBundle({
      engine: 'caddy',
      domain: 'api.example.com',
      path: '/api/v2/stream',
      publicPort: 443,
      upstreamPort: 20443,
    });
    expect(caddy.config).toContain('handle /api/v2/stream*');
    expect(caddy.config).toContain('reverse_proxy 127.0.0.1:20443');
    expect(caddy.config).toContain('flush_interval -1');
    expect(caddy.config).toContain('versions h2c 1.1');
  });
});
